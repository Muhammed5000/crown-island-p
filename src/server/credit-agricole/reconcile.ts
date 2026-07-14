import 'server-only';
import { prisma } from '@/server/db/prisma';
import { verifyAndConfirmOrder } from './verify';
import { getMpgsConfig } from './client';
import { applyRefundToDb } from '@/server/services/refunds';
import { audit, auditStandalone } from '@/server/audit/audit';
import {
  decideRefundPendingAction,
  extractRefundEvidence,
  type MpgsRefundEvidence,
} from '@/server/payments/refund-sweep-core';
import { resolveAdminNotifyEmail } from '@/server/settings/settings';
import { getEmailProvider } from '@/server/email/provider';

/**
 * Out-of-band reconciliation for MPGS Hosted Checkout.
 *
 * MPGS confirmation normally happens when the browser hits our `/complete` route
 * after the Lightbox closes. If the browser never returns (tab closed during the
 * post-payment redirect, network drop, app-switch) a captured order would leave
 * the booking stuck PENDING_PAYMENT. This sweep re-runs the authoritative
 * RETRIEVE_ORDER check (via `verifyAndConfirmOrder`, which is idempotent) for
 * Crédit Agricole payments that have been PENDING for a while, so a real capture
 * still confirms the booking. Drive it from the cron sidecar.
 *
 * The window is bounded so it neither races the normal flow (min age) nor churns
 * forever on long-abandoned bookings (max age).
 */
export async function reconcilePendingMpgs(opts?: {
  minAgeMinutes?: number;
  maxAgeHours?: number;
  limit?: number;
}): Promise<{
  scanned: number;
  confirmed: number;
  failed: number;
  refunded: number;
  stillPending: number;
}> {
  const now = Date.now();
  // 2-minute min-age: recover an abandoned-tab capture in ~2–4 min. The live
  // payment page keeps polling /check for up to ~10 min, so this floor stays
  // mostly behind an active session (minimising redundant RETRIEVE_ORDER) while
  // still catching a closed tab quickly. Everything downstream is idempotent, so
  // an occasional overlap with the live poll is a harmless duplicate read.
  const olderThan = new Date(now - (opts?.minAgeMinutes ?? 2) * 60_000);
  // 72h window: wide enough that a captured-but-abandoned order still recovers
  // days later (e.g. the sweep itself was down over a weekend), cheap because a
  // settled row leaves the window's WHERE (status/booking filters) permanently.
  const newerThan = new Date(now - (opts?.maxAgeHours ?? 72) * 60 * 60_000);

  const stale = await prisma.payment.findMany({
    where: {
      provider: 'CREDIT_AGRICOLE',
      // Re-check PENDING holds (browser never returned) AND payments an earlier
      // transient gateway state wrongly marked FAILED: a genuinely CAPTURED order
      // must recover the booking to CONFIRMED instead of stranding captured funds.
      // A truly-failed order simply re-checks to 'failed' again (a harmless no-op).
      status: { in: ['PENDING', 'FAILED'] },
      paymobOrderId: { not: null },
      createdAt: { lt: olderThan, gt: newerThan },
      // CANCELLED/EXPIRED bookings are included for one reason: a capture that
      // landed on a terminal booking is auto-refunded, and if THAT refund call
      // failed transiently the payment stays PENDING — this sweep is its only
      // retry path (verify → captured → terminal bail → auto-refund again).
      // A REFUNDED payment leaves `status IN (PENDING, FAILED)`, so settled
      // rows still drop out of the sweep permanently.
      booking: { status: { in: ['PENDING_PAYMENT', 'FAILED', 'CANCELLED', 'EXPIRED'] } },
    },
    select: { bookingId: true },
    orderBy: { createdAt: 'asc' },
    take: opts?.limit ?? 50,
  });

  let confirmed = 0;
  let failed = 0;
  let refunded = 0;
  let stillPending = 0;
  for (const p of stale) {
    try {
      const status = await verifyAndConfirmOrder(p.bookingId);
      if (status === 'success') confirmed++;
      else if (status === 'failed') failed++;
      else if (status === 'refunded') refunded++;
      else stillPending++;
    } catch (err) {
      console.error('[MPGS reconcile] error for booking', p.bookingId, err);
      stillPending++;
    }
  }

  return { scanned: stale.length, confirmed, failed, refunded, stillPending };
}

/**
 * Recover payments stuck in REFUND_PENDING.
 *
 * `adminRefundBooking` claims SUCCEEDED → REFUND_PENDING before the gateway
 * refund (the H2 double-refund guard). If the follow-up (release on gateway
 * failure, or `applyRefundToDb` on success) never lands — DB hiccup, process
 * death mid-flow — the claim is stranded and every later refund attempt is
 * rejected by the guard. This sweep asks the gateway (RETRIEVE_ORDER, the
 * authoritative source) what actually happened and settles the row:
 *   - refund present on the order  → finalize the DB side-effects
 *   - order still plainly CAPTURED → release the claim back to SUCCEEDED
 *   - ambiguous / unreachable      → leave for the next tick
 *
 * The min-age gate is measured on `updatedAt` — the claim flip bumps it, so a
 * refund an admin started seconds ago is never touched (their gateway call
 * times out at 15s; we wait minutes).
 */
export async function sweepStuckRefundPending(opts?: {
  minAgeMinutes?: number;
  limit?: number;
}): Promise<{ scanned: number; finalized: number; released: number; left: number }> {
  const cutoff = new Date(Date.now() - (opts?.minAgeMinutes ?? 15) * 60_000);

  const stuck = await prisma.payment.findMany({
    where: {
      provider: 'CREDIT_AGRICOLE',
      status: 'REFUND_PENDING',
      paymobOrderId: { not: null },
      updatedAt: { lt: cutoff },
    },
    select: {
      id: true,
      paymobOrderId: true,
      amountCents: true,
      bookingId: true,
      booking: { select: { invoice: { select: { id: true, totalCents: true } } } },
    },
    orderBy: { updatedAt: 'asc' },
    take: opts?.limit ?? 25,
  });
  if (stuck.length === 0) return { scanned: 0, finalized: 0, released: 0, left: 0 };

  let config: ReturnType<typeof getMpgsConfig>;
  try {
    config = getMpgsConfig();
  } catch {
    // Not configured (e.g. env pulled mid-flight) — nothing safe to decide.
    return { scanned: stuck.length, finalized: 0, released: 0, left: stuck.length };
  }

  let finalized = 0;
  let released = 0;
  let left = 0;
  for (const payment of stuck) {
    try {
      // What our ledger already knows about this order's refunds — insurance
      // deposit legs and prior partial refunds must never be mistaken for the
      // stuck SERVICE refund we're diagnosing (docs/INSURANCE.md §6).
      const knownLines = payment.booking.invoice
        ? await prisma.refundLine.findMany({
            where: { invoiceId: payment.booking.invoice.id },
            select: { paymobRefundId: true, amountCents: true },
          })
        : [];
      const known = {
        legIds: knownLines.map((l) => l.paymobRefundId).filter((v): v is string => !!v),
        recordedCents: knownLines.reduce((s, l) => s + l.amountCents, 0),
      };

      let evidence: MpgsRefundEvidence | null = null;
      try {
        const response = await fetch(
          `${config.baseUrl}/order/${encodeURIComponent(payment.paymobOrderId!)}`,
          {
            method: 'GET',
            headers: { Authorization: config.authHeader },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (response.ok) evidence = extractRefundEvidence(await response.json(), known);
      } catch {
        // Gateway unreachable → evidence stays null → 'leave'.
      }

      const action = decideRefundPendingAction(evidence, payment.id, payment.amountCents);

      if (action.kind === 'finalize') {
        // The gateway HAS the refund — write the DB side-effects it implies.
        // applyRefundToDb computes full-vs-partial itself (cumulative RefundLine
        // sum), so nothing extra needs to be passed here.
        await prisma.$transaction(async (tx) => {
          const applied = await applyRefundToDb(tx, {
            paymentId: payment.id,
            amountCents: action.amountCents,
            paymobRefundId: action.refundId,
            reason: 'refund_pending_sweep',
          });
          if (!applied.applied) {
            // RefundLine already written (the admin call died between apply and
            // its own finalize) — just settle the status, the H2-finalize mirror.
            await tx.payment.updateMany({
              where: { id: payment.id, status: 'REFUND_PENDING' },
              data: { status: 'REFUNDED', refundedAt: new Date() },
            });
          }
          await audit(tx, {
            actorUserId: null, // payment system
            action: 'REFUND',
            entityType: 'Payment',
            entityId: payment.id,
            after: {
              refundId: action.refundId,
              amountCents: action.amountCents,
              bookingId: payment.bookingId,
              cause: 'refund_pending_sweep',
            },
          });
        });
        console.warn('[RefundSweep] finalized stuck REFUND_PENDING payment', {
          paymentId: payment.id,
          amountCents: action.amountCents,
        });
        finalized++;
      } else if (action.kind === 'release') {
        // No refund ever reached the gateway — give the claim back so the admin
        // can retry. Conditional + still-stale, so a refund that started between
        // our read and this write is never clobbered.
        const releasedRow = await prisma.payment.updateMany({
          where: { id: payment.id, status: 'REFUND_PENDING', updatedAt: { lt: cutoff } },
          data: { status: 'SUCCEEDED' },
        });
        if (releasedRow.count === 1) {
          await auditStandalone({
            actorUserId: null,
            action: 'STATUS_CHANGE',
            entityType: 'Payment',
            entityId: payment.id,
            before: { status: 'REFUND_PENDING' },
            after: {
              status: 'SUCCEEDED',
              bookingId: payment.bookingId,
              cause: 'refund_pending_sweep_release',
            },
          });
          console.warn(
            '[RefundSweep] released stuck REFUND_PENDING claim (no refund on the gateway) — admin can retry',
            { paymentId: payment.id },
          );
        }
        released++;
      } else {
        left++;
      }
    } catch (err) {
      console.error('[RefundSweep] error for payment', payment.id, err);
      left++;
    }
  }

  return { scanned: stuck.length, finalized, released, left };
}

/**
 * Alert on payments that aged OUT of the reconcile window still PENDING.
 *
 * `reconcilePendingMpgs` only re-checks payments < 72h old — older rows drop out
 * of the sweep permanently, so a genuinely stuck charge (customer possibly
 * debited, booking never confirmed) would go silent forever. This marks each
 * such payment ONCE (atomic `failureCode` claim — no schema change; nothing
 * branches on failureCode for PENDING rows, it is display-only, and a late
 * confirm resets it to null in the sync engine) and sends the admin one summary
 * email per batch. Status is deliberately untouched: no money decision is being
 * made here, this is purely visibility.
 */
export async function flagAgedOutPayments(opts?: {
  maxAgeHours?: number;
  limit?: number;
}): Promise<{ flagged: number }> {
  const agedBefore = new Date(Date.now() - (opts?.maxAgeHours ?? 72) * 60 * 60_000);

  const candidates = await prisma.payment.findMany({
    where: {
      provider: 'CREDIT_AGRICOLE',
      status: 'PENDING',
      paymobOrderId: { not: null },
      createdAt: { lt: agedBefore },
      failureCode: null, // once-only marker
      booking: { status: { in: ['PENDING_PAYMENT', 'FAILED', 'CANCELLED', 'EXPIRED'] } },
    },
    select: {
      id: true,
      bookingId: true,
      amountCents: true,
      createdAt: true,
      booking: { select: { reference: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: opts?.limit ?? 50,
  });
  if (candidates.length === 0) return { flagged: 0 };

  const flagged: typeof candidates = [];
  for (const p of candidates) {
    // Atomic once-only claim — a concurrent instance flags (and alerts) each
    // payment exactly once.
    const claim = await prisma.payment.updateMany({
      where: { id: p.id, status: 'PENDING', failureCode: null },
      data: {
        failureCode: 'reconcile_window_expired',
        failureMessage: 'PENDING beyond the 72h reconcile window — manual review required',
      },
    });
    if (claim.count !== 1) continue;
    flagged.push(p);
    await auditStandalone({
      actorUserId: null,
      action: 'UPDATE',
      entityType: 'Payment',
      entityId: p.id,
      after: { alert: 'reconcile_window_expired', bookingId: p.bookingId },
    }).catch((err) => console.error('[MPGS reconcile] aged-out audit write failed', p.id, err));
  }

  if (flagged.length > 0) {
    console.error(
      `[MPGS reconcile] ${flagged.length} payment(s) aged out of the reconcile window still PENDING — flagged for manual review`,
      flagged.map((p) => ({ paymentId: p.id, booking: p.booking.reference })),
    );
    try {
      const to = await resolveAdminNotifyEmail();
      if (to) {
        const lines = flagged.map(
          (p) =>
            `- booking ${p.booking.reference} — payment ${p.id} — ${(p.amountCents / 100).toFixed(2)} — created ${p.createdAt.toISOString()}`,
        );
        await getEmailProvider().send({
          to,
          subject: `Crown Island: ${flagged.length} stuck payment(s) need manual review`,
          text:
            `The following card payments have been PENDING for more than 72 hours and ` +
            `left the automatic reconcile window. Check each order in the MPGS portal — ` +
            `a captured order needs a manual confirm or refund.\n\n${lines.join('\n')}`,
          tag: 'stuck-payments',
        });
      }
    } catch (err) {
      // Email is best-effort; the audit rows + failureCode marker are the
      // durable record.
      console.error('[MPGS reconcile] stuck-payment alert email failed', err);
    }
  }

  return { flagged: flagged.length };
}
