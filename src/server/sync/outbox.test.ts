import { test } from 'node:test';
import assert from 'node:assert/strict';
// The outbox only writes on APP_MODE=local — set it before the module reads env.
process.env.APP_MODE = 'local';
import { prisma } from '@/server/db/prisma';
import { enqueueOutbox, enqueueById, enqueueFilePush, isPushable, MEDIA_FILE_ENTITY } from './outbox';
import { enqueueBookingLocalState } from './booking-local-state';
import { createSyncTestBooking } from './test-fixtures';

test('isPushable rejects booking-domain rows and accepts local-owned ones', () => {
  // Booking-domain models are online-owned — never pushed from local.
  assert.equal(isPushable('Booking'), false);
  assert.equal(isPushable('Invoice'), false);
  assert.equal(isPushable('Payment'), false);
  assert.equal(isPushable('BookingSlot'), false);
  // Local-owned operational rows.
  assert.equal(isPushable('BookingLocalState'), true);
  assert.equal(isPushable('UnitPlacement'), true);
  assert.equal(isPushable('GateScanEvent'), true);
});

test('enqueueById snapshots a row by id (scalars only) on local', async () => {
  process.env.APP_MODE = 'local';
  const ev = await prisma.gateScanEvent.findFirst();
  if (!ev) return; // dev DB has no gate events — nothing to snapshot
  await prisma.$transaction((tx) => enqueueById(tx, 'GateScanEvent', ev.id));
  const q = await prisma.syncQueue.findFirst({
    where: { entityType: 'GateScanEvent', entityId: ev.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(q, 'a snapshot row was enqueued');
  assert.equal(q.op, 'upsert');
  const payload = q.payload as Record<string, unknown>;
  assert.equal(payload.id, ev.id, 'payload is the row snapshot');
  assert.ok(!('operator' in payload), 'scalars only — no relation objects');
  await prisma.syncQueue.deleteMany({ where: { entityType: 'GateScanEvent', entityId: ev.id } });
});

test('enqueueOutbox is a no-op when APP_MODE is not local (online never enqueues)', async () => {
  const prev = process.env.APP_MODE;
  process.env.APP_MODE = 'online';
  const marker = `test-offlocal-${process.hrtime.bigint().toString()}`;
  const res = await prisma.$transaction((tx) =>
    enqueueOutbox(tx, { entityType: 'GateScanEvent', entityId: marker, payload: { id: marker } }),
  );
  assert.equal(res, null, 'returns null off-local');
  const found = await prisma.syncQueue.findFirst({ where: { entityId: marker } });
  assert.equal(found, null, 'nothing is written to the outbox off-local');
  process.env.APP_MODE = prev;
});

test('enqueueOutbox is a no-op for a non-pushable (online-owned) entity — no row', async () => {
  // ONLINE-MASTER: booking-domain / catalog rows are PULLED, never pushed. A call
  // site that references one is a safe no-op (its local edit is transient — the
  // next pull re-asserts online's copy), not a hard throw that would abort the
  // caller's transaction. A dev-only console.warn still flags a genuinely mis-wired seam.
  process.env.APP_MODE = 'local';
  const marker = `test-nonpush-${process.hrtime.bigint().toString()}`;
  const res = await prisma.$transaction((tx) =>
    enqueueOutbox(tx, {
      // Cast: the type system already forbids this; we assert the runtime guard too.
      entityType: 'Booking' as unknown as 'GateScanEvent',
      entityId: marker,
      payload: {},
    }),
  );
  assert.equal(res, null, 'a non-pushable entity returns null (online-owned → pulled, not pushed)');
  const found = await prisma.syncQueue.findFirst({ where: { entityId: marker } });
  assert.equal(found, null, 'no outbox row is written for an online-owned entity');
});

test('enqueueOutbox row is atomic with the caller transaction', async () => {
  const marker = `test-atomic-${process.hrtime.bigint().toString()}`;

  // 1) A transaction that enqueues then throws must leave NO outbox row.
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        entityType: 'GateScanEvent',
        entityId: marker,
        payload: { id: marker },
      });
      throw new Error('force rollback');
    }),
  );
  const afterRollback = await prisma.syncQueue.findFirst({ where: { entityId: marker } });
  assert.equal(afterRollback, null, 'outbox row must not survive a rolled-back transaction');

  // 2) A committed transaction leaves exactly one pending row.
  await prisma.$transaction(async (tx) => {
    await enqueueOutbox(tx, {
      entityType: 'GateScanEvent',
      entityId: marker,
      payload: { id: marker },
    });
  });
  const rows = await prisma.syncQueue.findMany({ where: { entityId: marker } });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row);
  assert.equal(row.status, 'pending');
  assert.equal(row.op, 'upsert');
  assert.equal(row.entityType, 'GateScanEvent');

  await prisma.syncQueue.deleteMany({ where: { entityId: marker } });
});

test('MediaFile is deliberately NOT pushable (the JSON /apply channel stays closed to it)', () => {
  // apply-core shares isPushable() as its allow-list, so this guarantees a raw
  // file row can never be applied as a JSON upsert — it must go via the file lane.
  assert.equal(isPushable(MEDIA_FILE_ENTITY), false);
  assert.equal(isPushable('MediaFile'), false);
});

test('enqueueFilePush writes a MediaFile lane row on local, no-op off-local', async () => {
  const prev = process.env.APP_MODE;

  // Off-local → null, nothing written.
  process.env.APP_MODE = 'online';
  const offMarker = `test-filepush-off-${process.hrtime.bigint().toString()}`;
  const off = await prisma.$transaction((tx) =>
    enqueueFilePush(tx, { mediaId: offMarker, url: '/api/secure-media/2026/07/aaaa.jpg', mimeType: 'image/jpeg' }),
  );
  assert.equal(off, null, 'no-op off-local');
  assert.equal(await prisma.syncQueue.findFirst({ where: { entityId: offMarker } }), null);

  // On local → exactly one MediaFile row carrying the pointer + hash payload.
  process.env.APP_MODE = 'local';
  const mediaId = `test-filepush-${process.hrtime.bigint().toString()}`;
  const url = '/api/secure-media/2026/07/bbbbbbbbbbbbbbbbbbbbbbbb.jpg';
  const res = await prisma.$transaction((tx) =>
    enqueueFilePush(tx, { mediaId, url, mimeType: 'image/jpeg', sha256: 'abc123', uploadedById: 'staff-1' }),
  );
  assert.ok(res, 'returns the queued row id on local');
  const row = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: mediaId } });
  assert.equal(row.entityType, MEDIA_FILE_ENTITY);
  assert.equal(row.op, 'upsert');
  assert.equal(row.status, 'pending');
  const payload = row.payload as Record<string, unknown>;
  assert.equal(payload.url, url);
  assert.equal(payload.mimeType, 'image/jpeg');
  assert.equal(payload.sha256, 'abc123');
  assert.equal(payload.uploadedById, 'staff-1');

  await prisma.syncQueue.deleteMany({ where: { entityId: mediaId } });
  process.env.APP_MODE = prev;
});

test('enqueueBookingLocalState stamps updatedAt into the snapshot (the version-guard input)', async (t) => {
  process.env.APP_MODE = 'local';
  const fixture = await createSyncTestBooking('outbox-stamp');
  t.after(async () => {
    await prisma.syncQueue.deleteMany({
      where: { entityType: 'BookingLocalState', entityId: fixture.booking.id },
    });
    await fixture.cleanup();
  });

  const before = Date.now();
  await prisma.$transaction((tx) => enqueueBookingLocalState(tx, fixture.booking.id));
  const q = await prisma.syncQueue.findFirstOrThrow({
    where: { entityType: 'BookingLocalState', entityId: fixture.booking.id },
    orderBy: { createdAt: 'desc' },
  });
  const payload = q.payload as Record<string, unknown>;
  assert.equal(typeof payload.updatedAt, 'string', 'snapshot carries an ISO updatedAt stamp');
  const stamped = new Date(payload.updatedAt as string).getTime();
  assert.ok(Number.isFinite(stamped), 'the stamp parses');
  assert.ok(stamped >= before - 1000 && stamped <= Date.now() + 1000, 'stamped at enqueue time');
  // ...and the state fields still ride along.
  assert.ok('checkedInCount' in payload);
  assert.equal(payload.bookingId, fixture.booking.id);
});

test("enqueueing a DELETE supersedes that entity's queued upserts (A-09 at the source)", async () => {
  process.env.APP_MODE = 'local';
  const marker = `test-supersede-${process.hrtime.bigint().toString()}`;

  // A pending upsert (as if a snapshot push failed earlier and is still queued)...
  await prisma.$transaction((tx) =>
    enqueueOutbox(tx, { entityType: 'ZkCard', entityId: marker, payload: { id: marker } }),
  );
  // ...and a quarantined one for the same entity.
  await prisma.syncQueue.create({
    data: { entityType: 'ZkCard', entityId: marker, op: 'upsert', payload: { id: marker }, status: 'failed' },
  });

  await prisma.$transaction((tx) => enqueueById(tx, 'ZkCard', marker, 'delete'));

  const rows = await prisma.syncQueue.findMany({
    where: { entityType: 'ZkCard', entityId: marker },
    orderBy: { createdAt: 'asc' },
  });
  const upserts = rows.filter((r) => r.op === 'upsert');
  const deletes = rows.filter((r) => r.op === 'delete');
  assert.equal(upserts.length, 2);
  for (const u of upserts) {
    assert.equal(u.status, 'superseded', 'queued upserts can no longer resurrect the row');
    assert.equal(u.lastError, 'superseded_by_delete');
  }
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0]?.status, 'pending', 'the delete itself still ships');

  await prisma.syncQueue.deleteMany({ where: { entityType: 'ZkCard', entityId: marker } });
});
