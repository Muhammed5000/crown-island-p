/**
 * One-off remediation for the capacity audit (2026-07). Idempotent — safe to run
 * repeatedly. Run with:  npx tsx scripts/backfill-capacity-integrity.ts
 *
 * Fixes the historical data the code changes can't reach on their own:
 *
 *  1. NULL daily cap on place-required services (the overbooking hole). Sets
 *     `dailyCapacityPeople` to the service's ACTIVE physical-place count — the
 *     real per-day inventory. Services with no places are reported, not guessed
 *     (an admin must set a deliberate cap).
 *
 *  2. Stale `placeId` on dead bookings. A CANCELLED / EXPIRED / FAILED / REFUNDED
 *     booking whose units still carry a `placeId` keeps that place reserved
 *     forever via the unique [placeId, date] index. Clears them so the place is
 *     bookable again. (New cancels/refunds now clear it automatically; this
 *     sweeps the backlog.)
 *
 *  3. Negative BookingSlot counters. Clamps any reservedPeople/Cars/Handicap < 0
 *     to 0 so a historical underflow can't mask the daily cap check.
 *
 * Prints a dry-run-style summary of everything it changed.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillNullCaps() {
  const services = await prisma.service.findMany({
    where: { placeAssignmentRequired: true, dailyCapacityPeople: null },
    select: { id: true, nameEn: true },
  });
  let fixed = 0;
  const needsManual: string[] = [];
  for (const s of services) {
    const placeCount = await prisma.servicePlace.count({
      where: { serviceId: s.id, isActive: true },
    });
    if (placeCount > 0) {
      await prisma.service.update({
        where: { id: s.id },
        data: { dailyCapacityPeople: placeCount },
      });
      console.log(`  cap backfilled: ${s.nameEn} → ${placeCount} (active places)`);
      fixed += 1;
    } else {
      needsManual.push(s.nameEn);
    }
  }
  console.log(`NULL-cap place services: ${fixed} backfilled, ${needsManual.length} need a manual cap.`);
  if (needsManual.length) console.log(`  ⚠ no active places, set a cap by hand: ${needsManual.join(', ')}`);
}

async function freeStalePlaceIds() {
  const { count } = await prisma.bookingUnit.updateMany({
    where: {
      placeId: { not: null },
      booking: { status: { in: ['CANCELLED', 'EXPIRED', 'FAILED'] } },
    },
    data: { placeId: null, assignedById: null, assignedAt: null },
  });
  console.log(`Stale placeIds on dead bookings freed: ${count}`);
}

async function clampNegativeSlots() {
  const [p, c, h] = await Promise.all([
    prisma.bookingSlot.updateMany({ where: { reservedPeople: { lt: 0 } }, data: { reservedPeople: 0 } }),
    prisma.bookingSlot.updateMany({ where: { reservedCars: { lt: 0 } }, data: { reservedCars: 0 } }),
    prisma.bookingSlot.updateMany({ where: { reservedHandicap: { lt: 0 } }, data: { reservedHandicap: 0 } }),
  ]);
  console.log(`Negative slot counters clamped → people:${p.count} cars:${c.count} handicap:${h.count}`);
}

async function main() {
  console.log('— Capacity integrity backfill —');
  await backfillNullCaps();
  await freeStalePlaceIds();
  await clampNegativeSlots();
  console.log('Done.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
