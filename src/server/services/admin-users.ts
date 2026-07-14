import 'server-only';
import { hash } from 'bcryptjs';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { auditableUser } from '@/server/audit/sanitize';
import { DomainError } from './errors';
import { isAnyIdentityBlocked, normIdentity } from './blocklist';
import { isPrivilegedRole } from '@/server/auth/roles';
import { assertNotLocalNode } from '@/server/sync/node-guard';
import {
  checkRoleCreate,
  checkRoleUpdate,
  checkUserArchive,
  type TopTierCounts,
} from './role-assignment-core';
import type { Prisma, UserRole, BlockedIdentityKind } from '@prisma/client';

export interface UserInput {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  role: UserRole;
  password?: string | null;
}

/**
 * Live counts of ACTIVE (non-archived) top-tier accounts OTHER than `exceptId`,
 * used by the separation-of-duties floors (never demote/remove the last
 * DEVELOPER or the last user-manager). Runs inside the caller's transaction so
 * the count and the mutation are consistent.
 */
async function topTierCounts(
  tx: Prisma.TransactionClient,
  exceptId: string | null,
): Promise<TopTierCounts> {
  const notSelf = exceptId ? { id: { not: exceptId } } : {};
  const [otherDevelopers, otherManagers] = await Promise.all([
    tx.user.count({ where: { role: 'DEVELOPER', deletedAt: null, ...notSelf } }),
    tx.user.count({
      where: { role: { in: ['SUPER_ADMIN', 'DEVELOPER'] }, deletedAt: null, ...notSelf },
    }),
  ]);
  return { otherDevelopers, otherManagers };
}

export async function adminCreateUser(data: UserInput, actorUserId: string) {
  return await prisma.$transaction(async (tx) => {
    // Separation of duties: only a DEVELOPER may mint a DEVELOPER. The actor's
    // role is read from the DB (authoritative), never trusted from the caller.
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
    if (!actor) throw new DomainError('not_found', 'not_found', 404);
    const denial = checkRoleCreate(actor.role, data.role);
    if (denial) throw new DomainError(denial, denial, 403);

    // Refuse to recreate a blocked person under a banned identifier.
    if (
      await isAnyIdentityBlocked(
        [
          { kind: 'EMAIL', value: data.email },
          { kind: 'PHONE', value: data.phone },
        ],
        tx as typeof prisma,
      )
    ) {
      throw new DomainError('identity_blocked', 'identity_blocked', 409);
    }

    // Check if email or phone is already taken
    if (data.email) {
      const existing = await tx.user.findUnique({ where: { email: data.email } });
      if (existing) throw new DomainError('email_taken', 'email_taken', 409);
    }
    if (data.phone) {
      const existing = await tx.user.findUnique({ where: { phone: data.phone } });
      if (existing) throw new DomainError('phone_taken', 'phone_taken', 409);
    }

    let passwordHash: string | null = null;
    if (data.password) {
      passwordHash = await hash(data.password, 12);
    }

    const { password, ...userData } = data;
    const created = await tx.user.create({
      data: {
        ...userData,
        passwordHash,
        emailVerified: userData.email ? new Date() : null,
        phoneVerified: userData.phone ? new Date() : null,
      },
    });

    await audit(tx, {
      actorUserId,
      action: 'CREATE',
      entityType: 'User',
      entityId: created.id,
      after: auditableUser(created),
    });

    return created;
  });
}

export async function adminUpdateUser(id: string, data: UserInput, actorUserId: string) {
  return await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);

    // Separation-of-duties floors: no self-role change, only a DEVELOPER grants
    // DEVELOPER, never demote the last DEVELOPER / last user-manager. The actor's
    // role is read from the DB (authoritative), not trusted from the caller.
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { role: true } });
    if (!actor) throw new DomainError('not_found', 'not_found', 404);
    const denial = checkRoleUpdate({
      actorRole: actor.role,
      actorUserId,
      targetUserId: id,
      currentRole: before.role,
      newRole: data.role,
      counts: await topTierCounts(tx, id),
    });
    if (denial) throw new DomainError(denial, denial, 403);

    // Check uniqueness if changed
    if (data.email && data.email !== before.email) {
      const existing = await tx.user.findUnique({ where: { email: data.email } });
      if (existing) throw new DomainError('email_taken', 'email_taken', 409);
    }
    if (data.phone && data.phone !== before.phone) {
      const existing = await tx.user.findUnique({ where: { phone: data.phone } });
      if (existing) throw new DomainError('phone_taken', 'phone_taken', 409);
    }

    let passwordHash = before.passwordHash;
    if (data.password) {
      passwordHash = await hash(data.password, 12);
    }

    const { password, ...userData } = data;
    const after = await tx.user.update({
      where: { id },
      data: {
        ...userData,
        passwordHash,
        // When an admin changes the password, bump the session epoch so every
        // existing JWT for this user is evicted on its next request (the jwt
        // re-hydration tokenVersion guard). Matches the self-service reset /
        // change-password flows — an admin-forced reset must kick attackers out.
        ...(data.password ? { tokenVersion: { increment: 1 } } : {}),
        // Ensure user is verified if they have an email/phone now
        emailVerified: (userData.email && !before.emailVerified) ? new Date() : before.emailVerified,
        phoneVerified: (userData.phone && !before.phoneVerified) ? new Date() : before.phoneVerified,
      },
    });

    await audit(tx, {
      actorUserId,
      action: data.role !== before.role ? 'ROLE_CHANGE' : 'UPDATE',
      entityType: 'User',
      entityId: id,
      before: auditableUser(before),
      after: auditableUser(after),
    });

    return after;
  });
}

/**
 * Archive a user (soft delete).
 *
 * A hard `user.delete()` CASCADEs to the user's bookings, payments and audit
 * trail — destroying financial history. Instead we set `deletedAt`: the row and
 * all its history stay, the account can no longer authenticate (see the auth
 * provider + JWT re-hydration `deletedAt` guards), and it drops out of active
 * listings. Email/phone are intentionally preserved on the archived row, so the
 * unique slots are NOT released — re-registering an archived account's email is
 * blocked by design. (Releasing/anonymising for reuse is a separate purge flow.)
 */
export async function adminDeleteUser(id: string, actorUserId: string) {
  return await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    if (before.deletedAt) throw new DomainError('not_found', 'not_found', 404);

    // Don't allow deleting yourself
    if (id === actorUserId) {
      throw new DomainError('cannot_delete_self', 'cannot_delete_self', 400);
    }

    // Separation-of-duties floor: archiving removes the account from the active
    // pool, so it may not strip the last DEVELOPER / last user-manager.
    const archiveDenial = checkUserArchive({
      currentRole: before.role,
      counts: await topTierCounts(tx, id),
    });
    if (archiveDenial) throw new DomainError(archiveDenial, archiveDenial, 403);

    const after = await tx.user.update({
      where: { id },
      // Bump tokenVersion so any live JWT for this account is evicted on its next
      // request — an archived account must lose access immediately, not just when
      // the re-hydration guard next reaches a reachable DB (it fails open on an
      // outage). Mirrors the password-reset / block eviction semantics.
      data: { deletedAt: new Date(), tokenVersion: { increment: 1 } },
    });

    await audit(tx, {
      actorUserId,
      action: 'DELETE',
      entityType: 'User',
      entityId: id,
      before: auditableUser(before),
      after: auditableUser(after),
    });
  });
}

/**
 * Block (ban) a user. Sets `blockedAt` (so the existing account can no longer
 * authenticate) AND writes every identifier — email / phone / national-id /
 * passport — to BlockedIdentity, so the same person cannot register again under
 * a new account. Reversible via {@link adminUnblockUser}. Refuses to block
 * yourself or a staff/admin account.
 */
export async function adminBlockUser(id: string, reason: string | null, actorUserId: string) {
  assertNotLocalNode('User blocking');
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, include: { profile: true } });
    if (!user || user.deletedAt) throw new DomainError('not_found', 'not_found', 404);
    if (id === actorUserId) throw new DomainError('cannot_block_self', 'cannot_block_self', 400);
    if (isPrivilegedRole(user.role)) {
      throw new DomainError('Cannot block a staff/admin account', 'cannot_block_staff', 403);
    }

    const cleanReason = reason?.trim().slice(0, 300) || null;
    const after = await tx.user.update({
      where: { id },
      // Bump tokenVersion so a live JWT is evicted on the banned user's next
      // request even if the DB is briefly unreachable (the re-hydration guard
      // fails open). Mirrors the password-reset eviction semantics.
      data: {
        blockedAt: new Date(),
        blockedReason: cleanReason,
        blockedById: actorUserId,
        tokenVersion: { increment: 1 },
      },
    });

    // Capture every identifier on the blocklist (idempotent per [kind, value]).
    const rows: { kind: BlockedIdentityKind; value: string }[] = [];
    if (user.email) rows.push({ kind: 'EMAIL', value: normIdentity('EMAIL', user.email) });
    if (user.phone) rows.push({ kind: 'PHONE', value: normIdentity('PHONE', user.phone) });
    if (user.profile?.nationalId) rows.push({ kind: 'NATIONAL_ID', value: normIdentity('NATIONAL_ID', user.profile.nationalId) });
    if (user.profile?.passportId) rows.push({ kind: 'PASSPORT', value: normIdentity('PASSPORT', user.profile.passportId) });
    for (const r of rows) {
      await tx.blockedIdentity.upsert({
        where: { kind_value: { kind: r.kind, value: r.value } },
        create: { kind: r.kind, value: r.value, userId: id, reason: cleanReason, blockedById: actorUserId },
        update: { userId: id, reason: cleanReason, blockedById: actorUserId },
      });
    }

    await audit(tx, {
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'User',
      entityId: id,
      before: auditableUser(user),
      after: { ...auditableUser(after), blocked: true, blockedIdentities: rows.length },
    });
  });
}

/** Lift a block: clear `blockedAt` + remove the user's blocklist entries. */
export async function adminUnblockUser(id: string, actorUserId: string) {
  assertNotLocalNode('User blocking');
  return await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    const after = await tx.user.update({
      where: { id },
      data: { blockedAt: null, blockedReason: null, blockedById: null },
    });
    await tx.blockedIdentity.deleteMany({ where: { userId: id } });
    await audit(tx, {
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'User',
      entityId: id,
      before: auditableUser(before),
      after: { ...auditableUser(after), blocked: false },
    });
  });
}
