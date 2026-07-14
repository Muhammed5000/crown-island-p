/**
 * Unit tests for the route-level role policy (src/server/auth/roles.ts).
 *
 * These predicates are the single source of truth for who may reach the admin
 * panel, the gate/reception/ops desks, and who may see money on the gate — so a
 * silent change here is a privilege bug. Pure functions, no DB.
 *
 * Run: npx tsx --test src/server/auth/roles.test.ts
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  canAccessAdmin,
  canAccessGate,
  canAccessOps,
  canAccessReception,
  canUseStaffPassword,
  canManageOps,
  canViewGateMoney,
  gateHomePath,
  isGateOnlyRole,
  isOpsStaffRole,
  isPrivilegedRole,
  isRestaurantOwner,
} from './roles';

const ADMINS = ['ADMIN', 'SUPER_ADMIN', 'DEVELOPER'] as const;
const RECEPTION = ['STAFF', 'SUPERVISOR', 'MANAGER', 'DIRECTOR'] as const;
const OPS = ['HOUSEKEEPING', 'MAINTENANCE'] as const;
const NON_STAFF = ['CUSTOMER', 'RESTAURANT', null, undefined, '', 'NONSENSE'] as const;

describe('roles policy', () => {
  it('canAccessAdmin: only the three admin tiers', () => {
    for (const r of ADMINS) assert.equal(canAccessAdmin(r), true, r);
    for (const r of [...RECEPTION, ...OPS, 'SECURITY', ...NON_STAFF]) {
      assert.equal(canAccessAdmin(r), false, String(r));
    }
  });

  it('canAccessGate: every staff role, never customers', () => {
    for (const r of [...ADMINS, ...RECEPTION, ...OPS, 'SECURITY']) {
      assert.equal(canAccessGate(r), true, r);
    }
    for (const r of NON_STAFF) assert.equal(canAccessGate(r), false, String(r));
  });

  it('canUseStaffPassword mirrors staff-area access', () => {
    for (const r of [...ADMINS, ...RECEPTION, ...OPS, 'SECURITY']) {
      assert.equal(canUseStaffPassword(r), true, r);
    }
    for (const r of NON_STAFF) assert.equal(canUseStaffPassword(r), false, String(r));
  });

  it('isPrivilegedRole mirrors gate access (used to block OAuth linking)', () => {
    for (const r of [...ADMINS, ...RECEPTION, ...OPS, 'SECURITY']) {
      assert.equal(isPrivilegedRole(r), true, r);
    }
    for (const r of NON_STAFF) assert.equal(isPrivilegedRole(r), false, String(r));
  });

  it('isGateOnlyRole: ground staff are confined; admins roam free', () => {
    for (const r of [...RECEPTION, ...OPS, 'SECURITY']) {
      assert.equal(isGateOnlyRole(r), true, r);
    }
    for (const r of [...ADMINS, ...NON_STAFF]) assert.equal(isGateOnlyRole(r), false, String(r));
  });

  it('canViewGateMoney: denied to SECURITY/HOUSEKEEPING/MAINTENANCE', () => {
    for (const r of [...RECEPTION, ...ADMINS]) assert.equal(canViewGateMoney(r), true, r);
    for (const r of ['SECURITY', ...OPS, ...NON_STAFF]) {
      assert.equal(canViewGateMoney(r), false, String(r));
    }
  });

  it('canAccessReception: reception ladder + admins, not SECURITY/ops', () => {
    for (const r of [...RECEPTION, ...ADMINS]) assert.equal(canAccessReception(r), true, r);
    for (const r of ['SECURITY', ...OPS, ...NON_STAFF]) {
      assert.equal(canAccessReception(r), false, String(r));
    }
  });

  it('canAccessOps: all gate roles except SECURITY', () => {
    for (const r of [...RECEPTION, ...OPS, ...ADMINS]) assert.equal(canAccessOps(r), true, r);
    for (const r of ['SECURITY', ...NON_STAFF]) assert.equal(canAccessOps(r), false, String(r));
  });

  it('canManageOps: only managers + admin tiers', () => {
    for (const r of ['MANAGER', 'DIRECTOR', ...ADMINS]) assert.equal(canManageOps(r), true, r);
    for (const r of ['STAFF', 'SUPERVISOR', ...OPS, 'SECURITY', ...NON_STAFF]) {
      assert.equal(canManageOps(r), false, String(r));
    }
  });

  it('isOpsStaffRole / isRestaurantOwner are exact', () => {
    for (const r of OPS) assert.equal(isOpsStaffRole(r), true, r);
    for (const r of [...RECEPTION, ...ADMINS, 'SECURITY', ...NON_STAFF]) {
      assert.equal(isOpsStaffRole(r), false, String(r));
    }
    assert.equal(isRestaurantOwner('RESTAURANT'), true);
    for (const r of [...ADMINS, ...RECEPTION, 'CUSTOMER', null]) {
      assert.equal(isRestaurantOwner(r), false, String(r));
    }
  });

  it('gateHomePath: ops staff land on the ops desk, everyone else on the scanner', () => {
    for (const r of OPS) assert.equal(gateHomePath(r), '/gate/ops', r);
    for (const r of [...RECEPTION, ...ADMINS, 'SECURITY']) {
      assert.equal(gateHomePath(r), '/gate/scan', r);
    }
  });
});
