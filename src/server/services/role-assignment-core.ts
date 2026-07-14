import type { UserRole } from '@prisma/client';

/**
 * Pure separation-of-duties policy for admin user management (no
 * server-only/Prisma deps → directly unit-testable). The service layer
 * (`admin-users.ts`) supplies the live top-tier counts and applies the verdict.
 *
 * Why this exists: `adminUpdateUser`/`adminCreateUser` are gated by
 * `requireSuperAdmin`, which admits BOTH SUPER_ADMIN and DEVELOPER. Without the
 * checks below a SUPER_ADMIN could grant themselves DEVELOPER (unlocking DB
 * backup/restore + sandbox mode), demote a peer, change their own role, or strip
 * the last account that can manage users — collapsing the intended
 * DEVELOPER > SUPER_ADMIN separation with no floor.
 *
 * Invariants enforced:
 *   1. Only a DEVELOPER may grant the DEVELOPER role.
 *   2. An admin may not change their OWN role (prevents self-escalation and
 *      accidental self-lockout; a second top-tier account must do it).
 *   3. The last remaining DEVELOPER may not be demoted or archived (DEVELOPER
 *      powers would become unreachable).
 *   4. The last remaining user-MANAGER (SUPER_ADMIN ∪ DEVELOPER — the roles that
 *      can manage users at all) may not be demoted or archived (nobody could
 *      manage users afterwards).
 */

/** Roles that pass `requireSuperAdmin`, i.e. can manage users. */
export const USER_MANAGER_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  'SUPER_ADMIN',
  'DEVELOPER',
]);

export type RoleAssignmentDenial =
  | 'cannot_assign_developer'
  | 'cannot_change_own_role'
  | 'cannot_demote_last_developer'
  | 'cannot_remove_last_admin';

/** Live counts of OTHER (≠ target) active accounts, supplied by the service. */
export interface TopTierCounts {
  /** Active DEVELOPERs other than the target. */
  otherDevelopers: number;
  /** Active user-managers (SUPER_ADMIN ∪ DEVELOPER) other than the target. */
  otherManagers: number;
}

/**
 * Creating a brand-new user: the only relevant rule is that granting DEVELOPER
 * requires the actor to be a DEVELOPER. (Self-role and last-admin rules can't
 * apply to a user that doesn't exist yet.)
 */
export function checkRoleCreate(actorRole: UserRole, newRole: UserRole): RoleAssignmentDenial | null {
  if (newRole === 'DEVELOPER' && actorRole !== 'DEVELOPER') return 'cannot_assign_developer';
  return null;
}

/**
 * Updating an existing user's role. Returns the first violated rule, or null if
 * the change is allowed.
 */
export function checkRoleUpdate(input: {
  actorRole: UserRole;
  actorUserId: string;
  targetUserId: string;
  currentRole: UserRole;
  newRole: UserRole;
  counts: TopTierCounts;
}): RoleAssignmentDenial | null {
  const { actorRole, actorUserId, targetUserId, currentRole, newRole, counts } = input;

  const roleChanges = newRole !== currentRole;

  // 2. No self-role change (checked before the grant rule so a self-edit that
  //    keeps the same role is a no-op, not a spurious "assign developer" denial).
  if (roleChanges && targetUserId === actorUserId) return 'cannot_change_own_role';

  // 1. Only a DEVELOPER may grant DEVELOPER.
  if (newRole === 'DEVELOPER' && currentRole !== 'DEVELOPER' && actorRole !== 'DEVELOPER') {
    return 'cannot_assign_developer';
  }

  if (roleChanges) {
    // 3. Don't demote the last DEVELOPER.
    if (currentRole === 'DEVELOPER' && newRole !== 'DEVELOPER' && counts.otherDevelopers === 0) {
      return 'cannot_demote_last_developer';
    }
    // 4. Don't strip the last user-manager.
    if (
      USER_MANAGER_ROLES.has(currentRole) &&
      !USER_MANAGER_ROLES.has(newRole) &&
      counts.otherManagers === 0
    ) {
      return 'cannot_remove_last_admin';
    }
  }

  return null;
}

/**
 * Archiving (soft-deleting) a user removes them from the active pool, so the
 * same last-DEVELOPER / last-manager floors apply. (Self-delete is blocked
 * separately in the service.)
 */
export function checkUserArchive(input: {
  currentRole: UserRole;
  counts: TopTierCounts;
}): RoleAssignmentDenial | null {
  const { currentRole, counts } = input;
  if (currentRole === 'DEVELOPER' && counts.otherDevelopers === 0) {
    return 'cannot_demote_last_developer';
  }
  if (USER_MANAGER_ROLES.has(currentRole) && counts.otherManagers === 0) {
    return 'cannot_remove_last_admin';
  }
  return null;
}
