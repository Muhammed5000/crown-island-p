/**
 * One-off, idempotent data cleanup: retire legacy `FLAT` PriceRule rows.
 *
 * Background: `Service.basePriceCents` is the single source of truth for the base
 * ticket price (what the admin form edits). A legacy `FLAT` PriceRule used to
 * silently OVERRIDE it in the booking calculation, so editing the base price had
 * no effect — e.g. Freska Beach → "Beach Entrance" was set to 300 EGP in the form
 * but charged 1500 EGP from a stale FLAT rule. FLAT is now retired in the engine
 * (`priceUnitDay` / `quote`), so these rows are inert; this script removes them.
 *
 * Safety:
 *  - If a service's basePriceCents is 0/empty, the FLAT amount is FOLDED into
 *    basePriceCents first (so the effective price is preserved), then deleted.
 *  - Otherwise the admin-set basePriceCents wins and the FLAT row is just deleted.
 *  - Bookings are untouched (they store their own captured totals).
 *  - Idempotent: re-running after success is a no-op (no FLAT rows remain).
 *
 * Run:  node scripts/retire-flat-pricerules.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const flats = await prisma.priceRule.findMany({
  where: { kind: 'FLAT' },
  include: { service: { select: { id: true, slug: true, nameEn: true, basePriceCents: true } } },
});

if (flats.length === 0) {
  console.log('No FLAT rules found — nothing to do.');
} else {
  let folded = 0;
  for (const r of flats) {
    const svc = r.service;
    if (svc.basePriceCents <= 0 && r.amountCents > 0) {
      await prisma.service.update({
        where: { id: svc.id },
        data: { basePriceCents: r.amountCents },
      });
      folded += 1;
      console.log(`[fold]  ${svc.slug} (${svc.nameEn}): basePriceCents 0 -> ${r.amountCents} (preserved from FLAT)`);
    } else {
      console.log(`[base wins] ${svc.slug} (${svc.nameEn}): base=${svc.basePriceCents}, FLAT=${r.amountCents} -> keep base, drop FLAT`);
    }
    await prisma.priceRule.delete({ where: { id: r.id } });
  }
  console.log(`Done. Removed ${flats.length} FLAT rule(s); folded ${folded} into basePriceCents.`);
}

await prisma.$disconnect();
