'use server';

import { z } from 'zod';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessOps, isOpsOperator } from '@/server/auth/roles';
import { isStoredMediaUrl } from '@/lib/upload-paths';

/** An optional image reference must be one of OUR stored media paths (never a raw
 *  javascript:/data:/external URL that would execute when rendered as a link). */
const storedImageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(isStoredMediaUrl, { message: 'invalid_image_url' });
import {
  addOpsNote,
  assignOpsTicket,
  createOpsTicket,
  escalateOpsTicket,
  getOpsSummary,
  getOpsTicket,
  listMyStaffNotifications,
  listOpsCatalog,
  listOpsServicePlaces,
  listOpsStaff,
  listOpsTickets,
  markStaffNotificationsRead,
  returnPlaceToService,
  setOpsDueDate,
  setOpsPriority,
  setOpsStatus,
  sweepOverdueTickets,
  type OpsListFilters,
  type OpsSummary,
  type OpsTicketDetail,
  type OpsTicketRow,
  type OpsStaffOption,
  type OpsCatalogCategory,
  type OpsPlaceOption,
  type StaffNotificationRow,
} from '@/server/services/ops-tickets';
import { DomainError } from '@/server/services/errors';

/**
 * Housekeeping & Maintenance desk server actions. Every action re-checks that
 * the caller is ops-authorised on the server (the UI gating is convenience
 * only) and converts domain errors into discriminated-union results.
 */

type Fail = { ok: false; code: string };

async function opsUser() {
  const user = await getSessionUser();
  if (!user || !canAccessOps(user.role)) return null;
  return user;
}

function failFrom(err: unknown): Fail {
  if (err instanceof DomainError) return { ok: false, code: err.code };
  return { ok: false, code: 'unknown' };
}

// ── Board data ──

const TYPE = z.enum(['HOUSEKEEPING', 'MAINTENANCE', 'CLEANING', 'REPAIR', 'INSPECTION', 'OUT_OF_SERVICE', 'OTHER']);
const PRIORITY = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const STATUS = z.enum(['NEW', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED', 'REOPENED']);

const filtersSchema = z.object({
  status: z.union([STATUS, z.literal('OPEN_ALL')]).optional(),
  priority: PRIORITY.optional(),
  type: TYPE.optional(),
  assignee: z.string().max(64).optional(),
  createdById: z.string().max(64).optional(),
  placeId: z.string().max(64).optional(),
  q: z.string().max(120).optional(),
  overdueOnly: z.boolean().optional(),
  outOnly: z.boolean().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(['newest', 'oldest', 'priority', 'due', 'updated', 'status']).optional(),
});

export type OpsBoardResult =
  | { ok: true; rows: OpsTicketRow[]; summary: OpsSummary }
  | Fail;

export async function loadOpsBoardAction(input: unknown): Promise<OpsBoardResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  const parsed = filtersSchema.safeParse(input ?? {});
  const filters: OpsListFilters = parsed.success ? parsed.data : {};
  try {
    // Lazily flag overdue tickets (notifies assignee + managers, once each).
    await sweepOverdueTickets().catch(() => 0);
    const [rows, summary] = await Promise.all([
      listOpsTickets({ id: user.id, role: user.role }, filters),
      getOpsSummary({ id: user.id, role: user.role }),
    ]);
    return { ok: true, rows, summary };
  } catch (err) {
    return failFrom(err);
  }
}

export type OpsTicketResult = { ok: true; ticket: OpsTicketDetail } | Fail;

export async function getOpsTicketAction(ticketId: string): Promise<OpsTicketResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  try {
    const ticket = await getOpsTicket({ id: user.id, role: user.role }, ticketId);
    return { ok: true, ticket };
  } catch (err) {
    return failFrom(err);
  }
}

// ── Create ──

const createSchema = z.object({
  type: TYPE,
  priority: PRIORITY.default('MEDIUM'),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).optional().nullable(),
  placeId: z.string().max(64).optional().nullable(),
  assignedToId: z.string().max(64).optional().nullable(),
  /** datetime-local value, e.g. "2026-06-11T14:00". */
  dueAt: z.string().max(32).optional().nullable(),
  /** datetime-local value — take the cell out of service from now until this. */
  outOfServiceUntil: z.string().max(32).optional().nullable(),
});

export type CreateOpsResult = { ok: true; id: string; reference: string } | Fail;

export async function createOpsTicketAction(input: unknown): Promise<CreateOpsResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  let dueAt: Date | null = null;
  if (parsed.data.dueAt) {
    const d = new Date(parsed.data.dueAt);
    if (Number.isNaN(d.getTime())) return { ok: false, code: 'invalid_input' };
    dueAt = d;
  }
  let outOfServiceUntil: Date | null = null;
  if (parsed.data.outOfServiceUntil) {
    const d = new Date(parsed.data.outOfServiceUntil);
    if (Number.isNaN(d.getTime())) return { ok: false, code: 'invalid_input' };
    outOfServiceUntil = d;
  }
  try {
    const res = await createOpsTicket(
      {
        type: parsed.data.type,
        priority: parsed.data.priority,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        placeId: parsed.data.placeId || null,
        assignedToId: parsed.data.assignedToId || null,
        dueAt,
        outOfServiceUntil,
      },
      { id: user.id, role: user.role },
    );
    return { ok: true, ...res };
  } catch (err) {
    return failFrom(err);
  }
}

// ── Mutations ──

export type OpsActionResult = { ok: true } | Fail;

export async function assignOpsTicketAction(input: {
  ticketId: string;
  assigneeId: string | null;
}): Promise<OpsActionResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  try {
    await assignOpsTicket(
      { ticketId: String(input.ticketId), assigneeId: input.assigneeId ? String(input.assigneeId) : null },
      { id: user.id, role: user.role },
    );
    return { ok: true };
  } catch (err) {
    return failFrom(err);
  }
}

const statusSchema = z.object({
  ticketId: z.string().min(1),
  to: STATUS,
  note: z.string().trim().max(2000).optional().nullable(),
  resolutionNotes: z.string().trim().max(4000).optional().nullable(),
  /** Completion proof photo URL — required (server-enforced) when the assignee completes. */
  proofImageUrl: storedImageUrl.optional().nullable(),
});

export async function setOpsStatusAction(input: unknown): Promise<OpsActionResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await setOpsStatus(parsed.data, { id: user.id, role: user.role });
    return { ok: true };
  } catch (err) {
    return failFrom(err);
  }
}

export async function setOpsPriorityAction(input: {
  ticketId: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}): Promise<OpsActionResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  const priority = PRIORITY.safeParse(input.priority);
  if (!priority.success) return { ok: false, code: 'invalid_input' };
  try {
    await setOpsPriority(
      { ticketId: String(input.ticketId), priority: priority.data },
      { id: user.id, role: user.role },
    );
    return { ok: true };
  } catch (err) {
    return failFrom(err);
  }
}

export async function setOpsDueDateAction(input: {
  ticketId: string;
  dueAt: string | null;
}): Promise<OpsActionResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  let due: Date | null = null;
  if (input.dueAt) {
    const d = new Date(input.dueAt);
    if (Number.isNaN(d.getTime())) return { ok: false, code: 'invalid_input' };
    due = d;
  }
  try {
    await setOpsDueDate({ ticketId: String(input.ticketId), dueAt: due }, { id: user.id, role: user.role });
    return { ok: true };
  } catch (err) {
    return failFrom(err);
  }
}

const noteSchema = z.object({
  ticketId: z.string().min(1),
  note: z.string().trim().max(2000),
  imageUrl: storedImageUrl.optional().nullable(),
});

export async function addOpsNoteAction(input: unknown): Promise<OpsActionResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await addOpsNote(parsed.data, { id: user.id, role: user.role });
    return { ok: true };
  } catch (err) {
    return failFrom(err);
  }
}

export async function escalateOpsTicketAction(input: {
  ticketId: string;
  note?: string | null;
}): Promise<OpsActionResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  try {
    await escalateOpsTicket(
      { ticketId: String(input.ticketId), note: input.note ? String(input.note).slice(0, 2000) : null },
      { id: user.id, role: user.role },
    );
    return { ok: true };
  } catch (err) {
    return failFrom(err);
  }
}

export async function returnToServiceAction(input: {
  ticketId: string;
  note?: string | null;
}): Promise<OpsActionResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  try {
    await returnPlaceToService(
      { ticketId: String(input.ticketId), note: input.note ? String(input.note).slice(0, 2000) : null },
      { id: user.id, role: user.role },
    );
    return { ok: true };
  } catch (err) {
    return failFrom(err);
  }
}

// ── Pickers ──

export type OpsStaffResult = { ok: true; staff: OpsStaffOption[] } | Fail;

export async function listOpsStaffAction(): Promise<OpsStaffResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  // Every OPERATOR can route work, so they all get the assignable-staff list;
  // SECURITY only reports and gets an empty list (no assign UI).
  if (!isOpsOperator(user.role)) return { ok: true, staff: [] };
  try {
    return { ok: true, staff: await listOpsStaff() };
  } catch (err) {
    return failFrom(err);
  }
}

export type OpsCatalogResult = { ok: true; categories: OpsCatalogCategory[] } | Fail;

/** Category → Service tree for the new-ticket cell picker. */
export async function listOpsCatalogAction(): Promise<OpsCatalogResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  try {
    return { ok: true, categories: await listOpsCatalog() };
  } catch (err) {
    return failFrom(err);
  }
}

export type OpsPlacesResult = { ok: true; places: OpsPlaceOption[] } | Fail;

/** Every cell of the chosen service (with live online / out-of-service state). */
export async function listOpsServicePlacesAction(serviceId: string): Promise<OpsPlacesResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  if (!serviceId || typeof serviceId !== 'string') return { ok: false, code: 'invalid_input' };
  try {
    return { ok: true, places: await listOpsServicePlaces(serviceId.slice(0, 64)) };
  } catch (err) {
    return failFrom(err);
  }
}

// ── Notifications ──

export type OpsNotificationsResult =
  | { ok: true; rows: StaffNotificationRow[]; unread: number }
  | Fail;

export async function listOpsNotificationsAction(): Promise<OpsNotificationsResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  try {
    const res = await listMyStaffNotifications(user.id);
    return { ok: true, ...res };
  } catch (err) {
    return failFrom(err);
  }
}

export async function markOpsNotificationsReadAction(
  ids: string[] | 'all',
): Promise<OpsActionResult> {
  const user = await opsUser();
  if (!user) return { ok: false, code: 'forbidden' };
  try {
    await markStaffNotificationsRead(
      user.id,
      ids === 'all' ? 'all' : ids.map(String).slice(0, 100),
    );
    return { ok: true };
  } catch (err) {
    return failFrom(err);
  }
}
