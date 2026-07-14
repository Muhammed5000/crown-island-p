/**
 * One-off migration: move EXISTING sensitive uploads (guest ID images, payment
 * proofs, ops proofs) out of the world-readable `public/uploads/**` store into
 * the private store, and rewrite their stored URLs to `/api/secure-media/...`
 * so they are served only through the auth-gated route.
 *
 * Safe + idempotent:
 *  - URLs already in the secure form are skipped.
 *  - A file already moved (missing from public, present in private) just gets
 *    its DB URL fixed.
 *  - The backward-compatible resolver means partial runs never break anything.
 *
 * RUN ORDER (important): deploy the new code and RESTART the server FIRST (so the
 * `/api/secure-media` route + dual-form validators are live), THEN run this.
 *
 *   Dry run (default, read-only):  npx tsx scripts/migrate-sensitive-uploads.ts
 *   Apply:                         npx tsx scripts/migrate-sensitive-uploads.ts --apply
 */
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { resolveSensitiveUpload, secureUploadTarget } from '../src/lib/upload-paths';

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const LEGACY_RE = /^\/uploads\/(\d{4})\/(\d{2})\/([a-f0-9]{24}\.[a-z0-9]+)$/i;

/** Map a legacy `/uploads/Y/M/file` URL to its new secure URL + both disk paths. */
function plan(legacyUrl: string) {
  const m = LEGACY_RE.exec(legacyUrl);
  if (!m) return null;
  const [, year, month, fileName] = m;
  const oldDisk = resolveSensitiveUpload(legacyUrl)?.diskPath;
  const { url: newUrl, diskPath: newDisk } = secureUploadTarget(year!, month!, fileName!);
  return oldDisk ? { newUrl, oldDisk, newDisk } : null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n=== migrate-sensitive-uploads (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  // Gather every distinct legacy URL across the sensitive columns.
  const [guestIds, payments, opsEvents] = await Promise.all([
    prisma.guestIdDocument.findMany({ select: { id: true, imageUrl: true, storagePath: true } }),
    prisma.payment.findMany({ where: { proofUrl: { not: null } }, select: { id: true, proofUrl: true } }),
    prisma.opsTicketEvent.findMany({ where: { imageUrl: { not: null } }, select: { id: true, imageUrl: true } }),
  ]);

  const legacyUrls = new Set<string>();
  for (const g of guestIds) {
    if (g.imageUrl?.startsWith('/uploads/')) legacyUrls.add(g.imageUrl);
    if (g.storagePath?.startsWith('/uploads/')) legacyUrls.add(g.storagePath);
  }
  for (const p of payments) if (p.proofUrl?.startsWith('/uploads/')) legacyUrls.add(p.proofUrl);
  for (const e of opsEvents) if (e.imageUrl?.startsWith('/uploads/')) legacyUrls.add(e.imageUrl);

  console.log(`Found ${legacyUrls.size} distinct legacy sensitive URL(s) to migrate.`);
  if (legacyUrls.size === 0) {
    console.log('Nothing to do.\n');
    return;
  }

  let moved = 0;
  let missing = 0;
  let rewritten = 0;

  for (const legacyUrl of legacyUrls) {
    const p = plan(legacyUrl);
    if (!p) {
      console.warn(`  SKIP (unparseable): ${legacyUrl}`);
      continue;
    }
    const inPublic = await fileExists(p.oldDisk);
    const inPrivate = await fileExists(p.newDisk);

    console.log(
      `  ${legacyUrl}  ->  ${p.newUrl}` +
        `  [public:${inPublic ? 'yes' : 'no'} private:${inPrivate ? 'yes' : 'no'}]`,
    );

    if (!APPLY) continue;

    // 1) Move the bytes (only if still in public and not already in private).
    if (inPublic && !inPrivate) {
      await mkdir(path.dirname(p.newDisk), { recursive: true });
      await rename(p.oldDisk, p.newDisk);
      moved++;
    } else if (!inPublic && !inPrivate) {
      missing++;
      console.warn(`    ! file missing in BOTH stores — rewriting URL anyway`);
    }

    // 2) Rewrite every DB reference to this URL (idempotent string swaps).
    const [g1, g2, pay, ev, med] = await prisma.$transaction([
      prisma.guestIdDocument.updateMany({ where: { imageUrl: legacyUrl }, data: { imageUrl: p.newUrl } }),
      prisma.guestIdDocument.updateMany({ where: { storagePath: legacyUrl }, data: { storagePath: p.newUrl } }),
      prisma.payment.updateMany({ where: { proofUrl: legacyUrl }, data: { proofUrl: p.newUrl } }),
      prisma.opsTicketEvent.updateMany({ where: { imageUrl: legacyUrl }, data: { imageUrl: p.newUrl } }),
      prisma.media.updateMany({ where: { url: legacyUrl }, data: { url: p.newUrl } }),
    ]);
    rewritten += g1.count + g2.count + pay.count + ev.count + med.count;
  }

  console.log(
    `\nDone. ${APPLY ? `moved ${moved} file(s), ${missing} missing, rewrote ${rewritten} DB ref(s).` : '(dry run — no changes written)'}\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
