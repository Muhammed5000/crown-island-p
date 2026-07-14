import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OpsTicketStatus } from '@prisma/client';
import {
  OPS_TRANSITIONS,
  OPS_OPEN_STATUSES,
  canTransition,
  isOpenStatus,
  workerMayTarget,
} from './ops-transitions';

const ALL: OpsTicketStatus[] = [
  'NEW',
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING',
  'COMPLETED',
  'CANCELLED',
  'REOPENED',
];

test('every status has a transition entry and never transitions to itself', () => {
  for (const s of ALL) {
    assert.ok(Array.isArray(OPS_TRANSITIONS[s]), `${s} missing from OPS_TRANSITIONS`);
    assert.equal(canTransition(s, s), false, `${s} → ${s} must be rejected`);
  }
});

test('happy path: NEW → ASSIGNED → IN_PROGRESS → COMPLETED', () => {
  assert.ok(canTransition('NEW', 'ASSIGNED'));
  assert.ok(canTransition('ASSIGNED', 'IN_PROGRESS'));
  assert.ok(canTransition('IN_PROGRESS', 'COMPLETED'));
});

test('waiting loop: IN_PROGRESS ↔ WAITING, WAITING → COMPLETED', () => {
  assert.ok(canTransition('IN_PROGRESS', 'WAITING'));
  assert.ok(canTransition('WAITING', 'IN_PROGRESS'));
  assert.ok(canTransition('WAITING', 'COMPLETED'));
});

test('terminal states only reopen', () => {
  for (const terminal of ['COMPLETED', 'CANCELLED'] as const) {
    for (const to of ALL) {
      assert.equal(
        canTransition(terminal, to),
        to === 'REOPENED',
        `${terminal} → ${to} should ${to === 'REOPENED' ? 'be allowed' : 'be rejected'}`,
      );
    }
  }
});

test('cannot jump backwards into NEW from anywhere', () => {
  for (const from of ALL) {
    assert.equal(canTransition(from, 'NEW'), false, `${from} → NEW must be rejected`);
  }
});

test('reopened behaves like an open ticket (can be worked and completed again)', () => {
  assert.ok(canTransition('REOPENED', 'ASSIGNED'));
  assert.ok(canTransition('REOPENED', 'IN_PROGRESS'));
  assert.ok(canTransition('REOPENED', 'COMPLETED'));
  assert.ok(canTransition('REOPENED', 'CANCELLED'));
});

test('isOpenStatus: terminal states are closed, the rest are open', () => {
  for (const s of ALL) {
    assert.equal(isOpenStatus(s), s !== 'COMPLETED' && s !== 'CANCELLED');
  }
  assert.equal(OPS_OPEN_STATUSES.length, 6);
});

test('workers may start/pause/hand-back/complete/reopen but never cancel or assign', () => {
  assert.ok(workerMayTarget('IN_PROGRESS'));
  assert.ok(workerMayTarget('WAITING'));
  assert.ok(workerMayTarget('OPEN'));
  assert.ok(workerMayTarget('COMPLETED'));
  assert.ok(workerMayTarget('REOPENED'));
  assert.equal(workerMayTarget('CANCELLED'), false);
  assert.equal(workerMayTarget('ASSIGNED'), false);
});
