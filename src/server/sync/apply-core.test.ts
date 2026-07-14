import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/server/db/prisma';
import { applyChange } from './apply-core';
import { createSyncTestBooking, createSyncTestUser } from './test-fixtures';

// booking_local_state has a plain-scalar bookingId (no FK), so it can be applied
// in isolation with a synthetic id — ideal for exercising the receiver.

test('applyChange rejects booking-domain and unknown entities (single-writer guard)', async () => {
  const booking = await applyChange({
    entityType: 'Booking',
    entityId: 'b1',
    payload: { id: 'b1' },
  });
  assert.equal(booking.ok, false);
  assert.equal(booking.error, 'entity_not_pushable');

  const payment = await applyChange({
    entityType: 'Payment',
    entityId: 'p1',
    payload: { id: 'p1' },
  });
  assert.equal(payment.ok, false);
  assert.equal(payment.error, 'entity_not_pushable');

  // The file-bytes lane (MediaFile) rides the outbox but must NEVER be accepted on
  // the JSON /apply channel — file bytes travel via /api/sync/upload-file only.
  const mediaFile = await applyChange({
    entityType: 'MediaFile',
    entityId: 'm1',
    payload: { id: 'm1' },
  });
  assert.equal(mediaFile.ok, false);
  assert.equal(mediaFile.error, 'entity_not_pushable');
  assert.equal(mediaFile.disposition, 'reject');
});

test('applyChange is an idempotent upsert-by-id (replay leaves one row)', async () => {
  const id = `test-apply-${process.hrtime.bigint().toString()}`;
  const payload = {
    id,
    bookingId: id,
    checkedInCount: 2,
    placementStatus: 'COMPLETE',
    zkProvisionStatus: 'NONE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const r1 = await applyChange({ entityType: 'BookingLocalState', entityId: id, payload });
  assert.equal(r1.ok, true);
  assert.equal(r1.applied, 'upsert');

  // Replay the SAME change (simulates a lost response after a successful write).
  const r2 = await applyChange({ entityType: 'BookingLocalState', entityId: id, payload });
  assert.equal(r2.ok, true);

  const rows = await prisma.bookingLocalState.findMany({ where: { id } });
  assert.equal(rows.length, 1, 'replay must not create a duplicate');
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.checkedInCount, 2);
  assert.equal(row.placementStatus, 'COMPLETE');

  // A later snapshot updates in place (no LWW, snapshot is authoritative).
  const r3 = await applyChange({
    entityType: 'BookingLocalState',
    entityId: id,
    payload: { ...payload, checkedInCount: 5 },
  });
  assert.equal(r3.ok, true);
  const after = await prisma.bookingLocalState.findUniqueOrThrow({ where: { id } });
  assert.equal(after.checkedInCount, 5);

  // delete is idempotent
  const d1 = await applyChange({
    entityType: 'BookingLocalState',
    entityId: id,
    op: 'delete',
    payload: {},
  });
  assert.equal(d1.applied, 'delete');
  const d2 = await applyChange({
    entityType: 'BookingLocalState',
    entityId: id,
    op: 'delete',
    payload: {},
  });
  assert.equal(d2.ok, true, 'deleting an absent row is a no-op, not an error');
});

test('applyChange(BookingLocalState) mirrors state through onto the Booking columns', async (t) => {
  // Use zkLastError — a plain nullable string with no check constraint.
  const fixture = await createSyncTestBooking('apply-mirror');
  t.after(fixture.cleanup);
  const { booking } = fixture;
  const orig = booking.zkLastError;
  const testVal = 'sync-mirror-test';

  const r = await applyChange({
    entityType: 'BookingLocalState',
    entityId: booking.id,
    payload: {
      id: booking.id,
      bookingId: booking.id,
      zkLastError: testVal,
      placementStatus: booking.placementStatus,
    },
  });
  assert.equal(r.ok, true);

  const bls = await prisma.bookingLocalState.findUnique({ where: { id: booking.id } });
  assert.equal(bls?.zkLastError, testVal, 'local-state row upserted');
  const after = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: { zkLastError: true },
  });
  assert.equal(after.zkLastError, testVal, 'mirror wrote through to the Booking column');

  // Restore the booking's original value (leave dev data untouched).
  await applyChange({
    entityType: 'BookingLocalState',
    entityId: booking.id,
    payload: {
      id: booking.id,
      bookingId: booking.id,
      zkLastError: orig,
      placementStatus: booking.placementStatus,
    },
  });
  const restored = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: { zkLastError: true },
  });
  assert.equal(restored.zkLastError, orig);
});

test('an explicitly-provided updatedAt is persisted VERBATIM (the version guard rests on this)', async () => {
  // Prisma only auto-fills @updatedAt when the field is absent from `data`; the
  // whole stale-snapshot guard depends on the stamped local-clock value being
  // stored as-is. If a Prisma upgrade ever changes that, this fails loudly.
  const id = `test-stamp-${process.hrtime.bigint().toString()}`;
  const t1 = new Date('2026-01-01T00:00:00.000Z');
  const r = await applyChange({
    entityType: 'BookingLocalState',
    entityId: id,
    payload: { id, bookingId: id, updatedAt: t1.toISOString() },
  });
  assert.equal(r.ok, true);
  const row = await prisma.bookingLocalState.findUniqueOrThrow({ where: { id } });
  assert.equal(row.updatedAt.getTime(), t1.getTime(), 'explicit updatedAt stored verbatim');
  await prisma.bookingLocalState.deleteMany({ where: { id } });
});

test('a STALE re-armed snapshot is a noop — it cannot regress row or mirrored Booking state', async (t) => {
  // The F1 regression scenario: check-in (older snapshot) quarantines, check-out
  // (newer) applies, recovery re-arms the older one — it must NOT un-check-out.
  const fixture = await createSyncTestBooking('apply-stale');
  t.after(fixture.cleanup);
  const { booking } = fixture;
  const t1 = new Date('2026-01-01T10:00:00.000Z');
  const t2 = new Date('2026-01-01T11:00:00.000Z');

  const newer = await applyChange({
    entityType: 'BookingLocalState',
    entityId: booking.id,
    payload: {
      id: booking.id,
      bookingId: booking.id,
      checkedOutCount: 5,
      updatedAt: t2.toISOString(),
    },
  });
  assert.equal(newer.applied, 'upsert');

  const stale = await applyChange({
    entityType: 'BookingLocalState',
    entityId: booking.id,
    payload: {
      id: booking.id,
      bookingId: booking.id,
      checkedOutCount: 0, // the pre-check-out state
      updatedAt: t1.toISOString(),
    },
  });
  assert.equal(stale.ok, true);
  assert.equal(stale.applied, 'noop', 'older snapshot must be skipped');

  const row = await prisma.bookingLocalState.findUniqueOrThrow({ where: { id: booking.id } });
  assert.equal(row.checkedOutCount, 5, 'row state not regressed');
  const parent = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: { checkedOutCount: true },
  });
  assert.equal(parent.checkedOutCount, 5, 'mirrored Booking column not regressed');
});

test('apply is ATOMIC per change: a failing upsert rolls back the staff stub too', async () => {
  const suffix = process.hrtime.bigint().toString();
  const id = `test-atomic-apply-${suffix}`;
  const stubId = `test-stub-${suffix}`;
  const r = await applyChange({
    entityType: 'GateScanEvent',
    entityId: id,
    payload: {
      id,
      operatorId: stubId, // ensureStaffStubs creates this User INSIDE the tx
      result: 'NOT_A_RESULT', // invalid enum → the upsert throws after the stub write
      people: 1,
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.disposition, 'retry');
  const stub = await prisma.user.findUnique({ where: { id: stubId } });
  assert.equal(stub, null, 'the stub写 must roll back with the failed upsert');
  assert.equal(await prisma.gateScanEvent.findUnique({ where: { id } }), null);
});

test('Sanction: a venue settlement with an OLDER clock still beats a stored ACTIVE row', async (t) => {
  const userFixture = await createSyncTestUser('apply-sanction');
  t.after(async () => {
    await prisma.sanction.deleteMany({ where: { userId: userFixture.user.id } });
    await userFixture.cleanup();
  });
  const stored = await prisma.sanction.create({
    data: {
      userId: userFixture.user.id,
      amountCents: 5000,
      reason: 'sync-test fine',
      createdById: userFixture.user.id,
      status: 'ACTIVE',
    },
  });

  // Real pushes are WHOLE-ROW snapshots (enqueueById re-reads every scalar) —
  // Prisma validates the upsert's create branch even when only update runs, so
  // the payload must be complete like production's.
  const snapshotBase = {
    id: stored.id,
    userId: stored.userId,
    amountCents: stored.amountCents,
    reason: stored.reason,
    notes: null,
    createdById: stored.createdById,
    pendingBookingId: null,
    paidByBookingId: null,
    settlementNote: null,
    createdAt: stored.createdAt.toISOString(),
  };

  // The venue clock LAGS the cloud: the settlement snapshot's updatedAt is one
  // hour OLDER than the stored row's — the old cross-clock LWW dropped exactly
  // this write. The domain rule must apply it anyway.
  const settle = await applyChange({
    entityType: 'Sanction',
    entityId: stored.id,
    payload: {
      ...snapshotBase,
      status: 'PAID',
      settledAt: new Date().toISOString(),
      settledById: userFixture.user.id,
      updatedAt: new Date(stored.updatedAt.getTime() - 3_600_000).toISOString(),
    },
  });
  assert.equal(settle.ok, true);
  assert.equal(settle.applied, 'upsert', 'settlement wins regardless of clocks');
  const afterSettle = await prisma.sanction.findUniqueOrThrow({ where: { id: stored.id } });
  assert.equal(afterSettle.status, 'PAID');

  // And the reverse: a (re-armed, stale) ACTIVE snapshot must never UN-settle.
  const unsettle = await applyChange({
    entityType: 'Sanction',
    entityId: stored.id,
    payload: {
      ...snapshotBase,
      status: 'ACTIVE',
      settledAt: null,
      settledById: null,
      updatedAt: new Date().toISOString(), // even with a NEWER stamp
    },
  });
  assert.equal(unsettle.ok, true);
  assert.equal(unsettle.applied, 'noop');
  const still = await prisma.sanction.findUniqueOrThrow({ where: { id: stored.id } });
  assert.equal(still.status, 'PAID', 'push can never un-settle');
});

test('unknown payload keys are stripped (rollout skew) instead of burning retries', async () => {
  const id = `test-junkkey-${process.hrtime.bigint().toString()}`;
  const r = await applyChange({
    entityType: 'BookingLocalState',
    entityId: id,
    payload: {
      id,
      bookingId: id,
      checkedInCount: 1,
      updatedAt: new Date().toISOString(),
      aColumnOnlyNewerLocalsHave: 'ignore me',
    },
  });
  assert.equal(r.ok, true, 'junk key must not fail the apply');
  const row = await prisma.bookingLocalState.findUniqueOrThrow({ where: { id } });
  assert.equal(row.checkedInCount, 1);
  await prisma.bookingLocalState.deleteMany({ where: { id } });
});

test('a DB refusal returns a CLASSIFIED error code, never the raw Prisma message', async () => {
  const suffix = process.hrtime.bigint().toString();
  const id = `test-fkerr-${suffix}`;
  const r = await applyChange({
    entityType: 'GateScanEvent',
    entityId: id,
    payload: {
      id,
      operatorId: `test-fkerr-op-${suffix}`,
      result: 'DENIED',
      people: 0,
      bookingId: 'this-booking-does-not-exist', // FK → P2003
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.disposition, 'retry', 'an FK gap is transient (the parent may sync later)');
  assert.equal(r.error, 'P2003:fk_missing', 'compact classification only');
  assert.ok(!/foreign key|constraint|violat/i.test(r.error ?? ''), 'no raw DB text over the wire');
});
