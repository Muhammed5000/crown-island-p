import 'server-only';
import type { Prisma, Sanction, SanctionStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { enqueueById } from '@/server/sync/outbox';
import { DomainError } from './errors';
import {
  ADMIN_SETTLE_STATUSES,
  canTransitionSanction,
  isPendingLockLive,
  isValidSanctionAmount,
  sumSanctionCents,
} from './sanctions-core';

/**
 * User sanctions — admin-issued financial penalties that ride on the user's
 * next booking until paid, waived or cancelled.
 *
 * Money-safety invariants (enforced here, unit rules in ./sanctions-core.ts):
 *  - a sanction is CHARGED AT MOST ONCE: claims and settlements are
 *    conditional `updateMany` calls whose row counts are verified, so two
 *    concurrent bookings can never both carry the same sanction;
 *  - while a live PENDING_PAYMENT booking carries a sanction, admins cannot
 *    settle it by hand (the customer may be paying it right now);
 *  - settled sanctions are immutable history — only a full booking refund
 *    reactivates the ones that booking paid.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type PayableSanction = Pick<Sanction, 'id' | 'amountCents' | 'reason' | 'createdAt'> & {
  /** Stale pending lock observed at read time (released during claim). */
  stalePendingBookingId: string | null;
};

export interface PayableSanctionsResult {
  sanctions: PayableSanction[];
  totalCents: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selection — which sanctions are chargeable right now
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ACTIVE sanctions for a user that are free to be charged: either unreserved,
 * or reserved by a booking whose checkout is dead/stale (see isPendingLockLive).
 * Safe on a plain client for DISPLAY; claims must re-verify inside a tx.
 */
export async function getPayableSanctionsForUser(
  userId: string,
  db: Db = prisma,
): Promise<PayableSanctionsResult> {
  const now = new Date();
  const rows = await db.sanction.findMany({
    where: { userId, status: 'ACTIVE' },
    include: { pendingBooking: { select: { status: true, createdAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const payable = rows
    .filter((r) => !r.pendingBookingId || !isPendingLockLive(r.pendingBooking, now))
    .map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      reason: r.reason,
      createdAt: r.createdAt,
      stalePendingBookingId: r.pendingBookingId,
    }));
  return { sanctions: payable, totalCents: sumSanctionCents(payable) };
}

/**
 * Reception lookup: ACTIVE sanctions for the customer account matching a
 * normalised (E.164) guest phone. Returns null when no account matches.
 * Exposes only desk-safe fields — `notes` (admin-only) never leaves here.
 */
export async function getPayableSanctionsByPhone(phone: string) {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const user = await prisma.user.findUnique({
    where: { phone: trimmed },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return null;
  const { sanctions, totalCents } = await getPayableSanctionsForUser(user.id);
  return {
    userId: user.id,
    userName: user.name,
    totalCents,
    sanctions: sanctions.map((s) => ({
      id: s.id,
      amountCents: s.amountCents,
      reason: s.reason,
      createdAt: s.createdAt,
    })),
  };
}

export interface SanctionedGuestItem {
  amountCents: number;
  reason: string;
  createdAt: Date;
}

export interface SanctionedGuest {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Sum of this customer's ACTIVE sanctions. */
  totalCents: number;
  /** Number of ACTIVE sanctions. */
  count: number;
  items: SanctionedGuestItem[];
}

/**
 * Desk roster of customers who currently owe ACTIVE sanctions — biggest debt
 * first — optionally narrowed by a name / phone / email needle. Phone matching
 * is digit-only (leading zeros dropped) to survive formatting, exactly like the
 * reception booking search. Exposes only desk-safe fields; the admin-only
 * `notes` never leave this function. Backs the reception "Sanctions" quick-view.
 */
export async function listSanctionedGuests(search?: string, limit = 200): Promise<SanctionedGuest[]> {
  const q = (search ?? '').trim();
  const digits = q.replace(/\D/g, '').replace(/^0+/, '');
  const userWhere: Prisma.UserWhereInput = { deletedAt: null };
  if (q.length >= 2) {
    userWhere.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: digits.length >= 3 ? digits : q } },
    ];
  }

  const rows = await prisma.sanction.findMany({
    where: { status: 'ACTIVE', user: userWhere },
    select: {
      amountCents: true,
      reason: true,
      createdAt: true,
      user: { select: { id: true, name: true, phone: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });

  const byUser = new Map<string, SanctionedGuest>();
  for (const r of rows) {
    let g = byUser.get(r.user.id);
    if (!g) {
      g = { userId: r.user.id, name: r.user.name, phone: r.user.phone, email: r.user.email, totalCents: 0, count: 0, items: [] };
      byUser.set(r.user.id, g);
    }
    g.totalCents += r.amountCents;
    g.count += 1;
    g.items.push({ amountCents: r.amountCents, reason: r.reason, createdAt: r.createdAt });
  }

  return Array.from(byUser.values())
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking lifecycle hooks (all run INSIDE the caller's transaction)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically reserve the given payable sanctions for a booking. The caller
 * read them via getPayableSanctionsForUser INSIDE the same tx and already
 * priced them into the invoice — so if any row was claimed/settled in between,
 * the count check throws and the whole booking rolls back (client retries).
 */
export async function claimSanctionsForBooking(
  tx: Prisma.TransactionClient,
  sanctions: PayableSanction[],
  bookingId: string,
): Promise<void> {
  if (sanctions.length === 0) return;
  const staleIds = [
    ...new Set(sanctions.map((s) => s.stalePendingBookingId).filter((v): v is string => !!v)),
  ];
  const res = await tx.sanction.updateMany({
    where: {
      id: { in: sanctions.map((s) => s.id) },
      status: 'ACTIVE',
      OR: [{ pendingBookingId: null }, { pendingBookingId: { in: staleIds } }],
    },
    data: { pendingBookingId: bookingId },
  });
  if (res.count !== sanctions.length) {
    throw new DomainError(
      'Outstanding penalties changed while booking — please try again.',
      'sanctions_changed',
      409,
    );
  }
}

/**
 * Settle every sanction reserved by a booking after its payment SUCCEEDED.
 * Conditional on (pendingBookingId = booking, status = ACTIVE) so a stolen or
 * already-settled sanction is silently skipped — never double-marked.
 * `actorUserId` is null for the payment webhook (system) — audit shows that.
 */
export async function settleSanctionsForBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  actorUserId: string | null,
  settlementNote = 'Paid with booking',
): Promise<number> {
  const rows = await tx.sanction.findMany({
    where: { pendingBookingId: bookingId, status: 'ACTIVE' },
    select: { id: true, userId: true, amountCents: true },
  });
  // Returns the settled AMOUNT (cents), so a caller can detect an over-charge:
  // an invoice that priced a sanction in but, by payment time, no longer owns its
  // lock (a later booking reclaimed the stale lock) settles LESS than it charged.
  if (rows.length === 0) return 0;

  await tx.sanction.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, pendingBookingId: bookingId, status: 'ACTIVE' },
    data: {
      status: 'PAID',
      paidByBookingId: bookingId,
      pendingBookingId: null,
      settledById: actorUserId,
      settledAt: new Date(),
      settlementNote,
    },
  });

  for (const row of rows) {
    await audit(tx, {
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Sanction',
      entityId: row.id,
      before: { status: 'ACTIVE' },
      after: { status: 'PAID', paidByBookingId: bookingId, amountCents: row.amountCents },
    });
  }
  return rows.reduce((sum, r) => sum + r.amountCents, 0);
}

/**
 * Release a booking's sanction reservations (payment failed / booking
 * cancelled before payment). The sanctions stay ACTIVE and unreserved.
 */
export async function releaseSanctionsForBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  await tx.sanction.updateMany({
    where: { pendingBookingId: bookingId, status: 'ACTIVE' },
    data: { pendingBookingId: null },
  });
}

/**
 * A fully refunded booking returns the money — including the sanction part —
 * so the sanctions it settled come back to life as ACTIVE debts.
 */
export async function reactivateSanctionsForRefundedBooking(
  tx: Prisma.TransactionClient,
  bookingId: string,
  actorUserId: string | null,
): Promise<number> {
  const rows = await tx.sanction.findMany({
    where: { paidByBookingId: bookingId, status: 'PAID' },
    select: { id: true, amountCents: true },
  });
  if (rows.length === 0) return 0;

  await tx.sanction.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, paidByBookingId: bookingId, status: 'PAID' },
    data: {
      status: 'ACTIVE',
      paidByBookingId: null,
      pendingBookingId: null,
      settledById: null,
      settledAt: null,
      settlementNote: 'Reactivated — the booking that paid it was refunded',
    },
  });

  for (const row of rows) {
    await audit(tx, {
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Sanction',
      entityId: row.id,
      before: { status: 'PAID', paidByBookingId: bookingId },
      after: { status: 'ACTIVE', amountCents: row.amountCents, cause: 'booking_refunded' },
    });
  }
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin operations
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REASON = 500;
const MAX_NOTES = 1000;

function validateTexts(reason: string, notes: string | null) {
  if (reason.length < 3 || reason.length > MAX_REASON) {
    throw new DomainError(`Reason must be 3–${MAX_REASON} characters`, 'invalid_reason', 400);
  }
  if (notes && notes.length > MAX_NOTES) {
    throw new DomainError(`Notes must be at most ${MAX_NOTES} characters`, 'invalid_notes', 400);
  }
}

export async function adminCreateSanction(
  input: { userId: string; amountCents: number; reason: string; notes: string | null },
  actorUserId: string,
) {
  if (!isValidSanctionAmount(input.amountCents)) {
    throw new DomainError('Amount must be a positive whole amount', 'invalid_amount', 400);
  }
  const reason = input.reason.trim();
  const notes = input.notes?.trim() || null;
  validateTexts(reason, notes);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw new DomainError('Customer not found', 'user_not_found', 404);

  return prisma.$transaction(async (tx) => {
    const created = await tx.sanction.create({
      data: {
        userId: input.userId,
        amountCents: input.amountCents,
        reason,
        notes,
        createdById: actorUserId,
      },
    });
    await audit(tx, {
      actorUserId,
      action: 'CREATE',
      entityType: 'Sanction',
      entityId: created.id,
      after: { userId: input.userId, amountCents: input.amountCents, reason },
    });
    await enqueueById(tx, 'Sanction', created.id);
    return created;
  });
}

/** Edit amount/reason/notes — allowed only while ACTIVE and not mid-checkout. */
export async function adminUpdateSanction(
  id: string,
  input: { amountCents: number; reason: string; notes: string | null },
  actorUserId: string,
) {
  if (!isValidSanctionAmount(input.amountCents)) {
    throw new DomainError('Amount must be a positive whole amount', 'invalid_amount', 400);
  }
  const reason = input.reason.trim();
  const notes = input.notes?.trim() || null;
  validateTexts(reason, notes);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.sanction.findUnique({
      where: { id },
      include: { pendingBooking: { select: { status: true, createdAt: true } } },
    });
    if (!existing) throw new DomainError('Sanction not found', 'not_found', 404);
    if (existing.status !== 'ACTIVE') {
      throw new DomainError('Settled sanctions cannot be edited', 'sanction_settled', 409);
    }
    if (existing.pendingBookingId && isPendingLockLive(existing.pendingBooking)) {
      throw new DomainError(
        'This sanction is on a booking that is being paid right now — try again shortly.',
        'sanction_locked',
        409,
      );
    }

    const updated = await tx.sanction.update({
      where: { id },
      data: { amountCents: input.amountCents, reason, notes },
    });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'Sanction',
      entityId: id,
      before: { amountCents: existing.amountCents, reason: existing.reason },
      after: { amountCents: updated.amountCents, reason: updated.reason },
    });
    await enqueueById(tx, 'Sanction', id);
    return updated;
  });
}

/**
 * Admin settlement: ACTIVE → PAID (paid outside a booking) / WAIVED / CANCELLED.
 * Guarded by the transition table; blocked while a live checkout carries it.
 */
export async function adminSetSanctionStatus(
  id: string,
  to: SanctionStatus,
  settlementNote: string | null,
  actorUserId: string,
) {
  if (!(ADMIN_SETTLE_STATUSES as readonly SanctionStatus[]).includes(to)) {
    throw new DomainError('Invalid status', 'invalid_status', 400);
  }
  const note = settlementNote?.trim() || null;
  if (note && note.length > MAX_NOTES) {
    throw new DomainError('Note is too long', 'invalid_notes', 400);
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.sanction.findUnique({
      where: { id },
      include: { pendingBooking: { select: { status: true, createdAt: true } } },
    });
    if (!existing) throw new DomainError('Sanction not found', 'not_found', 404);
    if (!canTransitionSanction(existing.status, to)) {
      throw new DomainError(
        `A ${existing.status.toLowerCase()} sanction cannot become ${to.toLowerCase()}`,
        'invalid_transition',
        409,
      );
    }
    if (existing.pendingBookingId && isPendingLockLive(existing.pendingBooking)) {
      throw new DomainError(
        'This sanction is on a booking that is being paid right now — try again shortly.',
        'sanction_locked',
        409,
      );
    }

    // Conditional write — a concurrent webhook settling the same row loses
    // exactly one of the two races; whichever commits second sees 0 rows.
    const res = await tx.sanction.updateMany({
      where: { id, status: existing.status },
      data: {
        status: to,
        pendingBookingId: null,
        settledById: actorUserId,
        settledAt: new Date(),
        settlementNote: note,
      },
    });
    if (res.count !== 1) {
      throw new DomainError('Sanction changed concurrently — reload and retry', 'conflict', 409);
    }

    await audit(tx, {
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Sanction',
      entityId: id,
      before: { status: existing.status },
      after: { status: to, settlementNote: note },
    });
    await enqueueById(tx, 'Sanction', id);
    return tx.sanction.findUniqueOrThrow({ where: { id } });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin reads
// ─────────────────────────────────────────────────────────────────────────────

export interface SanctionView {
  id: string;
  userId: string;
  amountCents: number;
  reason: string;
  notes: string | null;
  status: SanctionStatus;
  createdAt: Date;
  settledAt: Date | null;
  settlementNote: string | null;
  createdByName: string | null;
  settledByName: string | null;
  paidByBookingId: string | null;
  paidByBookingReference: string | null;
  /** Live pending checkout currently carrying this sanction (admin info). */
  lockedByPendingBooking: boolean;
}

async function toViews(rows: Array<Sanction & { paidByBooking: { reference: string } | null; pendingBooking: { status: string; createdAt: Date } | null }>): Promise<SanctionView[]> {
  const actorIds = [
    ...new Set(rows.flatMap((r) => [r.createdById, r.settledById]).filter((v): v is string => !!v)),
  ];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const u = actors.find((a) => a.id === id);
    return u ? (u.name ?? u.email ?? id) : id;
  };
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    amountCents: r.amountCents,
    reason: r.reason,
    notes: r.notes,
    status: r.status,
    createdAt: r.createdAt,
    settledAt: r.settledAt,
    settlementNote: r.settlementNote,
    createdByName: nameOf(r.createdById),
    settledByName: nameOf(r.settledById),
    paidByBookingId: r.paidByBookingId,
    paidByBookingReference: r.paidByBooking?.reference ?? null,
    lockedByPendingBooking: !!r.pendingBookingId && isPendingLockLive(r.pendingBooking, now),
  }));
}

const VIEW_INCLUDE = {
  paidByBooking: { select: { reference: true } },
  pendingBooking: { select: { status: true, createdAt: true } },
} as const;

/** Full sanction history for one customer (admin profile card). */
export async function adminGetUserSanctions(userId: string) {
  const rows = await prisma.sanction.findMany({
    where: { userId },
    include: VIEW_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  const views = await toViews(rows);
  return {
    sanctions: views,
    activeTotalCents: sumSanctionCents(views.filter((v) => v.status === 'ACTIVE')),
    activeCount: views.filter((v) => v.status === 'ACTIVE').length,
  };
}

/** Global admin list, optionally filtered by status. */
export async function adminListSanctions(status?: SanctionStatus) {
  const rows = await prisma.sanction.findMany({
    where: status ? { status } : undefined,
    include: {
      ...VIEW_INCLUDE,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  const views = await toViews(rows);
  return rows.map((r, i) => ({ ...views[i]!, user: r.user }));
}

/** Set of user ids (from the given list) that carry ACTIVE sanctions. */
export async function userIdsWithActiveSanctions(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await prisma.sanction.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds }, status: 'ACTIVE' },
  });
  return new Set(rows.map((r) => r.userId));
}
