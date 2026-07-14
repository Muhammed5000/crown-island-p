import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { assertNotLocalNode } from '@/server/sync/node-guard';
import { normalizeCode } from './promo-core';
import { DomainError } from './errors';

/**
 * Admin CRUD for promo codes. Create/toggle/delete are audited; delete is
 * refused once a code has been redeemed (deactivate instead, to keep history).
 */

export interface PromoInput {
  code: string;
  description?: string | null;
  percentOff: number;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxRedemptions?: number | null;
  /** When false, the same customer phone may redeem the code repeatedly. Default true. */
  oncePerCustomer?: boolean;
}

export async function adminListPromos() {
  return prisma.promoCode.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { redemptions: true } } },
  });
}

export async function adminCreatePromo(data: PromoInput, actorUserId: string) {
  assertNotLocalNode('Promo codes');
  const code = normalizeCode(data.code);
  if (code.length < 2 || code.length > 40) {
    throw new DomainError('Code must be 2–40 characters', 'invalid_code', 400);
  }
  if (!Number.isInteger(data.percentOff) || data.percentOff < 1 || data.percentOff > 100) {
    throw new DomainError('Percentage must be 1–100', 'invalid_percent', 400);
  }
  if (data.startsAt && data.endsAt && data.endsAt.getTime() < data.startsAt.getTime()) {
    throw new DomainError('End date is before start date', 'invalid_window', 400);
  }
  if (data.maxRedemptions != null && (!Number.isInteger(data.maxRedemptions) || data.maxRedemptions < 1)) {
    throw new DomainError('Max redemptions must be a positive whole number', 'invalid_max', 400);
  }

  return prisma.$transaction(async (tx) => {
    let created;
    try {
      created = await tx.promoCode.create({
        data: {
          code,
          description: data.description ?? null,
          percentOff: data.percentOff,
          isActive: data.isActive ?? true,
          startsAt: data.startsAt ?? null,
          endsAt: data.endsAt ?? null,
          maxRedemptions: data.maxRedemptions ?? null,
          oncePerCustomer: data.oncePerCustomer ?? true,
          createdById: actorUserId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DomainError('A code with that name already exists', 'code_taken', 409);
      }
      throw err;
    }

    await audit(tx, {
      actorUserId,
      action: 'CREATE',
      entityType: 'PromoCode',
      entityId: created.id,
      after: { code: created.code, percentOff: created.percentOff, maxRedemptions: created.maxRedemptions, oncePerCustomer: created.oncePerCustomer },
    });
    return created;
  });
}

export async function adminTogglePromo(id: string, actorUserId: string) {
  assertNotLocalNode('Promo codes');
  return prisma.$transaction(async (tx) => {
    const before = await tx.promoCode.findUnique({ where: { id } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);

    const after = await tx.promoCode.update({
      where: { id },
      data: { isActive: !before.isActive },
    });
    await audit(tx, {
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'PromoCode',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    });
    return after;
  });
}

export async function adminDeletePromo(id: string, actorUserId: string) {
  assertNotLocalNode('Promo codes');
  return prisma.$transaction(async (tx) => {
    const before = await tx.promoCode.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    // Preserve redemption history — a used code must be deactivated, not deleted.
    if (before._count.redemptions > 0) {
      throw new DomainError('This code has been used — deactivate it instead', 'has_redemptions', 409);
    }

    await tx.promoCode.delete({ where: { id } });
    await audit(tx, {
      actorUserId,
      action: 'DELETE',
      entityType: 'PromoCode',
      entityId: id,
      before: { code: before.code, percentOff: before.percentOff },
    });
  });
}
