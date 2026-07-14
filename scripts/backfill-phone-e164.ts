/**
 * One-time backfill: canonicalise every stored phone number to E.164 so the
 * values written before the H7 fix line up with the new write/check normalisation
 * (`toE164`). Covers User.phone, CustomerProfile.phone and BlockedIdentity(PHONE).
 *
 * Idempotent — E.164 of an already-E.164 value is itself, so re-running is a
 * no-op. A value that collides with another row's @unique phone is logged and
 * skipped (resolve those duplicates by hand).
 *
 * Run:  npx tsx scripts/backfill-phone-e164.ts
 * `src/lib/phone.ts` is a pure module (no `server-only`), so no stub is needed.
 */
import { PrismaClient } from '@prisma/client';
import { toE164 } from '../src/lib/phone';

const prisma = new PrismaClient();

async function backfill<T extends { id: string }>(
  label: string,
  rows: Array<T & { phone: string | null }>,
  update: (id: string, phone: string) => Promise<unknown>,
): Promise<void> {
  let changed = 0;
  let skipped = 0;
  for (const row of rows) {
    const canonical = toE164(row.phone);
    if (!canonical || canonical === row.phone) continue;
    try {
      await update(row.id, canonical);
      changed++;
    } catch (err) {
      skipped++;
      console.warn(`[backfill:${label}] skip ${row.id} (${row.phone} → ${canonical}):`, (err as Error).message);
    }
  }
  console.log(`[backfill:${label}] ${changed} updated, ${skipped} skipped, ${rows.length} scanned`);
}

async function main() {
  const users = await prisma.user.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  });
  await backfill('User', users, (id, phone) => prisma.user.update({ where: { id }, data: { phone } }));

  const profiles = await prisma.customerProfile.findMany({
    select: { id: true, phone: true },
  });
  await backfill('CustomerProfile', profiles, (id, phone) =>
    prisma.customerProfile.update({ where: { id }, data: { phone } }),
  );

  const blocks = await prisma.blockedIdentity.findMany({
    where: { kind: 'PHONE' },
    select: { id: true, value: true },
  });
  await backfill(
    'BlockedIdentity',
    blocks.map((b) => ({ id: b.id, phone: b.value })),
    (id, value) => prisma.blockedIdentity.update({ where: { id }, data: { value } }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
