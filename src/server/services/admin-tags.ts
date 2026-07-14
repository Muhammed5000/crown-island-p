import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { assertNotLocalNode } from '@/server/sync/node-guard';
import { DomainError } from './errors';

/**
 * Admin-curated customer tag library + assignment.
 *
 * Tags are the manual-segmentation primitive: assign a tag to customers, then
 * filter the customer list by it to view that segment. All mutations are
 * audited. Assignment is idempotent (re-assigning the same tag is a no-op).
 */

/** Allowed chip tones — must match the Badge component's `tone` prop. */
export const TAG_COLORS = ['gold', 'navy', 'success', 'warning', 'danger', 'info', 'muted'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(value: string): value is TagColor {
  return (TAG_COLORS as readonly string[]).includes(value);
}

export async function adminListTags() {
  return prisma.customerTag.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { assignments: true } } },
  });
}

export async function adminCreateTag(nameRaw: string, color: string, actorUserId: string) {
  assertNotLocalNode('The tag library');
  const name = nameRaw.trim();
  if (name.length < 1 || name.length > 40) {
    throw new DomainError('Tag name must be 1–40 characters', 'invalid_name', 400);
  }
  if (!isTagColor(color)) {
    throw new DomainError('Unknown colour', 'invalid_color', 400);
  }

  // Case-insensitive duplicate guard (the DB unique is an exact-match backstop).
  const clash = await prisma.customerTag.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (clash) throw new DomainError('A tag with that name already exists', 'tag_taken', 409);

  return prisma.$transaction(async (tx) => {
    let created;
    try {
      created = await tx.customerTag.create({ data: { name, color, createdById: actorUserId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DomainError('A tag with that name already exists', 'tag_taken', 409);
      }
      throw err;
    }
    await audit(tx, {
      actorUserId,
      action: 'CREATE',
      entityType: 'CustomerTag',
      entityId: created.id,
      after: { name: created.name, color: created.color },
    });
    return created;
  });
}

export async function adminDeleteTag(id: string, actorUserId: string) {
  assertNotLocalNode('The tag library');
  return prisma.$transaction(async (tx) => {
    const before = await tx.customerTag.findUnique({ where: { id } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    // Deleting a tag detaches it from every customer (assignments cascade).
    await tx.customerTag.delete({ where: { id } });
    await audit(tx, {
      actorUserId,
      action: 'DELETE',
      entityType: 'CustomerTag',
      entityId: id,
      before: { name: before.name, color: before.color },
    });
  });
}

export async function assignTagToCustomer(userId: string, tagId: string, actorUserId: string) {
  assertNotLocalNode('Customer tagging');
  return prisma.$transaction(async (tx) => {
    const [user, tag] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } }),
      tx.customerTag.findUnique({ where: { id: tagId }, select: { id: true, name: true } }),
    ]);
    if (!user || user.deletedAt) throw new DomainError('not_found', 'not_found', 404);
    if (!tag) throw new DomainError('not_found', 'not_found', 404);

    // Idempotent: re-assigning the same tag is a silent no-op.
    const existing = await tx.customerTagAssignment.findUnique({
      where: { userId_tagId: { userId, tagId } },
      select: { id: true },
    });
    if (existing) return;

    await tx.customerTagAssignment.create({ data: { userId, tagId, assignedById: actorUserId } });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'User',
      entityId: userId,
      after: { tagAdded: tag.name },
    });
  });
}

export async function unassignTagFromCustomer(userId: string, tagId: string, actorUserId: string) {
  assertNotLocalNode('Customer tagging');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customerTagAssignment.findUnique({
      where: { userId_tagId: { userId, tagId } },
      include: { tag: { select: { name: true } } },
    });
    if (!existing) return; // already absent — no-op
    await tx.customerTagAssignment.delete({ where: { id: existing.id } });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'User',
      entityId: userId,
      after: { tagRemoved: existing.tag.name },
    });
  });
}
