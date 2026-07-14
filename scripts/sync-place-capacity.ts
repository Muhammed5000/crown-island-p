/**
 * Bootstrap: give every place-required service with an EMPTY inventory a starter
 * set of physical places numbered up to its daily capacity, so a brand-new
 * service doesn't open with an empty reception/gate picker. Idempotent.
 *
 * Mirrors `topUpPlacesForCapacity` in admin-places.ts EXACTLY (duplicated here
 * because that module is `server-only` and can't be imported by a tsx script):
 * it is a strict NO-OP the moment a service already has ANY place. The admin's
 * manual inventory is authoritative — capacity (people) and physical-place count
 * are decoupled (a place may hold several people), so we must NEVER top a curated
 * inventory up to the capacity number (that bolted phantom places onto a
 * deliberate set).
 * Run with: npx tsx scripts/sync-place-capacity.ts
 */
import { PrismaClient, type PlaceType } from '@prisma/client';

const prisma = new PrismaClient();

const TYPE_PREFIX: Record<PlaceType, string> = {
  CABANA: 'C',
  CABIN: 'K',
  UMBRELLA: 'U',
  SEAT: 'S',
  SPOT: 'P',
};

async function topUp(serviceId: string, placeType: PlaceType, target: number) {
  if (target <= 0 || target > 1000) return 0;
  const existing = await prisma.servicePlace.findMany({
    where: { serviceId },
    select: { label: true, gridY: true },
  });
  // Empty-only bootstrap: once the admin has created ANY place, that set is
  // authoritative — never supplement it up to the capacity number.
  if (existing.length > 0) return 0;
  const taken = new Set(existing.map((p) => p.label));
  const startRow = existing.length ? Math.max(...existing.map((p) => p.gridY)) + 1 : 0;
  const prefix = TYPE_PREFIX[placeType] ?? 'P';
  const toCreate = target - existing.length;
  const rows = [];
  let n = 1;
  let added = 0;
  while (added < toCreate) {
    const label = `${prefix}${n}`;
    n += 1;
    if (taken.has(label)) continue;
    taken.add(label);
    rows.push({
      serviceId,
      label,
      type: placeType,
      position: 1000 + added,
      gridX: added % 8,
      gridY: startRow + Math.floor(added / 8),
      sortOrder: 1000 + added,
    });
    added += 1;
  }
  if (rows.length) await prisma.servicePlace.createMany({ data: rows });
  return rows.length;
}

async function main() {
  const services = await prisma.service.findMany({
    where: { placeAssignmentRequired: true },
    select: { id: true, nameEn: true, placeType: true, dailyCapacityPeople: true },
  });
  for (const s of services) {
    const before = await prisma.servicePlace.count({ where: { serviceId: s.id } });
    const added = await topUp(s.id, s.placeType, s.dailyCapacityPeople ?? 0);
    const after = await prisma.servicePlace.count({ where: { serviceId: s.id } });
    console.log(`${s.nameEn}: cap=${s.dailyCapacityPeople} places ${before} → ${after} (+${added})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
