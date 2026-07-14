import type { OpsTicketStatus } from '@prisma/client';

/**
 * Housekeeping & maintenance ticket status machine — PURE (no imports beyond
 * the Prisma enum type), so it unit-tests without a database and both the
 * service layer and the UI can share one source of truth.
 *
 * Lifecycle:
 *
 *   NEW ──→ OPEN ──→ ASSIGNED ──→ IN_PROGRESS ──→ COMPLETED
 *    │        │          │        ↑    │   ↑           │
 *    │        │          └────────┘    ↓   │           ↓
 *    │        │                     WAITING┘        REOPENED ─→ (working states)
 *    └──→ CANCELLED ←──────────────────┘
 *
 * COMPLETED / CANCELLED are terminal except for REOPENED. A reopened ticket
 * behaves like an open one (it can be re-assigned, worked and completed again).
 */
export const OPS_TRANSITIONS: Record<OpsTicketStatus, OpsTicketStatus[]> = {
  NEW: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  OPEN: ['ASSIGNED', 'IN_PROGRESS', 'WAITING', 'CANCELLED'],
  ASSIGNED: ['OPEN', 'IN_PROGRESS', 'WAITING', 'CANCELLED'],
  IN_PROGRESS: ['WAITING', 'COMPLETED', 'OPEN', 'CANCELLED'],
  WAITING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['REOPENED'],
  CANCELLED: ['REOPENED'],
  REOPENED: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'CANCELLED'],
};

export function canTransition(from: OpsTicketStatus, to: OpsTicketStatus): boolean {
  return from !== to && (OPS_TRANSITIONS[from] ?? []).includes(to);
}

/** Statuses that still need work — everything except the two terminal states. */
export const OPS_OPEN_STATUSES: OpsTicketStatus[] = [
  'NEW',
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING',
  'REOPENED',
];

export function isOpenStatus(status: OpsTicketStatus): boolean {
  return OPS_OPEN_STATUSES.includes(status);
}

/**
 * Statuses the ASSIGNED worker may move their own ticket into without manager
 * rights: start, pause, hand back, finish or flag-can't-finish. CANCELLED is
 * deliberately manager-only.
 */
export const OPS_WORKER_TARGETS: OpsTicketStatus[] = [
  'IN_PROGRESS',
  'WAITING',
  'OPEN',
  'COMPLETED',
  'REOPENED',
];

export function workerMayTarget(to: OpsTicketStatus): boolean {
  return OPS_WORKER_TARGETS.includes(to);
}
