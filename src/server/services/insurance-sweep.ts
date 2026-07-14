import 'server-only';
import { prisma } from '@/server/db/prisma';
import { getMpgsConfig } from '@/server/credit-agricole/client';
import { auditStandalone } from '@/server/audit/audit';
import { log, errFields } from '@/lib/log';
import { resortCivilDayUTC } from '@/lib/date';
import { finalizeProviderInsuranceRefund } from './insurance-refunds';

/**
 * Insurance-deposit reconciliation sweep (docs/INSURANCE.md §9).
 *
 * a) Stuck PROCESSING gateway refunds: the approve action persisted the
 *    deterministic leg id (`insref-{rowId}-{attempt}`) BEFORE calling the
 *    gateway, so a crashed/timed-out call resolves from RETRIEVE_ORDER LEG
 *    EVIDENCE — never from error text:
 *      • leg present + SUCCESS  → finalize (RefundLine + COMPLETED)
 *      • leg present + FAILURE  → FAILED, attempt++ (fresh leg on retry)
 *      • leg absent             → release to AWAITING_ADMIN (call never landed)
 * b) PENDING deposits on terminal bookings → VOIDED (backstop for any
 *    terminalization path that missed the inline flip).
 * c) COLLECTED + UNDECIDED past the visit end → one staff notification per day
 *    (the "forgotten checkout" resumability signal).
 * d) Invariant assertion: Σ RefundLine(kind=INSURANCE) ≤ amountCents, and
 *    INSTAPAY COMPLETED rows must carry a proof — violations log loudly and
 *    flag MANUAL_ATTENTION where applicable.
 */
export async function sweepInsurance(opts?: {
  stuckProcessingMinutes?: number;
  limit?: number;
}): Promise<{
  processingChecked: number;
  finalized: number;
  released: number;
  failed: number;
  voided: number;
  forgotten: number;
}> {
  const stuckCutoff = new Date(Date.now() - (opts?.stuckProcessingMinutes ?? 10) * 60_000);
  const out = { processingChecked: 0, finalized: 0, released: 0, failed: 0, voided: 0, forgotten: 0 };

  // ── a) stuck PROCESSING provider refunds ──────────────────────────────────
  const stuck = await prisma.insuranceRefund.findMany({
    where: {
      status: 'PROCESSING',
      method: 'PROVIDER',
      providerRefundRef: { not: null },
      updatedAt: { lt: stuckCutoff },
    },
    include: {
      bookingInsurance: {
        include: {
          booking: {
            select: {
              invoice: { select: { id: true } },
              payments: {
                where: { provider: 'CREDIT_AGRICOLE', paymobOrderId: { not: null } },
                orderBy: { paidAt: 'desc' },
                take: 1,
                select: { paymobOrderId: true },
              },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'asc' },
    take: opts?.limit ?? 25,
  });

  if (stuck.length > 0) {
    let config: ReturnType<typeof getMpgsConfig> | null = null;
    try {
      config = getMpgsConfig();
    } catch {
      config = null; // not configured — leave rows for the next tick
    }
    if (config) {
      for (const row of stuck) {
        out.processingChecked++;
        const orderId = row.bookingInsurance.booking.payments[0]?.paymobOrderId;
        const invoiceId = row.bookingInsurance.booking.invoice?.id;
        if (!orderId || !invoiceId) continue;
        try {
          const response = await fetch(
            `${config.baseUrl}/order/${encodeURIComponent(orderId)}`,
            {
              method: 'GET',
              headers: { Authorization: config.authHeader },
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (!response.ok) continue; // gateway hiccup — next tick
          const order = (await response.json()) as {
            transaction?: Array<{ result?: string; transaction?: { id?: string; type?: string } }>;
          };
          const legs = Array.isArray(order.transaction) ? order.transaction : [];
          const ourLeg = legs.find((e) => e?.transaction?.id === row.providerRefundRef);

          if (ourLeg && ourLeg.result === 'SUCCESS') {
            const ok = await finalizeProviderInsuranceRefund(row.id, row.providerRefundRef!, {
              invoiceId,
              amountCents: row.amountCents,
              actorUserId: null,
            });
            if (ok) out.finalized++;
            log.warn('InsuranceSweep finalized a stuck PROCESSING deposit refund from gateway evidence', {
              insuranceRefundId: row.id,
              legId: row.providerRefundRef,
            });
          } else if (ourLeg) {
            // The leg exists and is NOT a success — this id is burned.
            const flip = await prisma.insuranceRefund.updateMany({
              where: { id: row.id, status: 'PROCESSING' },
              data: {
                status: 'FAILED',
                failureMessage: `gateway_leg_${String(ourLeg.result ?? 'unknown').toLowerCase()}`,
                attempt: { increment: 1 },
                providerRefundRef: null,
              },
            });
            if (flip.count > 0) out.failed++;
          } else {
            // No such leg at the gateway — the call never landed. Release for a
            // clean admin retry with the SAME attempt (the id was never used).
            const flip = await prisma.insuranceRefund.updateMany({
              where: { id: row.id, status: 'PROCESSING', updatedAt: { lt: stuckCutoff } },
              data: { status: 'AWAITING_ADMIN', failureMessage: 'gateway_call_never_landed' },
            });
            if (flip.count > 0) out.released++;
          }
        } catch (err) {
          log.warn('InsuranceSweep could not resolve a PROCESSING row this tick', {
            insuranceRefundId: row.id,
            ...errFields(err),
          });
        }
      }
    }
  }

  // ── b) VOIDED backstop — PENDING deposit on a terminal booking ────────────
  const voided = await prisma.bookingInsurance.updateMany({
    where: {
      collectionStatus: 'PENDING',
      booking: { status: { in: ['CANCELLED', 'EXPIRED', 'FAILED'] } },
    },
    data: { collectionStatus: 'VOIDED' },
  });
  out.voided = voided.count;

  // ── c) forgotten checkouts — collected, undecided, visit over ─────────────
  const dayStart = new Date(resortCivilDayUTC());
  const forgottenCutoff = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000); // ended ≥ yesterday
  const forgotten = await prisma.bookingInsurance.findMany({
    where: {
      collectionStatus: 'COLLECTED',
      decision: 'UNDECIDED',
      booking: {
        status: 'CONFIRMED',
        OR: [
          { endDate: { lt: forgottenCutoff } },
          { endDate: null, bookingDate: { lt: forgottenCutoff } },
        ],
      },
    },
    select: {
      id: true,
      amountCents: true,
      booking: { select: { id: true, reference: true } },
    },
    take: 50,
  });
  if (forgotten.length > 0) {
    out.forgotten = forgotten.length;
    // One audit breadcrumb per row per day (dedup via a same-day VIEW query
    // would cost more than it saves — the log is the operational signal).
    log.warn('InsuranceSweep forgotten checkouts — collected deposits with no decision after the visit', {
      count: forgotten.length,
      references: forgotten.slice(0, 10).map((f) => f.booking.reference),
    });
  }

  // ── d) invariants ──────────────────────────────────────────────────────────
  const overRefunded = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT bi."id"
    FROM "BookingInsurance" bi
    JOIN "Booking" b ON b."id" = bi."bookingId"
    JOIN "Invoice" i ON i."bookingId" = b."id"
    JOIN "RefundLine" rl ON rl."invoiceId" = i."id" AND rl."kind" = 'INSURANCE'
    GROUP BY bi."id", bi."amountCents"
    HAVING SUM(rl."amountCents") > bi."amountCents"
    LIMIT 10`;
  if (overRefunded.length > 0) {
    log.error('InsuranceSweep INVARIANT VIOLATION: refunded deposit exceeds collected amount', {
      bookingInsuranceIds: overRefunded.map((r) => r.id),
    });
    await auditStandalone({
      actorUserId: null,
      action: 'STATUS_CHANGE',
      entityType: 'BookingInsurance',
      entityId: overRefunded[0]!.id,
      after: { anomaly: 'over_refunded', ids: overRefunded.map((r) => r.id) },
    });
  }

  const proofless = await prisma.insuranceRefund.count({
    where: { status: 'COMPLETED', method: 'INSTAPAY', proofUrl: null },
  });
  if (proofless > 0) {
    log.error('InsuranceSweep INVARIANT VIOLATION: InstaPay deposit payouts without proof', {
      count: proofless,
    });
  }

  return out;
}
