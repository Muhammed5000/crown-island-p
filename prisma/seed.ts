import {
  PrismaClient,
  ServiceKind,
  PriceRuleKind,
  ExtraPersonMode,
  PlaceType,
  UserRole,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Optionally seed a DEVELOPER login for a fresh database. This is OPT-IN and
 * secret-free: it runs ONLY when `SEED_DEVELOPER_PASSWORD` is provided in the
 * environment, and NEVER in production. No credentials are committed to the repo.
 *
 *   SEED_DEVELOPER_PASSWORD  (required to seed; the account's password)
 *   SEED_DEVELOPER_EMAIL     (optional; defaults to developer@crown-island.local)
 *
 * For any real deployment, create privileged accounts with `npm run admin:create`
 * instead. Idempotent: keyed by the unique email, so re-running refreshes the
 * password/role. Sign in at /admin/login (credentials provider, bcrypt hash).
 */
async function seedDeveloperUser() {
  const password = process.env.SEED_DEVELOPER_PASSWORD;
  if (!password) {
    console.log('SEED_DEVELOPER_PASSWORD not set — skipping developer seed (use `npm run admin:create`).');
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    console.log('Refusing to seed a developer account in production — use `npm run admin:create`.');
    return;
  }
  const email = (process.env.SEED_DEVELOPER_EMAIL || 'developer@crown-island.local').toLowerCase();
  // bcrypt cost 10 — same as scripts/create-admin.ts, what the login verifies.
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: UserRole.DEVELOPER },
    create: { email, name: 'Developer', passwordHash, role: UserRole.DEVELOPER },
  });

  console.log(`Seeded developer user: ${email}`); // never log the password
}

/**
 * Seeds the three flagship categories — Crown Surge, Crown Solace, Crown Club —
 * and three default services per category (Day Use, Cabana, Event).
 *
 * Idempotent: re-runnable. Uses `upsert` keyed by `slug`.
 */
async function main() {
  await seedDeveloperUser();

  const categories = [
    {
      slug: 'crown-surge',
      nameEn: 'Crown Surge',
      nameAr: 'كراون سيرج',
      descEn: 'Energetic beachfront experience with water activities and DJ sessions.',
      descAr: 'تجربة شاطئية حماسية مع أنشطة مائية وموسيقى حية.',
      coverUrl: '/images/categories/crown-surge.jpg',
      latitude: 31.2872,
      longitude: 30.0173,
      addressEn: 'El Montazah, Alexandria, Egypt',
      addressAr: 'المنتزه، الإسكندرية، مصر',
      sortOrder: 1,
    },
    {
      slug: 'crown-solace',
      nameEn: 'Crown Solace',
      nameAr: 'كراون سولاس',
      descEn: 'Quiet, private cabanas for a relaxing premium retreat.',
      descAr: 'كبائن خاصة وهادئة لتجربة استرخاء فاخرة.',
      coverUrl: '/images/categories/crown-solace.jpg',
      latitude: 31.2891,
      longitude: 30.0205,
      addressEn: 'El Montazah, Alexandria, Egypt',
      addressAr: 'المنتزه، الإسكندرية، مصر',
      sortOrder: 2,
    },
    {
      slug: 'crown-club',
      nameEn: 'Crown Club',
      nameAr: 'كراون كلوب',
      descEn: 'Members-only social lounge with curated dining and events.',
      descAr: 'صالة اجتماعية حصرية للأعضاء مع تجارب طعام وفعاليات مختارة.',
      coverUrl: '/images/categories/crown-club.jpg',
      latitude: 31.2865,
      longitude: 30.0190,
      addressEn: 'El Montazah, Alexandria, Egypt',
      addressAr: 'المنتزه، الإسكندرية، مصر',
      sortOrder: 3,
    },
  ];

  for (const cat of categories) {
    const category = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat,
    });

    // Three default services per category. Prices in piastres (EGP * 100).
    const services = [
      {
        slug: 'day-use',
        nameEn: 'Day Use',
        nameAr: 'دخول يومي',
        descEn: 'Single-day access — pool, beach and all common areas.',
        descAr: 'دخول ليوم واحد لحمام السباحة والشاطئ والمناطق العامة.',
        kind: ServiceKind.DAY_USE,
        // BEACH rule: one ticket carries up to 4 ADULTS (hard cap). Children
        // ride FREE — they never count toward the 4-adult cap and never change
        // the price. Adults beyond 4 are rejected by the engine.
        basePriceCents: 320_000, // 3,200 EGP ticket (covers up to 4 adults)
        includedPersonsPerUnit: 4, // = the maximum adults per beach ticket
        extraPersonPriceCents: 80_000, // defense-only: over-cap adults are blocked, not sold
        allowChildren: true,
        maxChildAge: 8,
        childrenCountAsPersons: false, // children are free, never a person slot
        dailyCapacityPeople: 200,
        dailyCapacityCars: 80,
        maxPeoplePerBooking: 8,
        maxCarsPerBooking: 2,
        sortOrder: 1,
      },
      {
        slug: 'cabana',
        nameEn: 'Cabana',
        nameAr: 'كبانة',
        descEn: 'Private cabana with seating, shade and waiter service.',
        descAr: 'كبانة خاصة مع جلسات ومظلة وخدمة نادل.',
        kind: ServiceKind.CABANA,
        // CABANA rule: one ticket holds 4 adults AND 2 children. Adding a 5th
        // adult OR a 3rd child opens another full ticket (price × ticket count).
        basePriceCents: 250_000, // 2,500 EGP per cabana ticket (4 adults + 2 children)
        dailyCapacityPeople: 60,
        dailyCapacityCars: 30,
        maxPeoplePerBooking: 16, // up to 4 cabanas worth in one booking
        maxCarsPerBooking: 4,
        sortOrder: 2,
        // ── Per-ticket capacity / children / multi-day / place-assignment ──
        includedPersonsPerUnit: 4, // adults carried by one cabana ticket
        freeChildrenPerUnit: 2, // children carried by one cabana ticket
        allowChildren: true,
        maxChildAge: 8,
        childrenCountAsPersons: false, // children have their own per-ticket capacity
        // maxPersonsPerUnit / allowExtraPeople / extraPersonMode / extraChildPriceCents
        // are unused by the CABANA regime (extras roll into whole tickets), but kept
        // at sane defaults in case an admin re-kinds the service.
        maxPersonsPerUnit: 4,
        allowExtraPeople: false,
        extraPersonMode: ExtraPersonMode.NEW_UNIT,
        allowMultiDay: true,
        maxBookingDays: 7,
        placeAssignmentRequired: true,
        placeType: PlaceType.CABANA,
      },
      {
        slug: 'event',
        nameEn: 'Event',
        nameAr: 'فعالية',
        descEn: 'Reserve a slot for a private event — birthday, gathering, corporate.',
        descAr: 'احجز فعالية خاصة — حفلة، تجمع، أو مناسبة شركة.',
        kind: ServiceKind.EVENT,
        // EVENT rule: every guest is billed individually — each adult at the
        // per-person base price, each child at the child price.
        basePriceCents: 30_000, // 300 EGP per adult
        allowChildren: true,
        maxChildAge: 8,
        extraChildPriceCents: 15_000, // 150 EGP per child
        childrenCountAsPersons: false, // children priced at the child rate, not as adults
        dailyCapacityPeople: 100, // capacity counted per head for events
        dailyCapacityCars: 50,
        maxPeoplePerBooking: 50,
        maxCarsPerBooking: 20,
        sortOrder: 3,
      },
    ];

    for (const svc of services) {
      const service = await prisma.service.upsert({
        where: {
          categoryId_slug: { categoryId: category.id, slug: svc.slug },
        },
        update: { ...svc, categoryId: category.id },
        create: { ...svc, categoryId: category.id },
      });

      // Price rules are kind-driven (see booking-calc-core `behaviorFor`):
      //   • DAY_USE (beach): PER_CAR + weekend surcharge on the ticket. The
      //     ticket covers up to 4 adults (hard cap) and free children; there is
      //     no per-person rule (over-cap adults are blocked, not surcharged).
      //   • CABANA / EVENT: no auto rules — the engine prices tickets / heads
      //     straight from `basePriceCents` (+ `extraChildPriceCents` for event
      //     children). A FLAT rule would clobber per-head event pricing.
      await prisma.priceRule.deleteMany({ where: { serviceId: service.id } });

      if (svc.kind === ServiceKind.DAY_USE) {
        await prisma.priceRule.createMany({
          data: [
            {
              serviceId: service.id,
              kind: PriceRuleKind.PER_CAR,
              amountCents: 15_000, // 150 EGP per car
              priority: 10,
            },
            {
              serviceId: service.id,
              kind: PriceRuleKind.WEEKEND_SURCHARGE,
              amountCents: 20_000, // +200 EGP weekend on the ticket
              weekdayMask: (1 << 5) | (1 << 6), // Friday + Saturday
              priority: 20,
            },
          ],
        });
      }

      // Seed a small place inventory for services that require assignment, so
      // the reception/gate place-picker has real cabanas to assign. Two zones
      // of 10 to demonstrate the adjacency recommendation. Idempotent via the
      // (serviceId, label) unique constraint.
      if (service.placeAssignmentRequired) {
        const zones = ['North', 'South'] as const;
        for (const zone of zones) {
          const rowOffset = zone === 'North' ? 0 : 2; // South sits two rows below
          for (let i = 1; i <= 10; i++) {
            const label = `${zone[0]}${i}`; // N1..N10, S1..S10
            const gridX = (i - 1) % 5;
            const gridY = rowOffset + Math.floor((i - 1) / 5);
            await prisma.servicePlace.upsert({
              where: { serviceId_label: { serviceId: service.id, label } },
              update: { type: service.placeType, zone, position: i, gridX, gridY },
              create: {
                serviceId: service.id,
                label,
                type: service.placeType,
                zone,
                position: i,
                gridX,
                gridY,
                sortOrder: i,
              },
            });
          }
        }
      }
    }

    console.log(`Seeded category ${category.slug} + 3 services`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
