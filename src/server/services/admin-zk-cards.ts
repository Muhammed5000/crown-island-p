import 'server-only';
import { prisma } from '@/server/db/prisma';
import { auditStandalone } from '@/server/audit/audit';
import { enqueueById } from '@/server/sync/outbox';
import { DomainError } from './errors';

/**
 * Admin management of the ZKBio physical-card pool. Cards are claimed/released
 * automatically by the provisioner (`src/server/zk/provision.ts`); this is the
 * human side — registering the numbers the resort owns and retiring lost ones.
 */

export async function adminListZkCards() {
  return prisma.zkCard.findMany({
    orderBy: [{ isActive: 'desc' }, { assignedBookingId: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      cardNo: true,
      label: true,
      isActive: true,
      assignedBookingId: true,
      assignedAt: true,
      assignedBooking: {
        select: { reference: true, bookingDate: true, guestName: true, status: true },
      },
    },
  });
}

/** Summary counts for the header. */
export async function adminZkCardStats() {
  const [total, active, assigned] = await Promise.all([
    prisma.zkCard.count(),
    prisma.zkCard.count({ where: { isActive: true } }),
    prisma.zkCard.count({ where: { assignedBookingId: { not: null } } }),
  ]);
  return { total, active, assigned, free: active - assigned };
}

/**
 * Register a batch of card numbers. Duplicates (already in the pool) are skipped,
 * not errors — the result reports how many were actually added.
 */
export async function adminAddZkCards(
  input: { cardNos: string[]; label?: string | null },
  actorUserId: string,
): Promise<{ added: number; attempted: number }> {
  const cleaned = [...new Set(input.cardNos.map((s) => s.trim()).filter(Boolean))];
  if (cleaned.length === 0) throw new DomainError('no_cards', 'no_cards', 400);
  const label = input.label?.trim() || null;

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.zkCard.createMany({
      data: cleaned.map((cardNo) => ({ cardNo, label })),
      skipDuplicates: true,
    });
    // createMany returns no ids; re-read the rows for the submitted cardNos and
    // enqueue each (idempotent upsert snapshot — no-op unless APP_MODE=local).
    const rows = await tx.zkCard.findMany({
      where: { cardNo: { in: cleaned } },
      select: { id: true },
    });
    for (const row of rows) {
      await enqueueById(tx, 'ZkCard', row.id);
    }
    return created;
  });

  await auditStandalone({
    actorUserId,
    action: 'CREATE',
    entityType: 'ZkCard',
    after: { added: result.count, attempted: cleaned.length, label },
  });

  return { added: result.count, attempted: cleaned.length };
}

/** Retire (isActive=false) or re-activate a card. A retired card is never newly
 * claimed, but an already-assigned card keeps its binding until released. */
export async function adminSetZkCardActive(id: string, isActive: boolean, actorUserId: string) {
  const before = await prisma.zkCard.findUnique({ where: { id }, select: { id: true, isActive: true } });
  if (!before) throw new DomainError('not_found', 'not_found', 404);
  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.zkCard.update({ where: { id }, data: { isActive } });
    await enqueueById(tx, 'ZkCard', id);
    return updated;
  });
  await auditStandalone({
    actorUserId,
    action: 'UPDATE',
    entityType: 'ZkCard',
    entityId: id,
    before: { isActive: before.isActive },
    after: { isActive },
  });
  return after;
}

/** Permanently remove a card from the pool. Refused while it backs a booking. */
export async function adminDeleteZkCard(id: string, actorUserId: string) {
  const card = await prisma.zkCard.findUnique({
    where: { id },
    select: { id: true, cardNo: true, assignedBookingId: true },
  });
  if (!card) throw new DomainError('not_found', 'not_found', 404);
  if (card.assignedBookingId) throw new DomainError('card_in_use', 'card_in_use', 409);
  await prisma.$transaction(async (tx) => {
    await tx.zkCard.delete({ where: { id } });
    await enqueueById(tx, 'ZkCard', id, 'delete');
  });
  await auditStandalone({
    actorUserId,
    action: 'DELETE',
    entityType: 'ZkCard',
    entityId: id,
    before: { cardNo: card.cardNo },
  });
}
