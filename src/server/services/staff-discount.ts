import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type UserRole } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { computeDiscountCents } from './promo-core';
import { DomainError } from './errors';

/**
 * Manual reception discounts authorized by a staff PIN (supervisor override).
 *
 * Flow: at the desk a staffer enters a custom discount %. The system asks for
 * an authorizer's PIN; whoever's PIN it is must have a role whose ceiling
 * covers that %. The booking is then recorded as made BY the authorizer.
 *
 * PIN storage: a keyed HMAC (deterministic → a bare PIN can identify the
 * authorizer; unique constraint → no two staff share one). Low-entropy by
 * nature, so this is an operational convenience control, not a password.
 */

/** Roles whose ceiling is editable in the admin panel (the reception ladder). */
export const DISCOUNT_LADDER_ROLES: UserRole[] = ['STAFF', 'SUPERVISOR', 'MANAGER', 'DIRECTOR'];

/** Admin tiers always authorize up to 100%. */
const ADMIN_TIERS: ReadonlySet<UserRole> = new Set(['ADMIN', 'SUPER_ADMIN', 'DEVELOPER']);

/** Seed defaults used until a row is written (migration can't seed new enums). */
export const DEFAULT_ROLE_LIMITS: Record<string, number> = {
  STAFF: 10,
  SUPERVISOR: 25,
  MANAGER: 50,
  DIRECTOR: 100,
};

function pinSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set; cannot hash staff PINs');
  return s;
}

/** Keyed, deterministic HMAC of a desk PIN (hex). */
export function hashPin(pin: string): string {
  return createHmac('sha256', pinSecret()).update(pin).digest('hex');
}

/** Normalise a PIN to 4–8 digits, or throw a friendly error. */
export function normalizePin(raw: string): string {
  const pin = (raw ?? '').trim();
  if (!/^\d{4,8}$/.test(pin)) {
    throw new DomainError('PIN must be 4–8 digits', 'invalid_pin', 400);
  }
  return pin;
}

/** Effective max-discount ceiling for a role (admin rows override defaults). */
export async function getRoleMaxPercent(role: UserRole): Promise<number> {
  if (ADMIN_TIERS.has(role)) return 100;
  if (!DISCOUNT_LADDER_ROLES.includes(role)) return 0;
  const row = await prisma.roleDiscountLimit.findUnique({ where: { role } });
  const pct = row?.maxPercent ?? DEFAULT_ROLE_LIMITS[role] ?? 0;
  return Math.max(0, Math.min(100, pct));
}

/** All ladder ceilings (effective), for the admin config screen. */
export async function getRoleDiscountLimits(): Promise<{ role: UserRole; maxPercent: number; isDefault: boolean }[]> {
  const rows = await prisma.roleDiscountLimit.findMany({ where: { role: { in: DISCOUNT_LADDER_ROLES } } });
  const byRole = new Map(rows.map((r) => [r.role, r.maxPercent]));
  return DISCOUNT_LADDER_ROLES.map((role) => ({
    role,
    maxPercent: byRole.get(role) ?? DEFAULT_ROLE_LIMITS[role] ?? 0,
    isDefault: !byRole.has(role),
  }));
}

/** Admin: set a role's ceiling (audited). */
export async function setRoleDiscountLimit(role: UserRole, maxPercent: number, actorUserId: string) {
  if (!DISCOUNT_LADDER_ROLES.includes(role)) {
    throw new DomainError('That role is not configurable', 'invalid_role', 400);
  }
  if (!Number.isInteger(maxPercent) || maxPercent < 0 || maxPercent > 100) {
    throw new DomainError('Percentage must be 0–100', 'invalid_percent', 400);
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.roleDiscountLimit.findUnique({ where: { role } });
    const after = await tx.roleDiscountLimit.upsert({
      where: { role },
      create: { role, maxPercent, updatedById: actorUserId },
      update: { maxPercent, updatedById: actorUserId },
    });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'RoleDiscountLimit',
      entityId: after.id,
      before: before ? { role, maxPercent: before.maxPercent } : undefined,
      after: { role, maxPercent },
    });
    return after;
  });
}

/** Admin: set or clear a staff member's desk PIN (audited; never returns the PIN). */
export async function setStaffPin(userId: string, pin: string | null, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new DomainError('not_found', 'not_found', 404);

    const pinHash = pin === null ? null : hashPin(normalizePin(pin));
    try {
      await tx.user.update({ where: { id: userId }, data: { pinHash } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DomainError('That PIN is already in use', 'pin_taken', 409);
      }
      throw err;
    }
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'User',
      entityId: userId,
      after: { pinSet: pin !== null },
    });
  });
}

export interface DiscountAuthorizer {
  id: string;
  name: string;
  role: UserRole;
  maxPercent: number;
}

/**
 * Resolve a desk PIN to its authorizer + their ceiling. Throws if the PIN is
 * unknown, the holder isn't discount-capable, or their ceiling is 0. The lookup
 * is constant-time-ish (HMAC + unique index); a wrong PIN is indistinguishable
 * from a known-but-uncapped one only by the error code.
 */
export async function authorizeByPin(
  pinRaw: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<DiscountAuthorizer> {
  const pin = normalizePin(pinRaw);
  const target = hashPin(pin);
  const user = await tx.user.findUnique({
    where: { pinHash: target },
    select: { id: true, name: true, email: true, role: true, pinHash: true, deletedAt: true },
  });
  // Defensive constant-time compare even though the unique lookup already matched.
  if (!user || !user.pinHash || user.deletedAt) {
    throw new DomainError('PIN not recognised', 'pin_not_found', 404);
  }
  const a = Buffer.from(user.pinHash);
  const b = Buffer.from(target);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new DomainError('PIN not recognised', 'pin_not_found', 404);
  }

  const maxPercent = await getRoleMaxPercent(user.role);
  if (maxPercent <= 0) {
    throw new DomainError('This staff member cannot authorize discounts', 'not_authorized', 403);
  }
  return { id: user.id, name: user.name ?? user.email ?? 'Staff', role: user.role, maxPercent };
}

export interface ResolvedManualDiscount {
  authorizer: DiscountAuthorizer;
  percent: number;
  discountCents: number;
}

/**
 * Validate a manual discount inside a booking transaction: authorize the PIN,
 * clamp the % to the authorizer's ceiling, and compute the discount. Throws a
 * typed DomainError (rolls back the booking) on any failure.
 */
export async function resolveManualDiscount(
  tx: Prisma.TransactionClient,
  input: { pin: string; percent: number; subtotalCents: number },
): Promise<ResolvedManualDiscount> {
  const authorizer = await authorizeByPin(input.pin, tx);
  const percent = Math.trunc(input.percent);
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    throw new DomainError('Discount must be 1–100%', 'invalid_percent', 400);
  }
  if (percent > authorizer.maxPercent) {
    throw new DomainError(
      `${authorizer.role} can authorize at most ${authorizer.maxPercent}%`,
      'over_role_cap',
      403,
    );
  }
  return { authorizer, percent, discountCents: computeDiscountCents(input.subtotalCents, percent) };
}
