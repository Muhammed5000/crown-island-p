import { readFile } from 'node:fs/promises';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessGate } from '@/server/auth/roles';
import { SECURE_MEDIA_PREFIX, resolveSensitiveUpload } from '@/lib/upload-paths';
import { prisma } from '@/server/db/prisma';
import { auditStandalone } from '@/server/audit/audit';
import { resortCivilDayUTC } from '@/lib/date';
import {
  decideSecureMediaAccess,
  type SecureMediaOwner,
} from '@/server/services/secure-media-authz-core';
import { log, errFields } from '@/lib/log';

/**
 * Authenticated serving route for SENSITIVE uploads (guest ID images, payment
 * proofs, ops proofs). These bytes live under the private root (never `public/`)
 * and are only returned here, behind a staff-role check — so a leaked URL is
 * useless to anyone without an authorised session.
 *
 * Authorization is TWO layers:
 *  1. Role gate — gate-authorised staff and the admin tiers (`canAccessGate`);
 *     customers can never read these.
 *  2. OBJECT-level policy — the URL is reverse-looked-up in its referencing
 *     table (GuestIdDocument / Payment / OpsTicketEvent) and
 *     `decideSecureMediaAccess` decides whether THIS staff member may see THAT
 *     object (see the policy doc there). Guest-ID and payment-proof accesses —
 *     allowed AND denied — are written to the audit log.
 *
 * Display sites use plain `<img src>` / `<a href>` (same-origin → the request
 * carries the session cookie), so no `next/image` optimizer indirection strips
 * the auth context.
 */
export const runtime = 'nodejs';

const CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/** Reverse-lookup the URL in the three tables that reference sensitive media. */
async function resolveOwner(url: string): Promise<{
  owner: SecureMediaOwner;
  auditEntity: { entityType: string; entityId: string } | null;
}> {
  const guestId = await prisma.guestIdDocument.findFirst({
    where: { imageUrl: url },
    select: {
      id: true,
      uploadedById: true,
      booking: { select: { status: true, bookingDate: true, endDate: true } },
    },
  });
  if (guestId) {
    const start = guestId.booking.bookingDate.getTime();
    return {
      owner: {
        type: 'guestId',
        uploadedById: guestId.uploadedById,
        bookingStatus: guestId.booking.status,
        visitStartDayUTC: start,
        visitEndDayUTC: guestId.booking.endDate?.getTime() ?? start,
      },
      auditEntity: { entityType: 'GuestIdDocument', entityId: guestId.id },
    };
  }

  const payment = await prisma.payment.findFirst({
    where: { proofUrl: url },
    select: { id: true },
  });
  if (payment) {
    return {
      owner: { type: 'paymentProof' },
      auditEntity: { entityType: 'Payment', entityId: payment.id },
    };
  }

  // Insurance-deposit payout proofs (InstaPay desk refunds) are money documents
  // exactly like booking payment proofs — same policy (money-visible staff),
  // same audit treatment. docs/INSURANCE.md §5.
  const insuranceRefund = await prisma.insuranceRefund.findFirst({
    where: { proofUrl: url },
    select: { id: true },
  });
  if (insuranceRefund) {
    return {
      owner: { type: 'paymentProof' },
      auditEntity: { entityType: 'InsuranceRefund', entityId: insuranceRefund.id },
    };
  }

  const opsEvent = await prisma.opsTicketEvent.findFirst({
    where: { imageUrl: url },
    select: { id: true },
  });
  if (opsEvent) {
    // Ops proofs are lower-sensitivity (work-progress photos) — authorised but
    // not audit-logged, so ticket-board thumbnails don't flood the log.
    return { owner: { type: 'opsProof' }, auditEntity: null };
  }

  // Not referenced by anything (yet) — the reception wizard's deferred-commit
  // window: IDs/proofs are uploaded BEFORE the booking exists. The Media
  // manifest records who uploaded the bytes, so the policy can grant the
  // uploader (and only the uploader) a preview. Audited like guest-ID views —
  // these ARE guest IDs pre-attach.
  const media = await prisma.media.findFirst({
    where: { url },
    select: { id: true, uploadedById: true },
  });
  if (media) {
    return {
      owner: { type: 'unattached', uploadedById: media.uploadedById },
      auditEntity: { entityType: 'Media', entityId: media.id },
    };
  }

  return { owner: { type: 'unowned' }, auditEntity: null };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const user = await getSessionUser();
  if (!user || !canAccessGate(user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { path: segments } = await ctx.params;
  const url = `${SECURE_MEDIA_PREFIX}/${(segments ?? []).join('/')}`;
  const resolved = resolveSensitiveUpload(url);
  // Must be a well-formed SECURE path (resolveSensitiveUpload rebuilds the disk
  // path from validated segments, so traversal / arbitrary files are impossible).
  if (!resolved || !resolved.secure) return new NextResponse('Not found', { status: 404 });

  const contentType = CONTENT_TYPE[resolved.ext];
  if (!contentType) return new NextResponse('Not found', { status: 404 });

  // Object-level policy + access audit. Audit failures log but never block the
  // gate flow (availability wins over the log line — the deny itself is still
  // enforced either way).
  const { owner, auditEntity } = await resolveOwner(url);
  const allowed = decideSecureMediaAccess({
    role: user.role,
    userId: user.id,
    owner,
    todayDayUTC: resortCivilDayUTC(),
  });
  if (auditEntity) {
    await auditStandalone({
      actorUserId: user.id,
      action: 'VIEW',
      entityType: auditEntity.entityType,
      entityId: auditEntity.entityId,
      after: allowed ? { url } : { url, denied: true },
    }).catch((err) => log.error('secure-media audit write failed', { url, ...errFields(err) }));
  }
  if (!allowed) {
    if (owner.type === 'unowned') {
      // A well-formed URL nothing references — flag it, it may be a probe.
      log.warn('secure-media denied access to UNOWNED sensitive file', {
        url,
        userId: user.id,
        role: user.role,
      });
    }
    return new NextResponse('Forbidden', { status: 403 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(resolved.diskPath);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Sensitive — never persist in shared/browser caches (also keeps it out of
      // the PWA cache; the service worker already skips /api/* entirely).
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // Sandbox a directly-opened document (defence-in-depth, mirrors /uploads).
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
