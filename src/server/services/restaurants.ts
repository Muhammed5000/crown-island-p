import type { Prisma, Restaurant, RestaurantStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { DomainError } from './errors';

/**
 * Restaurant partner profiles.
 *
 * Three audiences, three read paths:
 *  - the OWNER (RESTAURANT role) creates/edits exactly one profile —
 *    `getMyRestaurant` / `upsertMyRestaurant`. `ownerId` always comes from the
 *    session, `status` is never owner-writable (no mass assignment).
 *  - GUESTS browse only APPROVED profiles — `listPublicRestaurants` /
 *    `getRestaurantForViewer` (the latter lets the owner & admins preview an
 *    unapproved profile without leaking it to anyone else).
 *  - ADMINS moderate from `/admin/restaurants` — list / status / delete, all
 *    audited like every other admin mutation in this codebase.
 *
 * Link safety: callers (the server actions) validate every social/website URL
 * through `src/lib/safe-url.ts` BEFORE these functions run; this layer only
 * re-checks the upload paths because they gate what files guests download.
 */

/** Fields a restaurant owner may set about their own profile. */
export interface RestaurantProfileInput {
  name: string;
  description: string | null;
  coverUrl: string | null;
  menuPdfUrl: string | null;
  menuPdfName: string | null;
  menuPdfSize: number | null;
  phone: string;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  websiteUrl: string | null;
  address: string | null;
  openingHours: string | null;
}

/**
 * Uploaded-file references must be paths OUR uploader produced — never an
 * arbitrary URL. Defence-in-depth: the zod schemas in the action enforce the
 * same rule, this backstop survives a future caller that forgets.
 */
function assertUploadPath(value: string | null, kind: 'image' | 'pdf'): void {
  if (value == null) return;
  if (!/^\/uploads\/[a-z0-9/._-]+$/i.test(value) || value.includes('..')) {
    throw new DomainError('Invalid uploaded file reference', 'invalid_upload_ref', 400);
  }
  if (kind === 'pdf' && !value.toLowerCase().endsWith('.pdf')) {
    throw new DomainError('Menu must be a PDF file', 'invalid_upload_ref', 400);
  }
}

/** Snapshot used for audit before/after payloads (no relations, no noise). */
function auditable(r: Restaurant) {
  return {
    name: r.name,
    status: r.status,
    phone: r.phone,
    coverUrl: r.coverUrl,
    menuPdfUrl: r.menuPdfUrl,
    facebookUrl: r.facebookUrl,
    instagramUrl: r.instagramUrl,
    tiktokUrl: r.tiktokUrl,
    websiteUrl: r.websiteUrl,
  };
}

// ───── Owner ─────────────────────────────────────────────────────────────────

export function getMyRestaurant(ownerId: string) {
  return prisma.restaurant.findUnique({ where: { ownerId } });
}

/**
 * Create or update the caller's own profile. A new profile starts PENDING; a
 * REJECTED profile that gets edited goes back to PENDING (re-submission) and
 * its rejection note is cleared. APPROVED/DISABLED status is admin-only and
 * survives owner edits untouched.
 */
export async function upsertMyRestaurant(ownerId: string, data: RestaurantProfileInput) {
  assertUploadPath(data.coverUrl, 'image');
  assertUploadPath(data.menuPdfUrl, 'pdf');

  return prisma.$transaction(async (tx) => {
    const existing = await tx.restaurant.findUnique({ where: { ownerId } });

    if (!existing) {
      const created = await tx.restaurant.create({ data: { ...data, ownerId } });
      await audit(tx, {
        actorUserId: ownerId,
        action: 'CREATE',
        entityType: 'Restaurant',
        entityId: created.id,
        after: auditable(created),
      });
      return created;
    }

    const resubmitted = existing.status === 'REJECTED';
    const updated = await tx.restaurant.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...(resubmitted ? { status: 'PENDING' as RestaurantStatus, statusNote: null } : {}),
      },
    });
    await audit(tx, {
      actorUserId: ownerId,
      action: 'UPDATE',
      entityType: 'Restaurant',
      entityId: existing.id,
      before: auditable(existing),
      after: auditable(updated),
    });
    return updated;
  });
}

// ───── Guests ────────────────────────────────────────────────────────────────

const PUBLIC_CARD_SELECT = {
  id: true,
  name: true,
  description: true,
  coverUrl: true,
  phone: true,
  address: true,
  openingHours: true,
  menuPdfUrl: true,
} satisfies Prisma.RestaurantSelect;

export type PublicRestaurantCard = Prisma.RestaurantGetPayload<{
  select: typeof PUBLIC_CARD_SELECT;
}>;

/** All APPROVED restaurants, optionally filtered by a name/description search. */
export function listPublicRestaurants(query?: string): Promise<PublicRestaurantCard[]> {
  const q = query?.trim();
  return prisma.restaurant.findMany({
    where: {
      status: 'APPROVED',
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'asc' }],
    select: PUBLIC_CARD_SELECT,
  });
}

/**
 * Full profile for the detail page. APPROVED profiles are visible to any
 * signed-in guest; an unapproved profile is returned ONLY to its owner or an
 * admin (preview), and is `null` for everyone else — indistinguishable from
 * "does not exist".
 */
export async function getRestaurantForViewer(
  id: string,
  viewer: { id: string; isAdmin: boolean } | null,
): Promise<Restaurant | null> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id } });
  if (!restaurant) return null;
  if (restaurant.status === 'APPROVED') return restaurant;
  if (viewer && (viewer.isAdmin || viewer.id === restaurant.ownerId)) return restaurant;
  return null;
}

// ───── Admin ─────────────────────────────────────────────────────────────────

const ADMIN_OWNER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  deletedAt: true,
  blockedAt: true,
} satisfies Prisma.UserSelect;

export function adminListRestaurants() {
  return prisma.restaurant.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { owner: { select: ADMIN_OWNER_SELECT } },
  });
}

export function adminGetRestaurant(id: string) {
  return prisma.restaurant.findUnique({
    where: { id },
    include: { owner: { select: ADMIN_OWNER_SELECT } },
  });
}

/**
 * Moderate a profile: APPROVED / REJECTED / DISABLED / back to PENDING.
 * `note` is surfaced to the owner (rejection reason); pass null to clear it.
 */
export async function adminSetRestaurantStatus(
  id: string,
  status: RestaurantStatus,
  note: string | null,
  actorUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.restaurant.findUnique({ where: { id } });
    if (!existing) throw new DomainError('Restaurant not found', 'not_found', 404);
    if (existing.status === status && (existing.statusNote ?? null) === note) return existing;

    const updated = await tx.restaurant.update({
      where: { id },
      data: { status, statusNote: note, reviewedById: actorUserId, reviewedAt: new Date() },
    });
    await audit(tx, {
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Restaurant',
      entityId: id,
      before: { status: existing.status, statusNote: existing.statusNote },
      after: { status, statusNote: note },
    });
    return updated;
  });
}

export async function adminDeleteRestaurant(id: string, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.restaurant.findUnique({ where: { id } });
    if (!existing) throw new DomainError('Restaurant not found', 'not_found', 404);

    await tx.restaurant.delete({ where: { id } });
    await audit(tx, {
      actorUserId,
      action: 'DELETE',
      entityType: 'Restaurant',
      entityId: id,
      before: auditable(existing),
    });
  });
}
