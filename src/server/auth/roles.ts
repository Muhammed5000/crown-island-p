import type { UserRole } from '@prisma/client';

/**
 * Single source of truth for route-level role policy.
 *
 * Edge-safe: this module only imports the `UserRole` *type* (erased at build)
 * and holds plain string sets, so it can be pulled into the edge-runtime proxy
 * (`@/server/auth/config`) as well as Node-runtime guards and API routes.
 *
 * Policy:
 *   - Admin panel (`/admin/**`)  → ADMIN, SUPER_ADMIN, DEVELOPER only.
 *   - Gate scanner (`/gate/**`)  → STAFF and SECURITY plus the admin tiers
 *     (supervisors may work the gate). STAFF / SECURITY may access *nothing
 *     else* protected. SECURITY is further confined to `/gate/scan` ONLY —
 *     no reception desk, no ops desk.
 *   - Staff operations desk (`/gate/ops`) → every gate-authorised role except
 *     SECURITY can REPORT issues there; HOUSEKEEPING / MAINTENANCE work the
 *     tickets; the managerial tiers (MANAGER, DIRECTOR, admin tiers) assign
 *     and close.
 *   - Money on the gate page → everyone gate-authorised EXCEPT SECURITY,
 *     HOUSEKEEPING and MAINTENANCE. Those roles never see revenue / totals.
 */

/**
 * Admin-panel privilege tiers (ascending — each inherits the one below):
 *   1. ADMIN        — day-to-day admin: catalog, bookings, invoices, reports,
 *                     notifications, refunds, review moderation, customer bans.
 *   2. SUPER_ADMIN  — ADMIN + user management (`/admin/users`: create / edit /
 *                     archive accounts and change roles, via `requireSuperAdmin`).
 *   3. DEVELOPER    — SUPER_ADMIN + developer tools: DB backup/restore
 *                     (`/api/admin/backup`), sandbox mode + virtual pay, TESTER
 *                     data cleanup (via `requireDeveloper`). The ONLY role that
 *                     may grant the DEVELOPER role — see `role-assignment-core`.
 * `requireSuperAdmin` admits SUPER_ADMIN *and* DEVELOPER; the DEVELOPER-only
 * separation is enforced per-action, not by this set.
 */
export const ADMIN_PANEL_ROLES = new Set<UserRole>(['ADMIN', 'SUPER_ADMIN', 'DEVELOPER']);

/** Roles permitted into the staff area (`/gate/**` — scanner, reception, ops desk). */
export const GATE_ROLES = new Set<UserRole>([
  'STAFF',
  'SUPERVISOR',
  'MANAGER',
  'DIRECTOR',
  'SECURITY',
  'HOUSEKEEPING',
  'MAINTENANCE',
  'ADMIN',
  'SUPER_ADMIN',
  'DEVELOPER',
]);

/**
 * Roles confined to the staff area (`/gate/**`) and barred from every other
 * protected route. The ground-level gate roles plus the reception ladder
 * (STAFF → SUPERVISOR → MANAGER → DIRECTOR) and the two operations departments
 * live here; the admin tiers roam free.
 */
export const GATE_ONLY_ROLES = new Set<UserRole>([
  'STAFF',
  'SUPERVISOR',
  'MANAGER',
  'DIRECTOR',
  'SECURITY',
  'HOUSEKEEPING',
  'MAINTENANCE',
]);

/**
 * Roles that never see money anywhere in the staff area: SECURITY verify
 * passes and HOUSEKEEPING / MAINTENANCE work tickets — none of them handle
 * revenue, so amounts/totals are omitted for all three.
 */
const MONEY_BLIND_ROLES = new Set<UserRole>(['SECURITY', 'HOUSEKEEPING', 'MAINTENANCE']);

/**
 * The two operations departments — the "doers" of the housekeeping &
 * maintenance desk. They receive out-of-service notifications and may claim
 * unassigned tickets; everyone else on the desk is a reporter or a manager.
 */
export const OPS_STAFF_ROLES = new Set<UserRole>(['HOUSEKEEPING', 'MAINTENANCE']);

/**
 * Roles that MANAGE the ops desk: assign tickets, set priority / due dates,
 * cancel tickets and return places to service. The reception ladder's top
 * (MANAGER, DIRECTOR) plus the admin tiers.
 */
export const OPS_MANAGER_ROLES = new Set<UserRole>([
  'MANAGER',
  'DIRECTOR',
  'ADMIN',
  'SUPER_ADMIN',
  'DEVELOPER',
]);

/**
 * Roles a ticket may be ASSIGNED to: the two ops departments, the managers,
 * and general staff (STAFF / SUPERVISOR — venues routinely hand operational
 * tasks to whoever is on shift, not only dedicated housekeeping accounts).
 * SECURITY is deliberately excluded — they verify passes, they don't take
 * cleaning/repair work orders.
 */
export const OPS_ASSIGNABLE_ROLES = new Set<UserRole>([
  'HOUSEKEEPING',
  'MAINTENANCE',
  'STAFF',
  'SUPERVISOR',
  'MANAGER',
  'DIRECTOR',
  'ADMIN',
  'SUPER_ADMIN',
  'DEVELOPER',
]);

export function canAccessAdmin(role: string | null | undefined): boolean {
  return typeof role === 'string' && ADMIN_PANEL_ROLES.has(role as UserRole);
}

/**
 * Restaurant partner — owns + manages a Restaurant profile from the guest app
 * (`/menu/manage`). Deliberately NOT in `GATE_ROLES` / `ADMIN_PANEL_ROLES` /
 * `GATE_ONLY_ROLES`: partners sign in through the customer paths, browse the
 * guest app freely, and gain exactly one extra surface (their own profile).
 */
export function isRestaurantOwner(role: string | null | undefined): boolean {
  return role === 'RESTAURANT';
}

/**
 * Whether a role is privileged (any non-customer staff role). Used to forbid
 * OAuth account-linking onto these accounts: whoever controls the email must
 * not thereby gain staff/admin access — privileged accounts sign in only
 * through the password path at `/admin/login`. The privileged set is exactly
 * the gate-authorised set (STAFF, SECURITY, and the three admin tiers).
 */
export function isPrivilegedRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && GATE_ROLES.has(role as UserRole);
}

export function canAccessGate(role: string | null | undefined): boolean {
  return typeof role === 'string' && GATE_ROLES.has(role as UserRole);
}

/** Keep staff credential eligibility aligned with the canonical staff-area role set. */
export function canUseStaffPassword(role: string | null | undefined): boolean {
  return canAccessGate(role);
}

/** Gate-only roles are confined to `/gate/**`; every other protected route is off-limits. */
export function isGateOnlyRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && GATE_ONLY_ROLES.has(role as UserRole);
}

/**
 * Where a gate-only account lands when it strays outside `/gate/**`:
 * housekeeping & maintenance staff live on the ops desk, everyone else on the
 * scanner. Used by the proxy's confinement redirect.
 */
export function gateHomePath(role: string | null | undefined): string {
  return typeof role === 'string' && OPS_STAFF_ROLES.has(role as UserRole)
    ? '/gate/ops'
    : '/gate/scan';
}

/**
 * Whether a gate operator may see money-related data (line amounts, totals,
 * revenue). Granted to STAFF and the admin tiers; explicitly DENIED to
 * SECURITY / HOUSEKEEPING / MAINTENANCE, who work without financial visibility.
 */
export function canViewGateMoney(role: string | null | undefined): boolean {
  return (
    typeof role === 'string' &&
    GATE_ROLES.has(role as UserRole) &&
    !MONEY_BLIND_ROLES.has(role as UserRole)
  );
}

/**
 * Whether a gate operator may use the Reception Booking desk (create offline
 * bookings + record payment) and see the Gate ↔ Reception switch. Granted to
 * STAFF and the admin tiers; explicitly DENIED to SECURITY (verify passes
 * only) and to HOUSEKEEPING / MAINTENANCE (operations desk only).
 */
export function canAccessReception(role: string | null | undefined): boolean {
  return (
    typeof role === 'string' &&
    GATE_ROLES.has(role as UserRole) &&
    role !== 'SECURITY' &&
    !OPS_STAFF_ROLES.has(role as UserRole)
  );
}

/**
 * Whether a user may open the Housekeeping & Maintenance desk (`/gate/ops`).
 * Gate-authorised roles EXCEPT SECURITY — ops staff work tickets, reception
 * staff report issues, managers/admins run the board. SECURITY is confined to
 * the scanner (`/gate/scan`) and nothing else: they verify passes only.
 */
export function canAccessOps(role: string | null | undefined): boolean {
  return (
    typeof role === 'string' && GATE_ROLES.has(role as UserRole) && role !== 'SECURITY'
  );
}

/** Whether the role is one of the two ops departments (HOUSEKEEPING / MAINTENANCE). */
export function isOpsStaffRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && OPS_STAFF_ROLES.has(role as UserRole);
}

/**
 * Ops-desk OPERATORS: everyone ops-authorised. Operators can route work —
 * assign/claim tickets they can see, take a ticket's cell out of service for
 * a window, and (as the ticket's creator) return it to service. SECURITY has
 * no ops access at all (see `canAccessOps`). Priority / due dates / cancel
 * remain manager-only (`canManageOps`).
 */
export function isOpsOperator(role: string | null | undefined): boolean {
  return canAccessOps(role) && role !== 'SECURITY';
}

/** Whether the role manages the ops desk (assign / prioritise / cancel / return to service). */
export function canManageOps(role: string | null | undefined): boolean {
  return typeof role === 'string' && OPS_MANAGER_ROLES.has(role as UserRole);
}
