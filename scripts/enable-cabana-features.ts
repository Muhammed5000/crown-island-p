/**
 * One-off: enable the per-unit / children / multi-day / place-assignment feature
 * set on existing CABANA services (the canonical multi-unit service) and seed a
 * starter place inventory + layout so the workflow is visible end-to-end.
 * Idempotent. Run with: npx tsx scripts/enable-cabana-features.ts
 */
import { prisma } from '../src/server/db/prisma';

async function main() {
  const cabanas = await prisma.service.findMany({ where: { kind: 'CABANA' } });
  console.log('CABANA services found:', cabanas.length);

  for (const s of cabanas) {
    await prisma.service.update({
      where: { id: s.id },
      data: {
        // Physical capacity per cabana = 4. Parties beyond that need additional
        // cabanas (NEW_UNIT), so reception/gate must assign one place per unit.
        includedPersonsPerUnit: 4,
        maxPersonsPerUnit: 4,
        allowExtraPeople: false,
        extraPersonMode: 'NEW_UNIT',
        extraPersonPriceCents: s.extraPersonPriceCents > 0 ? s.extraPersonPriceCents : 40000,
        allowChildren: true,
        maxChildAge: 8,
        freeChildrenPerUnit: 2,
        extraChildPriceCents: s.extraChildPriceCents > 0 ? s.extraChildPriceCents : 20000,
        allowMultiDay: true,
        maxBookingDays: 7,
        placeAssignmentRequired: true,
        placeType: 'CABANA',
        maxPeoplePerBooking:
          s.maxPeoplePerBooking && s.maxPeoplePerBooking >= 12 ? s.maxPeoplePerBooking : 16,
      },
    });

    const existing = await prisma.servicePlace.count({ where: { serviceId: s.id } });
    if (existing === 0) {
      const zones = ['North', 'South'];
      for (let z = 0; z < zones.length; z++) {
        const zone = zones[z]!;
        for (let i = 1; i <= 10; i++) {
          await prisma.servicePlace.create({
            data: {
              serviceId: s.id,
              label: `${zone[0]}${i}`,
              type: 'CABANA',
              zone,
              position: i,
              gridX: (i - 1) % 5,
              gridY: z * 2 + Math.floor((i - 1) / 5),
              sortOrder: i,
            },
          });
        }
      }
      console.log(`  + seeded 20 places for "${s.nameEn}"`);
    } else {
      console.log(`  = "${s.nameEn}" already has ${existing} places`);
    }
  }
  console.log('done.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
