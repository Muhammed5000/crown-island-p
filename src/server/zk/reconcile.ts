import 'server-only';
import { prisma } from '@/server/db/prisma';
import { resortCivilDayUTC } from '@/lib/date';
import { log, errFields } from '@/lib/log';
import { isZkConfigured } from './client';
import { syncBookingZkAccess, revokeBookingZkAccess } from './provision';

/**
 * Out-of-band reconciliation for ZK provisioning — the backstop that makes the
 * integration self-healing without any push from ZK (the platform has none).
 *
 * Two passes each sweep:
 *   A) PROVISION — confirmed ZK bookings still in their window whose provisioning
 *      is PENDING (ZK was down, pool was empty) or FAILED (a since-fixed config
 *      error). Re-running `syncBookingZkAccess` converges them.
 *   B) TEAR DOWN — ZK bookings that are now terminal (cancelled/expired/failed) or
 *      whose day has passed but still hold ZK state. `revokeBookingZkAccess`
 *      deletes the person and frees the card.
 *
 * Both operations are idempotent, so overlapping runs (in-process tick + an
 * external cron) are safe.
 */
export async function reconcilePendingZk(opts?: {
  limit?: number;
}): Promise<{
  scanned: number;
  provisioned: number;
  revoked: number;
  stillPending: number;
  failed: number;
}> {
  // Nothing to do while the integration is off / unconfigured.
  if (!(await isZkConfigured())) {
    return { scanned: 0, provisioned: 0, revoked: 0, stillPending: 0, failed: 0 };
  }

  const limit = opts?.limit ?? 50;
  const today = new Date(resortCivilDayUTC()); // UTC midnight of the resort civil day

  // A) Provisioning retries: confirmed, in-window, not yet fully provisioned.
  const toProvision = await prisma.booking.findMany({
    where: {
      status: 'CONFIRMED',
      service: { requiresAccessControl: true },
      zkProvisionStatus: { in: ['PENDING', 'FAILED'] },
      OR: [
        { endDate: null, bookingDate: { gte: today } },
        { endDate: { gte: today } },
      ],
    },
    select: { id: true },
    orderBy: { bookingDate: 'asc' },
    take: limit,
  });

  // B) Teardown: terminal OR past-day bookings that still carry ZK state.
  const toRevoke = await prisma.booking.findMany({
    where: {
      service: { requiresAccessControl: true },
      zkProvisionStatus: { in: ['PENDING', 'PROVISIONED', 'FAILED'] },
      OR: [
        { status: { in: ['CANCELLED', 'EXPIRED', 'FAILED'] } },
        { endDate: null, bookingDate: { lt: today } },
        { endDate: { lt: today } },
      ],
    },
    select: { id: true },
    orderBy: { bookingDate: 'asc' },
    take: limit,
  });

  let provisioned = 0;
  let revoked = 0;
  let stillPending = 0;
  let failed = 0;

  for (const b of toProvision) {
    try {
      const result = await syncBookingZkAccess(b.id);
      if (result.status === 'provisioned') provisioned++;
      else if (result.status === 'failed') failed++;
      else if (result.status === 'revoked') revoked++;
      else stillPending++;
    } catch (err) {
      log.error('zk reconcile provision error for booking', { bookingId: b.id, ...errFields(err) });
      stillPending++;
    }
  }

  for (const b of toRevoke) {
    try {
      const { ok } = await revokeBookingZkAccess(b.id);
      if (ok) revoked++;
      else stillPending++;
    } catch (err) {
      log.error('zk reconcile revoke error for booking', { bookingId: b.id, ...errFields(err) });
      stillPending++;
    }
  }

  return {
    scanned: toProvision.length + toRevoke.length,
    provisioned,
    revoked,
    stillPending,
    failed,
  };
}
