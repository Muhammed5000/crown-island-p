import 'server-only';
import {
  Prisma,
  type OpsTicketPriority,
  type OpsTicketStatus,
  type OpsTicketType,
  type UserRole,
} from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { enqueueById } from '@/server/sync/outbox';
import { audit } from '@/server/audit/audit';
import { generateOpsReference } from '@/lib/reference';
import { canManageOps, isOpsOperator, OPS_ASSIGNABLE_ROLES, OPS_MANAGER_ROLES } from '@/server/auth/roles';
import { DomainError } from './errors';
import { validateProofUrl } from './guest-id';
import { canTransition, isOpenStatus, OPS_OPEN_STATUSES, workerMayTarget } from './ops-transitions';

/**
 * Housekeeping & Maintenance ticket system (the `/gate/ops` staff desk).
 *
 * Design notes:
 *  - Every mutation runs in a transaction, appends `OpsTicketEvent` rows (the
 *    per-ticket activity timeline) and writes the global `AuditLog` for the
 *    important ones, mirroring the rest of the codebase.
 *  - In-app notifications are plain `StaffNotification` rows fanned out to the
 *    relevant staff; the desk polls them (no realtime infra exists on purpose).
 *  - Out-of-service integration: `admin-places.ts` calls the
 *    `opsOnPlaceOutOfService` / `opsOnPlaceBackInService` hooks inside ITS
 *    transactions, so a scheduled outage or an offline flip auto-creates (or
 *    annotates) an OUT_OF_SERVICE ticket and notifies the departments.
 *    `returnPlaceToService` re-implements the place-reactivation bookkeeping
 *    inline (same semantics as admin-places) instead of importing it — the
 *    import must stay one-directional (admin-places → ops-tickets) to avoid a
 *    cycle.
 *  - Visibility: managers (MANAGER / DIRECTOR / admin tiers) see everything;
 *    HOUSEKEEPING / MAINTENANCE see their own tickets plus the UNASSIGNED pool
 *    of their department (so they can claim work); every other gate role
 *    (reception ladder, SECURITY) sees only tickets they created or were
 *    assigned. Enforced in `viewerScope` for lists and `assertCanView` for
 *    single-ticket access.
 */

type TxOrClient = Prisma.TransactionClient | typeof prisma;

export interface OpsViewer {
  id: string;
  role: UserRole;
}

/** Ticket types each ops department works (used for pools + notifications). */
const DEPT_TYPES: Record<'HOUSEKEEPING' | 'MAINTENANCE', OpsTicketType[]> = {
  HOUSEKEEPING: ['HOUSEKEEPING', 'CLEANING', 'INSPECTION', 'OTHER'],
  MAINTENANCE: ['MAINTENANCE', 'REPAIR', 'OUT_OF_SERVICE', 'OTHER'],
};

/** Which department roles should be notified about a ticket of this type. */
function deptRolesForType(type: OpsTicketType): UserRole[] {
  const roles: UserRole[] = [];
  if (DEPT_TYPES.HOUSEKEEPING.includes(type)) roles.push('HOUSEKEEPING');
  if (DEPT_TYPES.MAINTENANCE.includes(type)) roles.push('MAINTENANCE');
  return roles;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type OpsNotificationKind =
  | 'out_of_service'
  | 'ticket_created'
  | 'assigned'
  | 'status'
  | 'priority'
  | 'overdue'
  | 'completed'
  | 'reopened'
  | 'returned_to_service'
  | 'note';

/** Create one notification row per recipient (deduped, actor excluded). */
async function notifyUsers(
  tx: TxOrClient,
  userIds: string[],
  input: { kind: OpsNotificationKind; title: string; body?: string | null; ticketId?: string | null; excludeUserId?: string },
) {
  const unique = Array.from(new Set(userIds)).filter((id) => id && id !== input.excludeUserId);
  if (unique.length === 0) return;
  await tx.staffNotification.createMany({
    data: unique.map((userId) => ({
      userId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      ticketId: input.ticketId ?? null,
    })),
  });
}

/** Active (not deleted / blocked) staff user ids holding any of `roles`. */
async function staffIdsByRole(tx: TxOrClient, roles: UserRole[]): Promise<string[]> {
  if (roles.length === 0) return [];
  const rows = await tx.user.findMany({
    where: { role: { in: roles }, deletedAt: null, blockedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Department staff + ops managers for a ticket type — the default audience. */
async function audienceForTicket(tx: TxOrClient, type: OpsTicketType): Promise<string[]> {
  return staffIdsByRole(tx, [...deptRolesForType(type), ...OPS_MANAGER_ROLES]);
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

const ticketInclude = {
  place: {
    select: {
      id: true,
      label: true,
      isActive: true,
      service: { select: { nameEn: true } },
      // Whole outage list (small per place) — `toRow` computes "down right now"
      // in JS because this constant can't embed a fresh `new Date()`.
      outages: { select: { startsAt: true, endsAt: true } },
    },
  },
  booking: { select: { id: true, reference: true } },
  createdBy: { select: { id: true, name: true, email: true, role: true } },
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.OpsTicketInclude;

type TicketWithRefs = Prisma.OpsTicketGetPayload<{ include: typeof ticketInclude }>;

export interface OpsTicketRow {
  id: string;
  reference: string;
  type: OpsTicketType;
  priority: OpsTicketPriority;
  status: OpsTicketStatus;
  title: string;
  placeId: string | null;
  placeLabel: string | null;
  placeOnline: boolean | null;
  /** True when the place has an outage window covering "now". */
  placeOutNow: boolean;
  serviceName: string | null;
  bookingReference: string | null;
  createdById: string;
  createdByName: string;
  assignedToId: string | null;
  assignedToName: string | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
}

export interface OpsTicketEventRow {
  id: string;
  kind: string;
  actorName: string | null;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  imageUrl: string | null;
  createdAt: string;
}

export interface OpsTicketDetail extends OpsTicketRow {
  description: string | null;
  resolutionNotes: string | null;
  events: OpsTicketEventRow[];
}

function displayName(u: { name: string | null; email: string | null } | null | undefined): string {
  return u?.name ?? u?.email ?? 'Staff';
}

/** Compact UTC stamp for notification / timeline copy, e.g. "2026-06-11 14:00 UTC". */
function fmtUntil(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function toRow(t: TicketWithRefs, now: number): OpsTicketRow {
  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    priority: t.priority,
    status: t.status,
    title: t.title,
    placeId: t.placeId,
    placeLabel: t.place?.label ?? null,
    placeOnline: t.place ? t.place.isActive : null,
    placeOutNow:
      t.place?.outages.some((o) => o.startsAt.getTime() <= now && o.endsAt.getTime() > now) ?? false,
    serviceName: t.place?.service.nameEn ?? null,
    bookingReference: t.booking?.reference ?? null,
    createdById: t.createdById,
    createdByName: displayName(t.createdBy),
    assignedToId: t.assignedToId,
    assignedToName: t.assignedTo ? displayName(t.assignedTo) : null,
    dueAt: t.dueAt?.toISOString() ?? null,
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    overdue: !!t.dueAt && t.dueAt.getTime() < now && isOpenStatus(t.status),
  };
}

// ─── Visibility ───────────────────────────────────────────────────────────────

/** Extra where-clause limiting what a non-manager viewer can see (null = all). */
function viewerScope(viewer: OpsViewer): Prisma.OpsTicketWhereInput | null {
  if (canManageOps(viewer.role)) return null;
  const mine: Prisma.OpsTicketWhereInput[] = [
    { assignedToId: viewer.id },
    { createdById: viewer.id },
  ];
  // Department staff also see the unassigned pool of their ticket types so
  // they can claim work without waiting for a manager.
  if (viewer.role === 'HOUSEKEEPING' || viewer.role === 'MAINTENANCE') {
    mine.push({ assignedToId: null, type: { in: DEPT_TYPES[viewer.role] } });
  }
  return { OR: mine };
}

async function loadTicketOrThrow(tx: TxOrClient, id: string): Promise<TicketWithRefs> {
  const t = await tx.opsTicket.findUnique({ where: { id }, include: ticketInclude });
  if (!t) throw new DomainError('not_found', 'not_found', 404);
  return t;
}

function assertCanView(viewer: OpsViewer, t: TicketWithRefs): void {
  if (canManageOps(viewer.role)) return;
  if (t.assignedToId === viewer.id || t.createdById === viewer.id) return;
  if (
    (viewer.role === 'HOUSEKEEPING' || viewer.role === 'MAINTENANCE') &&
    t.assignedToId === null &&
    DEPT_TYPES[viewer.role].includes(t.type)
  ) {
    return;
  }
  throw new DomainError('forbidden', 'forbidden', 403);
}

// ─── Listing, summary, detail ─────────────────────────────────────────────────

export interface OpsListFilters {
  status?: OpsTicketStatus | 'OPEN_ALL';
  priority?: OpsTicketPriority;
  type?: OpsTicketType;
  /** 'me' | 'unassigned' | a user id. */
  assignee?: string;
  createdById?: string;
  placeId?: string;
  q?: string;
  overdueOnly?: boolean;
  /** Only tickets on places that are currently out of service / offline. */
  outOnly?: boolean;
  dateFrom?: string; // ISO date (createdAt >=)
  dateTo?: string; // ISO date (createdAt < next day)
  sort?: 'newest' | 'oldest' | 'priority' | 'due' | 'updated' | 'status';
  limit?: number;
}

export async function listOpsTickets(
  viewer: OpsViewer,
  filters: OpsListFilters = {},
): Promise<OpsTicketRow[]> {
  const now = Date.now();
  const and: Prisma.OpsTicketWhereInput[] = [];
  const scope = viewerScope(viewer);
  if (scope) and.push(scope);

  if (filters.status === 'OPEN_ALL') and.push({ status: { in: OPS_OPEN_STATUSES } });
  else if (filters.status) and.push({ status: filters.status });
  if (filters.priority) and.push({ priority: filters.priority });
  if (filters.type) and.push({ type: filters.type });
  if (filters.assignee === 'me') and.push({ assignedToId: viewer.id });
  else if (filters.assignee === 'unassigned') and.push({ assignedToId: null });
  else if (filters.assignee) and.push({ assignedToId: filters.assignee });
  if (filters.createdById) and.push({ createdById: filters.createdById });
  if (filters.placeId) and.push({ placeId: filters.placeId });
  if (filters.overdueOnly) {
    and.push({ dueAt: { lt: new Date(now) }, status: { in: OPS_OPEN_STATUSES } });
  }
  if (filters.outOnly) {
    const nowDate = new Date(now);
    and.push({
      place: {
        OR: [
          { isActive: false },
          { outages: { some: { startsAt: { lte: nowDate }, endsAt: { gt: nowDate } } } },
        ],
      },
    });
  }
  if (filters.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom)) {
    and.push({ createdAt: { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } });
  }
  if (filters.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) {
    const end = new Date(`${filters.dateTo}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    and.push({ createdAt: { lt: end } });
  }
  const q = filters.q?.trim();
  if (q && q.length >= 2) {
    and.push({
      OR: [
        { reference: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { resolutionNotes: { contains: q, mode: 'insensitive' } },
        { place: { label: { contains: q, mode: 'insensitive' } } },
        { assignedTo: { name: { contains: q, mode: 'insensitive' } } },
        { createdBy: { name: { contains: q, mode: 'insensitive' } } },
        { events: { some: { note: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }

  const orderBy: Prisma.OpsTicketOrderByWithRelationInput[] =
    filters.sort === 'oldest'
      ? [{ createdAt: 'asc' }]
      : filters.sort === 'priority'
        ? [{ priority: 'desc' }, { createdAt: 'desc' }]
        : filters.sort === 'due'
          ? [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]
          : filters.sort === 'updated'
            ? [{ updatedAt: 'desc' }]
            : filters.sort === 'status'
              ? [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }]
              : [{ createdAt: 'desc' }];

  const rows = await prisma.opsTicket.findMany({
    where: and.length ? { AND: and } : undefined,
    include: ticketInclude,
    orderBy,
    take: Math.min(Math.max(filters.limit ?? 200, 1), 500),
  });
  return rows.map((t) => toRow(t, now));
}

export interface OpsSummary {
  open: number;
  urgent: number;
  overdue: number;
  completedToday: number;
  assignedToMe: number;
  housekeepingOpen: number;
  maintenanceOpen: number;
  outOfServiceUnits: number;
}

export async function getOpsSummary(viewer: OpsViewer): Promise<OpsSummary> {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const scope = viewerScope(viewer);
  const base: Prisma.OpsTicketWhereInput[] = scope ? [scope] : [];
  const open = { status: { in: OPS_OPEN_STATUSES } } as const;

  const [openCount, urgent, overdue, completedToday, mine, hkOpen, mntOpen, outUnits] =
    await Promise.all([
      prisma.opsTicket.count({ where: { AND: [...base, open] } }),
      prisma.opsTicket.count({ where: { AND: [...base, open, { priority: 'URGENT' }] } }),
      prisma.opsTicket.count({ where: { AND: [...base, open, { dueAt: { lt: now } }] } }),
      prisma.opsTicket.count({ where: { AND: [...base, { completedAt: { gte: dayStart } }] } }),
      prisma.opsTicket.count({ where: { AND: [open, { assignedToId: viewer.id }] } }),
      prisma.opsTicket.count({
        where: { AND: [...base, open, { type: { in: ['HOUSEKEEPING', 'CLEANING', 'INSPECTION'] } }] },
      }),
      prisma.opsTicket.count({
        where: { AND: [...base, open, { type: { in: ['MAINTENANCE', 'REPAIR', 'OUT_OF_SERVICE'] } }] },
      }),
      prisma.servicePlace.count({
        where: {
          OR: [
            { isActive: false },
            { outages: { some: { startsAt: { lte: now }, endsAt: { gt: now } } } },
          ],
        },
      }),
    ]);

  return {
    open: openCount,
    urgent,
    overdue,
    completedToday,
    assignedToMe: mine,
    housekeepingOpen: hkOpen,
    maintenanceOpen: mntOpen,
    outOfServiceUnits: outUnits,
  };
}

export async function getOpsTicket(viewer: OpsViewer, id: string): Promise<OpsTicketDetail> {
  const t = await loadTicketOrThrow(prisma, id);
  assertCanView(viewer, t);
  const events = await prisma.opsTicketEvent.findMany({
    where: { ticketId: id },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    ...toRow(t, Date.now()),
    description: t.description,
    resolutionNotes: t.resolutionNotes,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      actorName: e.actor ? displayName(e.actor) : null,
      fromValue: e.fromValue,
      toValue: e.toValue,
      note: e.note,
      imageUrl: e.imageUrl,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateOpsTicketInput {
  type: OpsTicketType;
  priority?: OpsTicketPriority;
  title: string;
  description?: string | null;
  placeId?: string | null;
  bookingId?: string | null;
  assignedToId?: string | null;
  dueAt?: Date | null;
  /**
   * Take the ticket's cell OUT OF SERVICE from now until this instant. Creates
   * a real `PlaceOutage` (+ history log) inside the same transaction, so the
   * cell immediately stops being bookable/assignable exactly like downtime
   * scheduled from the admin panel. Requires `placeId`; any ops OPERATOR
   * (every ops-desk role except SECURITY) may take a cell down.
   */
  outOfServiceUntil?: Date | null;
}

export async function createOpsTicket(
  input: CreateOpsTicketInput,
  actor: OpsViewer,
): Promise<{ id: string; reference: string }> {
  const title = input.title.trim();
  if (title.length < 3) throw new DomainError('invalid_input', 'invalid_input', 400);
  // Any operator (ops-desk role except SECURITY) may pre-assign at creation;
  // SECURITY reports unassigned only.
  if (input.assignedToId && !isOpsOperator(actor.role) && input.assignedToId !== actor.id) {
    throw new DomainError('forbidden', 'forbidden', 403);
  }
  // Out-of-service window: validated up-front (cheap, no tx churn).
  if (input.outOfServiceUntil) {
    if (!input.placeId) throw new DomainError('invalid_input', 'no_place', 400);
    if (!isOpsOperator(actor.role)) {
      throw new DomainError('forbidden', 'forbidden', 403);
    }
    if (
      Number.isNaN(input.outOfServiceUntil.getTime()) ||
      input.outOfServiceUntil.getTime() <= Date.now()
    ) {
      throw new DomainError('invalid_range', 'invalid_range', 400);
    }
  }

  return prisma.$transaction(async (tx) => {
    let placeLabel: string | null = null;
    if (input.placeId) {
      const place = await tx.servicePlace.findUnique({
        where: { id: input.placeId },
        select: { id: true, label: true },
      });
      if (!place) throw new DomainError('not_found', 'place_not_found', 404);
      placeLabel = place.label;
    }
    if (input.bookingId) {
      const booking = await tx.booking.findUnique({ where: { id: input.bookingId }, select: { id: true } });
      if (!booking) throw new DomainError('not_found', 'booking_not_found', 404);
    }
    let assignee: { id: string; name: string | null; email: string | null } | null = null;
    if (input.assignedToId) {
      const u = await tx.user.findFirst({
        where: {
          id: input.assignedToId,
          deletedAt: null,
          blockedAt: null,
          role: { in: [...OPS_ASSIGNABLE_ROLES] },
        },
        select: { id: true, name: true, email: true },
      });
      if (!u) throw new DomainError('invalid_input', 'invalid_assignee', 400);
      assignee = u;
    }

    // Reference collisions are vanishingly rare (32^4/day) — retry once.
    let created;
    for (let attempt = 0; ; attempt++) {
      try {
        created = await tx.opsTicket.create({
          data: {
            reference: generateOpsReference(),
            type: input.type,
            priority: input.priority ?? 'MEDIUM',
            status: assignee ? 'ASSIGNED' : 'NEW',
            title,
            description: input.description?.trim() || null,
            placeId: input.placeId ?? null,
            bookingId: input.bookingId ?? null,
            createdById: actor.id,
            assignedToId: assignee?.id ?? null,
            dueAt: input.dueAt ?? null,
          },
        });
        break;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2) continue;
        throw err;
      }
    }

    const createdEvent = await tx.opsTicketEvent.create({
      data: { ticketId: created.id, kind: 'CREATED', actorId: actor.id, toValue: created.status },
    });
    await enqueueById(tx, 'OpsTicketEvent', createdEvent.id);
    if (assignee) {
      const assignedEvent = await tx.opsTicketEvent.create({
        data: { ticketId: created.id, kind: 'ASSIGNED', actorId: actor.id, toValue: displayName(assignee) },
      });
      await enqueueById(tx, 'OpsTicketEvent', assignedEvent.id);
    }

    // Take the cell out of service for the requested window — a REAL
    // PlaceOutage + history log, identical bookkeeping to admin-scheduled
    // downtime, so reception/gate/booking availability all react immediately.
    // Linked via `outageId`; the admin-places hook is NOT involved here (it
    // would open a second ticket for the same downtime).
    let outageNote: string | null = null;
    if (input.outOfServiceUntil && input.placeId) {
      const startsAt = new Date();
      const outage = await tx.placeOutage.create({
        data: {
          placeId: input.placeId,
          startsAt,
          endsAt: input.outOfServiceUntil,
          reason: `${created.reference} · ${title}`.slice(0, 200),
          createdById: actor.id,
        },
      });
      await enqueueById(tx, 'PlaceOutage', outage.id);
      const outageLog = await tx.placeOutageLog.create({
        data: {
          placeId: outage.placeId,
          outageId: outage.id,
          kind: 'OUTAGE',
          startsAt: outage.startsAt,
          endsAt: outage.endsAt,
          reason: outage.reason,
          createdById: actor.id,
        },
      });
      await enqueueById(tx, 'PlaceOutageLog', outageLog.id);
      await tx.opsTicket.update({ where: { id: created.id }, data: { outageId: outage.id } });
      outageNote = `out of service until ${fmtUntil(input.outOfServiceUntil)}`;
      const outageNoteEvent = await tx.opsTicketEvent.create({
        data: {
          ticketId: created.id,
          kind: 'NOTE',
          actorId: actor.id,
          note: `${placeLabel ?? 'Place'} taken ${outageNote}.`,
        },
      });
      await enqueueById(tx, 'OpsTicketEvent', outageNoteEvent.id);
      await audit(tx, {
        actorUserId: actor.id,
        action: 'CREATE',
        entityType: 'PlaceOutage',
        entityId: outage.id,
        after: { ...outage, viaOpsTicket: created.id },
      });
    }

    const audience = await audienceForTicket(tx, input.type);
    await notifyUsers(tx, audience, {
      kind: outageNote ? 'out_of_service' : 'ticket_created',
      title: outageNote
        ? `${placeLabel ?? 'Place'} is out of service · ${created.reference}`
        : `New ${input.type.toLowerCase().replace(/_/g, ' ')} ticket · ${created.reference}`,
      body: outageNote ? `${title} · ${outageNote}` : title,
      ticketId: created.id,
      excludeUserId: actor.id,
    });
    if (assignee) {
      await notifyUsers(tx, [assignee.id], {
        kind: 'assigned',
        title: `Assigned to you · ${created.reference}`,
        body: title,
        ticketId: created.id,
        excludeUserId: actor.id,
      });
    }

    await enqueueById(tx, 'OpsTicket', created.id);
    await audit(tx, {
      actorUserId: actor.id,
      action: 'CREATE',
      entityType: 'OpsTicket',
      entityId: created.id,
      after: created,
    });
    return { id: created.id, reference: created.reference };
  });
}

// ─── Assignment ───────────────────────────────────────────────────────────────

export async function assignOpsTicket(
  input: { ticketId: string; assigneeId: string | null },
  actor: OpsViewer,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await loadTicketOrThrow(tx, input.ticketId);
    if (!isOpenStatus(t.status)) throw new DomainError('invalid_transition', 'ticket_closed', 409);

    // Managers may (re)assign anything; any other OPERATOR (ops-desk role
    // except SECURITY) may route a ticket they can already see — their own
    // created/assigned tickets, or (dept staff) the unassigned pool. The
    // audit trail + ASSIGNED event keep accountability.
    if (!canManageOps(actor.role)) {
      if (!isOpsOperator(actor.role)) throw new DomainError('forbidden', 'forbidden', 403);
      assertCanView(actor, t);
    }

    let assignee: { id: string; name: string | null; email: string | null } | null = null;
    if (input.assigneeId) {
      const u = await tx.user.findFirst({
        where: {
          id: input.assigneeId,
          deletedAt: null,
          blockedAt: null,
          role: { in: [...OPS_ASSIGNABLE_ROLES] },
        },
        select: { id: true, name: true, email: true },
      });
      if (!u) throw new DomainError('invalid_input', 'invalid_assignee', 400);
      assignee = u;
    }

    // Assignment nudges the status with it: gaining an assignee moves a
    // NEW/OPEN/REOPENED ticket to ASSIGNED; losing one moves ASSIGNED → OPEN.
    const nextStatus: OpsTicketStatus = assignee
      ? t.status === 'NEW' || t.status === 'OPEN' || t.status === 'REOPENED'
        ? 'ASSIGNED'
        : t.status
      : t.status === 'ASSIGNED'
        ? 'OPEN'
        : t.status;

    await tx.opsTicket.update({
      where: { id: t.id },
      data: { assignedToId: assignee?.id ?? null, status: nextStatus },
    });
    await enqueueById(tx, 'OpsTicket', t.id);
    const assignEvent = await tx.opsTicketEvent.create({
      data: {
        ticketId: t.id,
        kind: assignee ? 'ASSIGNED' : 'UNASSIGNED',
        actorId: actor.id,
        fromValue: t.assignedTo ? displayName(t.assignedTo) : null,
        toValue: assignee ? displayName(assignee) : null,
      },
    });
    await enqueueById(tx, 'OpsTicketEvent', assignEvent.id);
    if (nextStatus !== t.status) {
      const statusEvent = await tx.opsTicketEvent.create({
        data: { ticketId: t.id, kind: 'STATUS', actorId: actor.id, fromValue: t.status, toValue: nextStatus },
      });
      await enqueueById(tx, 'OpsTicketEvent', statusEvent.id);
    }
    if (assignee && assignee.id !== actor.id) {
      await notifyUsers(tx, [assignee.id], {
        kind: 'assigned',
        title: `Assigned to you · ${t.reference}`,
        body: t.title,
        ticketId: t.id,
      });
    }
    await audit(tx, {
      actorUserId: actor.id,
      action: 'UPDATE',
      entityType: 'OpsTicket',
      entityId: t.id,
      before: { assignedToId: t.assignedToId, status: t.status },
      after: { assignedToId: assignee?.id ?? null, status: nextStatus },
    });
  });
}

// ─── Status / priority / due date ─────────────────────────────────────────────

export async function setOpsStatus(
  input: {
    ticketId: string;
    to: OpsTicketStatus;
    note?: string | null;
    resolutionNotes?: string | null;
    /** Completion proof photo (`/uploads/…` URL) — REQUIRED when the assignee completes. */
    proofImageUrl?: string | null;
  },
  actor: OpsViewer,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await loadTicketOrThrow(tx, input.ticketId);

    const isManager = canManageOps(actor.role);
    const isWorker = t.assignedToId === actor.id && workerMayTarget(input.to);
    // The reporter may cancel their own ticket while nobody has picked it up.
    const isReporterCancel =
      t.createdById === actor.id &&
      input.to === 'CANCELLED' &&
      t.assignedToId === null &&
      (t.status === 'NEW' || t.status === 'OPEN');
    if (!isManager && !isWorker && !isReporterCancel) {
      throw new DomainError('forbidden', 'forbidden', 403);
    }
    if (!canTransition(t.status, input.to)) {
      throw new DomainError('invalid_transition', 'invalid_transition', 409);
    }

    // Completion always requires resolution notes — what was actually done.
    const resolution = input.resolutionNotes?.trim() || t.resolutionNotes;
    if (input.to === 'COMPLETED' && !resolution) {
      throw new DomainError('resolution_required', 'resolution_required', 400);
    }
    // The assigned worker ending THEIR task must attach a completion photo
    // (proof of work). Managers completing on someone's behalf are exempt.
    const proofImageUrl = input.proofImageUrl?.trim() || null;
    if (input.to === 'COMPLETED' && t.assignedToId === actor.id && !proofImageUrl) {
      throw new DomainError('proof_required', 'proof_required', 400);
    }
    // Re-validate the completion-proof attachment server-side (stored-XSS guard):
    // it must be a real upload-route URL, never a javascript:/external/junk string.
    if (input.to === 'COMPLETED' && proofImageUrl) await validateProofUrl(proofImageUrl);

    const now = new Date();
    await tx.opsTicket.update({
      where: { id: t.id },
      data: {
        status: input.to,
        startedAt: input.to === 'IN_PROGRESS' && !t.startedAt ? now : t.startedAt,
        completedAt: input.to === 'COMPLETED' ? now : input.to === 'REOPENED' ? null : t.completedAt,
        resolutionNotes: input.to === 'COMPLETED' ? resolution : t.resolutionNotes,
      },
    });
    await enqueueById(tx, 'OpsTicket', t.id);
    const statusEvent = await tx.opsTicketEvent.create({
      data: {
        ticketId: t.id,
        kind: 'STATUS',
        actorId: actor.id,
        fromValue: t.status,
        toValue: input.to,
        note: input.note?.trim() || (input.to === 'COMPLETED' ? resolution : null),
        imageUrl: input.to === 'COMPLETED' ? proofImageUrl : null,
      },
    });
    await enqueueById(tx, 'OpsTicketEvent', statusEvent.id);

    // Completing a ticket on a cell that is currently DOWN brings it back to
    // service automatically — the work is done, so the downtime ends with it.
    let returnedLabel: string | null = null;
    if (input.to === 'COMPLETED' && t.placeId && t.place) {
      const liveNow = t.place.outages.some(
        (o) => o.startsAt.getTime() <= now.getTime() && o.endsAt.getTime() > now.getTime(),
      );
      if (!t.place.isActive || liveNow) {
        await reactivatePlaceCore(tx, t.placeId, actor.id);
        returnedLabel = t.place.label;
        const returnedEvent = await tx.opsTicketEvent.create({
          data: {
            ticketId: t.id,
            kind: 'RETURNED_TO_SERVICE',
            actorId: actor.id,
            toValue: t.place.label,
            note: 'Returned automatically on completion.',
          },
        });
        await enqueueById(tx, 'OpsTicketEvent', returnedEvent.id);
        await audit(tx, {
          actorUserId: actor.id,
          action: 'UPDATE',
          entityType: 'ServicePlace',
          entityId: t.placeId,
          before: { isActive: t.place.isActive, downtime: true },
          after: { isActive: true, downtime: false, viaOpsTicketCompletion: t.id },
        });
      }
    }

    const audience = new Set<string>([t.createdById]);
    if (t.assignedToId) audience.add(t.assignedToId);
    if (input.to === 'COMPLETED' || input.to === 'REOPENED') {
      for (const id of await staffIdsByRole(tx, [...OPS_MANAGER_ROLES])) audience.add(id);
    }
    await notifyUsers(tx, [...audience], {
      kind: input.to === 'COMPLETED' ? 'completed' : input.to === 'REOPENED' ? 'reopened' : 'status',
      title: `${t.reference} → ${input.to.replace(/_/g, ' ').toLowerCase()}`,
      body: returnedLabel
        ? `${input.note?.trim() || t.title} · ${returnedLabel} returned to service`
        : input.note?.trim() || t.title,
      ticketId: t.id,
      excludeUserId: actor.id,
    });

    await audit(tx, {
      actorUserId: actor.id,
      action: 'STATUS_CHANGE',
      entityType: 'OpsTicket',
      entityId: t.id,
      before: { status: t.status },
      after: { status: input.to },
    });
  });
}

export async function setOpsPriority(
  input: { ticketId: string; priority: OpsTicketPriority },
  actor: OpsViewer,
): Promise<void> {
  if (!canManageOps(actor.role)) throw new DomainError('forbidden', 'forbidden', 403);
  await prisma.$transaction(async (tx) => {
    const t = await loadTicketOrThrow(tx, input.ticketId);
    if (t.priority === input.priority) return;
    await tx.opsTicket.update({ where: { id: t.id }, data: { priority: input.priority } });
    await enqueueById(tx, 'OpsTicket', t.id);
    const priorityEvent = await tx.opsTicketEvent.create({
      data: { ticketId: t.id, kind: 'PRIORITY', actorId: actor.id, fromValue: t.priority, toValue: input.priority },
    });
    await enqueueById(tx, 'OpsTicketEvent', priorityEvent.id);
    if (t.assignedToId) {
      await notifyUsers(tx, [t.assignedToId], {
        kind: 'priority',
        title: `${t.reference} priority → ${input.priority.toLowerCase()}`,
        body: t.title,
        ticketId: t.id,
        excludeUserId: actor.id,
      });
    }
    await audit(tx, {
      actorUserId: actor.id,
      action: 'UPDATE',
      entityType: 'OpsTicket',
      entityId: t.id,
      before: { priority: t.priority },
      after: { priority: input.priority },
    });
  });
}

export async function setOpsDueDate(
  input: { ticketId: string; dueAt: Date | null },
  actor: OpsViewer,
): Promise<void> {
  if (!canManageOps(actor.role)) throw new DomainError('forbidden', 'forbidden', 403);
  await prisma.$transaction(async (tx) => {
    const t = await loadTicketOrThrow(tx, input.ticketId);
    await tx.opsTicket.update({ where: { id: t.id }, data: { dueAt: input.dueAt } });
    await enqueueById(tx, 'OpsTicket', t.id);
    const dueDateEvent = await tx.opsTicketEvent.create({
      data: {
        ticketId: t.id,
        kind: 'DUE_DATE',
        actorId: actor.id,
        fromValue: t.dueAt?.toISOString() ?? null,
        toValue: input.dueAt?.toISOString() ?? null,
      },
    });
    await enqueueById(tx, 'OpsTicketEvent', dueDateEvent.id);
    await audit(tx, {
      actorUserId: actor.id,
      action: 'UPDATE',
      entityType: 'OpsTicket',
      entityId: t.id,
      before: { dueAt: t.dueAt },
      after: { dueAt: input.dueAt },
    });
  });
}

// ─── Notes / escalation ───────────────────────────────────────────────────────

export async function addOpsNote(
  input: { ticketId: string; note: string; imageUrl?: string | null },
  actor: OpsViewer,
): Promise<void> {
  const note = input.note.trim();
  if (!note && !input.imageUrl) throw new DomainError('invalid_input', 'invalid_input', 400);
  // Re-validate the attachment server-side. The action layer only enforces
  // z.string().max(2000), so a direct action POST could persist a `javascript:`/
  // external/junk imageUrl that later renders into an <a href>/<img src> for any
  // manager/admin viewing the ticket (stored XSS / phishing). Force it to be a
  // real upload-route URL (`/uploads/YYYY/MM/<24hex>.<ext>`), same as ID/proof images.
  const imageUrl = input.imageUrl ? await validateProofUrl(input.imageUrl) : null;
  await prisma.$transaction(async (tx) => {
    const t = await loadTicketOrThrow(tx, input.ticketId);
    assertCanView(actor, t);
    const noteEvent = await tx.opsTicketEvent.create({
      data: {
        ticketId: t.id,
        kind: 'NOTE',
        actorId: actor.id,
        note: note || null,
        imageUrl,
      },
    });
    await enqueueById(tx, 'OpsTicketEvent', noteEvent.id);
    const audience = [t.createdById, t.assignedToId].filter(Boolean) as string[];
    await notifyUsers(tx, audience, {
      kind: 'note',
      title: `Note on ${t.reference}`,
      body: note.slice(0, 200) || 'Photo attached',
      ticketId: t.id,
      excludeUserId: actor.id,
    });
  });
}

/**
 * Escalate a housekeeping-side ticket to MAINTENANCE (damage discovered while
 * cleaning, etc.). Keeps the same ticket (full history preserved), flips the
 * type, bumps priority to at least HIGH, clears the assignee (it now belongs
 * to the maintenance pool) and notifies the maintenance department.
 */
export async function escalateOpsTicket(
  input: { ticketId: string; note?: string | null },
  actor: OpsViewer,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await loadTicketOrThrow(tx, input.ticketId);
    const allowed = canManageOps(actor.role) || t.assignedToId === actor.id || t.createdById === actor.id;
    if (!allowed) throw new DomainError('forbidden', 'forbidden', 403);
    if (!isOpenStatus(t.status)) throw new DomainError('invalid_transition', 'ticket_closed', 409);
    if (t.type === 'MAINTENANCE' || t.type === 'REPAIR' || t.type === 'OUT_OF_SERVICE') {
      throw new DomainError('invalid_input', 'already_maintenance', 400);
    }
    const priority: OpsTicketPriority =
      t.priority === 'URGENT' ? 'URGENT' : t.priority === 'HIGH' ? 'HIGH' : 'HIGH';
    await tx.opsTicket.update({
      where: { id: t.id },
      data: {
        type: 'MAINTENANCE',
        priority,
        assignedToId: null,
        status: 'OPEN',
      },
    });
    await enqueueById(tx, 'OpsTicket', t.id);
    const escalatedEvent = await tx.opsTicketEvent.create({
      data: {
        ticketId: t.id,
        kind: 'ESCALATED',
        actorId: actor.id,
        fromValue: t.type,
        toValue: 'MAINTENANCE',
        note: input.note?.trim() || null,
      },
    });
    await enqueueById(tx, 'OpsTicketEvent', escalatedEvent.id);
    const audience = await staffIdsByRole(tx, ['MAINTENANCE', ...OPS_MANAGER_ROLES]);
    await notifyUsers(tx, audience, {
      kind: 'ticket_created',
      title: `Escalated to maintenance · ${t.reference}`,
      body: input.note?.trim() || t.title,
      ticketId: t.id,
      excludeUserId: actor.id,
    });
    await audit(tx, {
      actorUserId: actor.id,
      action: 'UPDATE',
      entityType: 'OpsTicket',
      entityId: t.id,
      before: { type: t.type, priority: t.priority, assignedToId: t.assignedToId },
      after: { type: 'MAINTENANCE', priority, assignedToId: null },
    });
  });
}

// ─── Return a place to service ────────────────────────────────────────────────

/**
 * End ALL downtime on the ticket's place (open-ended offline + any live or
 * future outage windows) and bring it back online. Permitted for MAINTENANCE
 * staff, ops managers, and the ticket's CREATOR (whoever took a cell down can
 * bring it back once the issue is resolved). Mirrors the bookkeeping in
 * `admin-places.ts` (`adminSetPlaceActive` / `adminDeletePlaceOutage`) —
 * re-implemented here because the import direction must stay
 * admin-places → ops-tickets:
 *   - open INACTIVE log spans are closed at `now`;
 *   - a live outage window's log is truncated to `now`; a future window's log
 *     is marked `cancelled`; the live `PlaceOutage` rows are then deleted.
 */
export async function returnPlaceToService(
  input: { ticketId: string; note?: string | null },
  actor: OpsViewer,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const t = await loadTicketOrThrow(tx, input.ticketId);
    if (!t.placeId || !t.place) throw new DomainError('invalid_input', 'no_place', 400);
    const isCreator = t.createdById === actor.id && isOpsOperator(actor.role);
    if (!canManageOps(actor.role) && actor.role !== 'MAINTENANCE' && !isCreator) {
      throw new DomainError('forbidden', 'forbidden', 403);
    }
    assertCanView(actor, t);

    const { liveOutages } = await reactivatePlaceCore(tx, t.placeId, actor.id);

    const returnedEvent = await tx.opsTicketEvent.create({
      data: {
        ticketId: t.id,
        kind: 'RETURNED_TO_SERVICE',
        actorId: actor.id,
        toValue: t.place.label,
        note: input.note?.trim() || null,
      },
    });
    await enqueueById(tx, 'OpsTicketEvent', returnedEvent.id);
    const audience = new Set<string>([t.createdById]);
    if (t.assignedToId) audience.add(t.assignedToId);
    for (const id of await staffIdsByRole(tx, [...OPS_MANAGER_ROLES])) audience.add(id);
    await notifyUsers(tx, [...audience], {
      kind: 'returned_to_service',
      title: `${t.place.label} returned to service`,
      body: t.reference,
      ticketId: t.id,
      excludeUserId: actor.id,
    });
    await audit(tx, {
      actorUserId: actor.id,
      action: 'UPDATE',
      entityType: 'ServicePlace',
      entityId: t.placeId,
      before: { isActive: t.place.isActive, liveOutages },
      after: { isActive: true, liveOutages: 0, viaOpsTicket: t.id },
    });
  });
}

/**
 * Core place-reactivation bookkeeping shared by `returnPlaceToService` and the
 * complete-a-ticket auto-return: bring the place online, close open INACTIVE
 * log spans, truncate live outage logs / mark future ones cancelled, and delete
 * the live `PlaceOutage` rows. Same semantics as the admin-places paths.
 */
async function reactivatePlaceCore(
  tx: Prisma.TransactionClient,
  placeId: string,
  actorId: string,
): Promise<{ liveOutages: number }> {
  const now = new Date();
  const place = await tx.servicePlace.findUnique({
    where: { id: placeId },
    select: { id: true, isActive: true },
  });
  if (!place) return { liveOutages: 0 };
  if (!place.isActive) {
    await tx.servicePlace.update({ where: { id: placeId }, data: { isActive: true } });
    const inactiveLogs = await tx.placeOutageLog.findMany({
      where: { placeId, kind: 'INACTIVE', endsAt: null },
      select: { id: true },
    });
    await tx.placeOutageLog.updateMany({
      where: { placeId, kind: 'INACTIVE', endsAt: null },
      data: { endsAt: now, endedById: actorId },
    });
    for (const l of inactiveLogs) await enqueueById(tx, 'PlaceOutageLog', l.id);
  }
  const liveOutages = await tx.placeOutage.findMany({
    where: { placeId, endsAt: { gt: now } },
    select: { id: true, startsAt: true },
  });
  for (const o of liveOutages) {
    const outageLogs = await tx.placeOutageLog.findMany({
      where: { outageId: o.id },
      select: { id: true },
    });
    if (o.startsAt.getTime() > now.getTime()) {
      await tx.placeOutageLog.updateMany({
        where: { outageId: o.id },
        data: { cancelled: true, endedById: actorId },
      });
    } else {
      await tx.placeOutageLog.updateMany({
        where: { outageId: o.id },
        data: { endsAt: now, endedById: actorId },
      });
    }
    for (const l of outageLogs) await enqueueById(tx, 'PlaceOutageLog', l.id);
  }
  if (liveOutages.length > 0) {
    await tx.placeOutage.deleteMany({ where: { id: { in: liveOutages.map((o) => o.id) } } });
    for (const o of liveOutages) await enqueueById(tx, 'PlaceOutage', o.id, 'delete');
  }
  return { liveOutages: liveOutages.length };
}

// ─── Out-of-service hooks (called from admin-places inside ITS transaction) ───

/**
 * A place just went out of service (scheduled outage or offline flip). Create
 * an OUT_OF_SERVICE ticket — or, when one is already open for this place,
 * append the new window to its timeline instead of duplicating — and notify
 * both ops departments + managers.
 */
export async function opsOnPlaceOutOfService(
  tx: Prisma.TransactionClient,
  input: {
    placeId: string;
    reason?: string | null;
    until?: Date | null;
    outageId?: string | null;
    actorUserId: string;
  },
): Promise<void> {
  const place = await tx.servicePlace.findUnique({
    where: { id: input.placeId },
    select: { id: true, label: true, service: { select: { nameEn: true } } },
  });
  if (!place) return;

  const windowText = input.until
    ? `until ${input.until.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'until further notice';
  const detail = [input.reason?.trim() || null, windowText].filter(Boolean).join(' · ');

  const existing = await tx.opsTicket.findFirst({
    where: { placeId: place.id, type: 'OUT_OF_SERVICE', status: { in: OPS_OPEN_STATUSES } },
    select: { id: true, reference: true },
  });
  if (existing) {
    const existingNoteEvent = await tx.opsTicketEvent.create({
      data: {
        ticketId: existing.id,
        kind: 'NOTE',
        actorId: input.actorUserId,
        note: `New out-of-service window: ${detail}`,
      },
    });
    await enqueueById(tx, 'OpsTicketEvent', existingNoteEvent.id);
    return;
  }

  let created;
  for (let attempt = 0; ; attempt++) {
    try {
      created = await tx.opsTicket.create({
        data: {
          reference: generateOpsReference(),
          type: 'OUT_OF_SERVICE',
          priority: 'HIGH',
          status: 'NEW',
          title: `${place.label} (${place.service.nameEn}) out of service`,
          description: detail,
          placeId: place.id,
          createdById: input.actorUserId,
          outageId: input.outageId ?? null,
        },
      });
      break;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2) continue;
      throw err;
    }
  }
  await enqueueById(tx, 'OpsTicket', created.id);
  const createdEvent = await tx.opsTicketEvent.create({
    data: { ticketId: created.id, kind: 'CREATED', actorId: input.actorUserId, toValue: 'NEW', note: detail },
  });
  await enqueueById(tx, 'OpsTicketEvent', createdEvent.id);
  const audience = await staffIdsByRole(tx, ['HOUSEKEEPING', 'MAINTENANCE', ...OPS_MANAGER_ROLES]);
  await notifyUsers(tx, audience, {
    kind: 'out_of_service',
    title: `${place.label} is out of service`,
    body: detail,
    ticketId: created.id,
    excludeUserId: input.actorUserId,
  });
  await audit(tx, {
    actorUserId: input.actorUserId,
    action: 'CREATE',
    entityType: 'OpsTicket',
    entityId: created.id,
    after: created,
  });
}

/**
 * A place came back online OUTSIDE the ops desk (admin toggle / outage window
 * cancelled in manage-places). Annotate any open OUT_OF_SERVICE tickets so the
 * timeline stays truthful and the workers know.
 */
export async function opsOnPlaceBackInService(
  tx: Prisma.TransactionClient,
  input: { placeId: string; actorUserId: string },
): Promise<void> {
  const open = await tx.opsTicket.findMany({
    where: { placeId: input.placeId, type: 'OUT_OF_SERVICE', status: { in: OPS_OPEN_STATUSES } },
    select: { id: true, reference: true, createdById: true, assignedToId: true, place: { select: { label: true } } },
  });
  for (const t of open) {
    const backNoteEvent = await tx.opsTicketEvent.create({
      data: {
        ticketId: t.id,
        kind: 'NOTE',
        actorId: input.actorUserId,
        note: 'Place was returned to service from the admin panel.',
      },
    });
    await enqueueById(tx, 'OpsTicketEvent', backNoteEvent.id);
    const audience = [t.createdById, t.assignedToId].filter(Boolean) as string[];
    await notifyUsers(tx, audience, {
      kind: 'returned_to_service',
      title: `${t.place?.label ?? 'Place'} back in service`,
      body: `${t.reference} — close the ticket once verified.`,
      ticketId: t.id,
      excludeUserId: input.actorUserId,
    });
  }
}

// ─── Overdue sweep ────────────────────────────────────────────────────────────

/**
 * Notify assignees (and managers) about tickets that crossed their due date.
 * Called lazily from the ops desk loader — at most once per ticket (the event
 * log records an `overdue_notified` marker note to prevent re-sends).
 */
export async function sweepOverdueTickets(): Promise<number> {
  const now = new Date();
  const overdue = await prisma.opsTicket.findMany({
    where: {
      dueAt: { lt: now },
      status: { in: OPS_OPEN_STATUSES },
      events: { none: { kind: 'NOTE', note: 'overdue_notified' } },
    },
    select: { id: true, reference: true, title: true, assignedToId: true, createdById: true },
    take: 50,
  });
  if (overdue.length === 0) return 0;
  await prisma.$transaction(async (tx) => {
    const managers = await staffIdsByRole(tx, [...OPS_MANAGER_ROLES]);
    for (const t of overdue) {
      const overdueEvent = await tx.opsTicketEvent.create({
        data: { ticketId: t.id, kind: 'NOTE', note: 'overdue_notified' },
      });
      await enqueueById(tx, 'OpsTicketEvent', overdueEvent.id);
      const audience = new Set<string>(managers);
      if (t.assignedToId) audience.add(t.assignedToId);
      audience.add(t.createdById);
      await notifyUsers(tx, [...audience], {
        kind: 'overdue',
        title: `Overdue · ${t.reference}`,
        body: t.title,
        ticketId: t.id,
      });
    }
  });
  return overdue.length;
}

// ─── Staff / place pickers & notifications feed ───────────────────────────────

export interface OpsStaffOption {
  id: string;
  name: string;
  role: UserRole;
}

/** Assignable staff (the two departments + managers) for the assign dropdown. */
export async function listOpsStaff(): Promise<OpsStaffOption[]> {
  const rows = await prisma.user.findMany({
    where: { role: { in: [...OPS_ASSIGNABLE_ROLES] }, deletedAt: null, blockedAt: null },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  return rows.map((u) => ({ id: u.id, name: displayName(u), role: u.role }));
}

// ── Cascading cell picker: Category → Service → Cell ──

export interface OpsCatalogCategory {
  id: string;
  name: string;
  services: { id: string; name: string; placeCount: number }[];
}

/**
 * Active categories with their active services (+ how many physical cells each
 * service has) — drives the Category → Service selects on the new-ticket form.
 */
export async function listOpsCatalog(): Promise<OpsCatalogCategory[]> {
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    select: {
      id: true,
      nameEn: true,
      services: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        select: { id: true, nameEn: true, _count: { select: { places: true } } },
      },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.nameEn,
    services: c.services.map((s) => ({ id: s.id, name: s.nameEn, placeCount: s._count.places })),
  }));
}

export interface OpsPlaceOption {
  id: string;
  label: string;
  zone: string | null;
  isActive: boolean;
  /** Already inside an out-of-service window right now. */
  outNow: boolean;
}

/** Every cell of one service (with live availability state) for the Cell select. */
export async function listOpsServicePlaces(serviceId: string): Promise<OpsPlaceOption[]> {
  const now = new Date();
  const rows = await prisma.servicePlace.findMany({
    where: { serviceId },
    select: {
      id: true,
      label: true,
      zone: true,
      isActive: true,
      outages: { where: { startsAt: { lte: now }, endsAt: { gt: now } }, select: { id: true }, take: 1 },
    },
    orderBy: [{ zone: 'asc' }, { position: 'asc' }, { label: 'asc' }],
  });
  return rows.map((p) => ({
    id: p.id,
    label: p.label,
    zone: p.zone,
    isActive: p.isActive,
    outNow: p.outages.length > 0,
  }));
}

export interface StaffNotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  ticketId: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listMyStaffNotifications(
  userId: string,
  limit = 30,
): Promise<{ rows: StaffNotificationRow[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.staffNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    }),
    prisma.staffNotification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    rows: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      ticketId: n.ticketId,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unread,
  };
}

export async function markStaffNotificationsRead(
  userId: string,
  ids: string[] | 'all',
): Promise<void> {
  await prisma.staffNotification.updateMany({
    where: { userId, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}
