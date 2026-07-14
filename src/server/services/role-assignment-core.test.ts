/**
 * Separation-of-duties tests for admin user-management role assignment.
 *
 *   npx tsx --test src/server/services/role-assignment-core.test.ts
 *
 * These pin the invariants that keep a SUPER_ADMIN from self-escalating to
 * DEVELOPER, changing their own role, or stripping the last account that can
 * manage users. A regression here re-opens a vertical-privilege gap.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { UserRole } from '@prisma/client';
import { checkRoleCreate, checkRoleUpdate, checkUserArchive } from './role-assignment-core';

const HEALTHY = { otherDevelopers: 2, otherManagers: 3 } as const;

describe('checkRoleCreate', () => {
  it('only a DEVELOPER may create a DEVELOPER', () => {
    assert.equal(checkRoleCreate('DEVELOPER', 'DEVELOPER'), null);
    assert.equal(checkRoleCreate('SUPER_ADMIN', 'DEVELOPER'), 'cannot_assign_developer');
    assert.equal(checkRoleCreate('ADMIN', 'DEVELOPER'), 'cannot_assign_developer');
  });

  it('any actor may create non-DEVELOPER roles', () => {
    for (const r of ['CUSTOMER', 'STAFF', 'ADMIN', 'SUPER_ADMIN'] as UserRole[]) {
      assert.equal(checkRoleCreate('SUPER_ADMIN', r), null, r);
    }
  });
});

describe('checkRoleUpdate — grant DEVELOPER', () => {
  it('SUPER_ADMIN cannot promote anyone to DEVELOPER', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'SUPER_ADMIN',
        actorUserId: 'a',
        targetUserId: 'b',
        currentRole: 'ADMIN',
        newRole: 'DEVELOPER',
        counts: HEALTHY,
      }),
      'cannot_assign_developer',
    );
  });

  it('DEVELOPER can promote to DEVELOPER', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'DEVELOPER',
        actorUserId: 'a',
        targetUserId: 'b',
        currentRole: 'ADMIN',
        newRole: 'DEVELOPER',
        counts: HEALTHY,
      }),
      null,
    );
  });
});

describe('checkRoleUpdate — self role change', () => {
  it('an admin cannot change their own role', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'SUPER_ADMIN',
        actorUserId: 'me',
        targetUserId: 'me',
        currentRole: 'SUPER_ADMIN',
        newRole: 'ADMIN',
        counts: HEALTHY,
      }),
      'cannot_change_own_role',
    );
  });

  it('editing your own record WITHOUT changing role is allowed (name/email edits)', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'SUPER_ADMIN',
        actorUserId: 'me',
        targetUserId: 'me',
        currentRole: 'SUPER_ADMIN',
        newRole: 'SUPER_ADMIN',
        counts: HEALTHY,
      }),
      null,
    );
  });

  it('self-role check fires before the developer-grant rule', () => {
    // A DEVELOPER editing themselves to a lower role is a self-change, not a grant.
    assert.equal(
      checkRoleUpdate({
        actorRole: 'DEVELOPER',
        actorUserId: 'me',
        targetUserId: 'me',
        currentRole: 'DEVELOPER',
        newRole: 'ADMIN',
        counts: { otherDevelopers: 1, otherManagers: 2 },
      }),
      'cannot_change_own_role',
    );
  });
});

describe('checkRoleUpdate — last-tier floors', () => {
  it('cannot demote the last DEVELOPER', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'DEVELOPER',
        actorUserId: 'a',
        targetUserId: 'b',
        currentRole: 'DEVELOPER',
        newRole: 'ADMIN',
        counts: { otherDevelopers: 0, otherManagers: 4 },
      }),
      'cannot_demote_last_developer',
    );
  });

  it('CAN demote a DEVELOPER when another DEVELOPER remains', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'DEVELOPER',
        actorUserId: 'a',
        targetUserId: 'b',
        currentRole: 'DEVELOPER',
        newRole: 'ADMIN',
        counts: { otherDevelopers: 1, otherManagers: 4 },
      }),
      null,
    );
  });

  it('cannot strip the last user-manager (SUPER_ADMIN with no other managers)', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'DEVELOPER',
        actorUserId: 'a',
        targetUserId: 'b',
        currentRole: 'SUPER_ADMIN',
        newRole: 'ADMIN',
        counts: { otherDevelopers: 0, otherManagers: 0 },
      }),
      'cannot_remove_last_admin',
    );
  });

  it('CAN demote a SUPER_ADMIN when another manager remains', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'DEVELOPER',
        actorUserId: 'a',
        targetUserId: 'b',
        currentRole: 'SUPER_ADMIN',
        newRole: 'ADMIN',
        counts: { otherDevelopers: 0, otherManagers: 1 },
      }),
      null,
    );
  });

  it('a normal STAFF/CUSTOMER role edit is unaffected', () => {
    assert.equal(
      checkRoleUpdate({
        actorRole: 'SUPER_ADMIN',
        actorUserId: 'a',
        targetUserId: 'b',
        currentRole: 'CUSTOMER',
        newRole: 'STAFF',
        counts: { otherDevelopers: 0, otherManagers: 1 },
      }),
      null,
    );
  });
});

describe('checkUserArchive', () => {
  it('cannot archive the last DEVELOPER', () => {
    assert.equal(
      checkUserArchive({ currentRole: 'DEVELOPER', counts: { otherDevelopers: 0, otherManagers: 2 } }),
      'cannot_demote_last_developer',
    );
  });

  it('cannot archive the last user-manager', () => {
    assert.equal(
      checkUserArchive({ currentRole: 'SUPER_ADMIN', counts: { otherDevelopers: 0, otherManagers: 0 } }),
      'cannot_remove_last_admin',
    );
  });

  it('archiving a normal customer/staff is always allowed', () => {
    assert.equal(
      checkUserArchive({ currentRole: 'CUSTOMER', counts: { otherDevelopers: 0, otherManagers: 0 } }),
      null,
    );
    assert.equal(
      checkUserArchive({ currentRole: 'STAFF', counts: { otherDevelopers: 1, otherManagers: 2 } }),
      null,
    );
  });

  it('CAN archive a DEVELOPER when another remains', () => {
    assert.equal(
      checkUserArchive({ currentRole: 'DEVELOPER', counts: { otherDevelopers: 1, otherManagers: 3 } }),
      null,
    );
  });
});
