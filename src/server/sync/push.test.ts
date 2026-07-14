import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/server/db/prisma';
import { drainOutbox, recoverQuarantined, pruneSyncQueue, type ApplySender } from './push';
import { MEDIA_FILE_ENTITY } from './outbox';

const TAG = 'pushtest';

async function seedThree() {
  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: TAG } } });
  const base = 1_700_000_000_000;
  const names = ['A', 'B', 'C'];
  for (let i = 0; i < names.length; i++) {
    await prisma.syncQueue.create({
      data: {
        entityType: 'GateScanEvent',
        entityId: `${TAG}-${names[i]}`,
        op: 'upsert',
        payload: { id: `${TAG}-${names[i]}` },
        createdAt: new Date(base + i * 1000), // deterministic FIFO order
      },
    });
  }
}

const okSender: ApplySender = async (row) => ({
  httpOk: true,
  status: 200,
  confirmedId: row.entityId,
});

test('drainOutbox pushes FIFO by createdAt, one at a time, each confirmed', async () => {
  await seedThree();
  const order: string[] = [];
  const res = await drainOutbox({
    send: async (row) => {
      order.push(row.entityId);
      return okSender(row);
    },
  });
  assert.deepEqual(order, [`${TAG}-A`, `${TAG}-B`, `${TAG}-C`]);
  assert.equal(res.pushed, 3);
  assert.equal(res.stopped, false);
  const pending = await prisma.syncQueue.count({
    where: { entityId: { startsWith: TAG }, status: 'pending' },
  });
  assert.equal(pending, 0);
  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: TAG } } });
});

test('drainOutbox SKIPS a failing row and keeps draining (no head-of-line block)', async () => {
  // ONLINE-MASTER model: pushables are independent operational rows, so a single
  // stuck row (e.g. one blocked by a not-yet-deployed online migration) must NOT
  // wedge every later push behind it. The drain skips it and moves on; the failed
  // row stays pending (attempts bumped) for a later tick.
  await seedThree();
  let failB = true;
  const send: ApplySender = async (row) => {
    if (failB && row.entityId === `${TAG}-B`) {
      return { httpOk: false, status: 500, confirmedId: null };
    }
    return okSender(row);
  };

  const first = await drainOutbox({ send });
  assert.equal(first.pushed, 2, 'A and C push; only B fails');
  assert.equal(first.stopped, false);

  const a = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${TAG}-A` } });
  const b = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${TAG}-B` } });
  const c = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${TAG}-C` } });
  assert.equal(a.status, 'synced');
  assert.equal(c.status, 'synced', 'the row AFTER the failure is not blocked');
  assert.equal(b.status, 'pending');
  assert.equal(b.attempts, 1, 'failed item is marked for retry');

  // Clear the fault → next tick pushes B (C is already synced).
  failB = false;
  const order: string[] = [];
  const second = await drainOutbox({
    send: async (row) => {
      order.push(row.entityId);
      return okSender(row);
    },
  });
  assert.deepEqual(order, [`${TAG}-B`]);
  assert.equal(second.pushed, 1);

  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: TAG } } });
});

test('drainOutbox does not count an unconfirmed 200 as pushed, but keeps draining', async () => {
  await seedThree();
  const send: ApplySender = async (row) => {
    if (row.entityId === `${TAG}-A`) return { httpOk: true, status: 200, confirmedId: null }; // 200 but not confirmed
    return okSender(row);
  };
  const res = await drainOutbox({ send });
  assert.equal(res.pushed, 2, 'B and C push; the unconfirmed A is not counted');
  const a = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${TAG}-A` } });
  assert.equal(a.status, 'pending', 'the unconfirmed row stays pending for retry');
  assert.equal(a.attempts, 1);
  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: TAG } } });
});

test('drainOutbox quarantines a row that keeps failing (poison-pill protection)', async () => {
  await seedThree();
  // A permanent reject → quarantined immediately; B always network-fails → quarantined
  // after MAX_ATTEMPTS ticks; C keeps flowing throughout.
  const send: ApplySender = async (row) => {
    if (row.entityId === `${TAG}-A`) {
      return { httpOk: false, status: 422, confirmedId: null, disposition: 'reject' };
    }
    if (row.entityId === `${TAG}-B`) return { httpOk: false, status: 0, confirmedId: null };
    return okSender(row);
  };
  // First tick: C pushes; A is quarantined (permanent reject); B is pending (attempt 1).
  const first = await drainOutbox({ send });
  assert.equal(first.pushed, 1, 'only C confirmed');
  const a1 = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${TAG}-A` } });
  assert.equal(a1.status, 'failed', 'a permanent reject is quarantined at once');

  // Drive B to the attempt cap → it too is quarantined, and never blocks anything.
  for (let i = 0; i < 5; i++) await drainOutbox({ send });
  const b = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${TAG}-B` } });
  assert.equal(b.status, 'failed', 'a row that keeps failing is quarantined after the cap');

  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: TAG } } });
});

const FTAG = 'filetest';

test('drainOutbox routes MediaFile rows to the file sender, everything else to the JSON sender', async () => {
  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: FTAG } } });
  await prisma.syncQueue.create({
    data: {
      entityType: 'GateScanEvent',
      entityId: `${FTAG}-json`,
      op: 'upsert',
      payload: { id: `${FTAG}-json` },
      createdAt: new Date(1_700_000_100_000),
    },
  });
  await prisma.syncQueue.create({
    data: {
      entityType: MEDIA_FILE_ENTITY,
      entityId: `${FTAG}-file`,
      op: 'upsert',
      payload: { url: '/api/secure-media/2026/07/cccccccccccccccccccccccc.jpg', mimeType: 'image/jpeg', sha256: null },
      createdAt: new Date(1_700_000_101_000),
    },
  });

  const jsonSeen: string[] = [];
  const fileSeen: string[] = [];
  const confirm: ApplySender = async (row) => ({ httpOk: true, status: 200, confirmedId: row.entityId });
  const res = await drainOutbox({
    send: async (row) => {
      jsonSeen.push(row.entityId);
      return confirm(row);
    },
    sendFile: async (row) => {
      fileSeen.push(row.entityId);
      return confirm(row);
    },
  });
  assert.deepEqual(jsonSeen, [`${FTAG}-json`], 'JSON sender saw only the gate event');
  assert.deepEqual(fileSeen, [`${FTAG}-file`], 'file sender saw only the MediaFile row');
  assert.equal(res.pushed, 2);
  const rows = await prisma.syncQueue.findMany({ where: { entityId: { startsWith: FTAG } } });
  for (const r of rows) assert.equal(r.status, 'synced', `${r.entityId} confirmed`);

  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: FTAG } } });
});

test('drainOutbox: a MediaFile send failure stays pending (attempts++); a reject quarantines', async () => {
  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: FTAG } } });
  await prisma.syncQueue.create({
    data: {
      entityType: MEDIA_FILE_ENTITY,
      entityId: `${FTAG}-x`,
      op: 'upsert',
      payload: { url: '/api/secure-media/2026/07/dddddddddddddddddddddddd.jpg', mimeType: 'image/jpeg' },
      createdAt: new Date(1_700_000_200_000),
    },
  });

  // Transient failure (e.g. online briefly unreachable) → stays pending for retry.
  await drainOutbox({ sendFile: async () => ({ httpOk: false, status: 0, confirmedId: null }) });
  const x1 = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${FTAG}-x` } });
  assert.equal(x1.status, 'pending');
  assert.equal(x1.attempts, 1);

  // Permanent reject (e.g. local file missing/corrupt) → quarantined at once.
  await drainOutbox({ sendFile: async () => ({ httpOk: false, status: 0, confirmedId: null, disposition: 'reject' }) });
  const x2 = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${FTAG}-x` } });
  assert.equal(x2.status, 'failed');

  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: FTAG } } });
});

const RTAG = 'recovertest';

test('recoverQuarantined re-arms with a budget, then DEAD-LETTERS (poison rows go quiet)', async () => {
  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: RTAG } } });
  // Isolate: recovery is a global updateMany over status='failed' — park any
  // stray failed rows from earlier tests out of its reach for this test.
  await prisma.syncQueue.updateMany({ where: { status: 'failed' }, data: { status: 'dead' } });
  await prisma.syncState.deleteMany({ where: { key: 'recover:lastRunAt' } });

  await prisma.syncQueue.create({
    data: {
      entityType: 'GateScanEvent',
      entityId: `${RTAG}-poison`,
      op: 'upsert',
      payload: { id: `${RTAG}-poison` },
      status: 'failed',
      attempts: 5,
    },
  });

  const base = Date.now();
  const step = 11 * 60_000; // > RECOVER_INTERVAL_MS so the throttle never blocks

  await recoverQuarantined(new Date(base));
  const armed = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${RTAG}-poison` } });
  assert.equal(armed.status, 'pending');
  assert.equal(armed.attempts, 0);
  assert.equal(armed.recoveries, 1, 'each re-arm spends recovery budget');
  await prisma.syncQueue.update({ where: { id: armed.id }, data: { status: 'failed' } });

  // Throttle: a second call inside the 10-min window is a no-op.
  const throttled = await recoverQuarantined(new Date(base + 1000));
  assert.equal(throttled, 0, 'inside the window recovery is throttled');
  const still = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${RTAG}-poison` } });
  assert.equal(still.status, 'failed');

  // Spend the rest of the budget: MAX_RECOVERIES = 6 total re-arms...
  for (let i = 2; i <= 6; i++) {
    await recoverQuarantined(new Date(base + i * step));
    const row = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${RTAG}-poison` } });
    assert.equal(row.status, 'pending');
    assert.equal(row.recoveries, i);
    await prisma.syncQueue.update({ where: { id: row.id }, data: { status: 'failed' } });
  }
  // ...the NEXT recovery buries it instead of re-arming.
  await recoverQuarantined(new Date(base + 7 * step));
  const dead = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${RTAG}-poison` } });
  assert.equal(dead.status, 'dead', 'budget spent, terminal dead-letter');

  // A dead row is invisible to the drain AND to later recoveries.
  await drainOutbox({
    send: async (row) => {
      assert.notEqual(row.entityId, `${RTAG}-poison`, 'drain must never pick a dead row');
      return { httpOk: true, status: 200, confirmedId: row.entityId };
    },
  });
  await recoverQuarantined(new Date(base + 8 * step));
  const afterRecover = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: `${RTAG}-poison` } });
  assert.equal(afterRecover.status, 'dead', 'dead rows are never auto re-armed');

  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: RTAG } } });
});

test('drainOutbox never selects superseded rows', async () => {
  const marker = `${RTAG}-superseded`;
  await prisma.syncQueue.deleteMany({ where: { entityId: marker } });
  await prisma.syncQueue.create({
    data: { entityType: 'ZkCard', entityId: marker, op: 'upsert', payload: { id: marker }, status: 'superseded' },
  });
  await drainOutbox({
    send: async (row) => {
      assert.notEqual(row.entityId, marker, 'superseded rows are terminal');
      return { httpOk: true, status: 200, confirmedId: row.entityId };
    },
  });
  const row = await prisma.syncQueue.findFirstOrThrow({ where: { entityId: marker } });
  assert.equal(row.status, 'superseded');
  await prisma.syncQueue.deleteMany({ where: { entityId: marker } });
});

const PTAG = 'prunetest';

test('pruneSyncQueue removes old finished rows on a daily throttle; pending is never touched', async () => {
  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: PTAG } } });
  await prisma.syncState.deleteMany({ where: { key: 'prune:lastRunAt' } });

  const now = Date.now();
  const day = 86_400_000;
  const mk = (suffix: string, data: Record<string, unknown>) =>
    prisma.syncQueue.create({
      data: {
        entityType: 'GateScanEvent',
        entityId: `${PTAG}-${suffix}`,
        op: 'upsert',
        payload: { id: `${PTAG}-${suffix}` },
        ...data,
      } as never,
    });
  // Retention default = 14d (synced/superseded), dead x4 (56d).
  await mk('synced-old', { status: 'synced', syncedAt: new Date(now - 20 * day) });
  await mk('synced-new', { status: 'synced', syncedAt: new Date(now - 2 * day) });
  await mk('superseded-old', { status: 'superseded', createdAt: new Date(now - 20 * day) });
  await mk('dead-old', { status: 'dead', createdAt: new Date(now - 60 * day) });
  await mk('dead-recent', { status: 'dead', createdAt: new Date(now - 20 * day) });
  await mk('pending-old', { status: 'pending', createdAt: new Date(now - 400 * day) });

  const pruned = await pruneSyncQueue(new Date(now));
  assert.ok(pruned >= 3, 'the three over-retention rows are pruned');

  const left = new Set(
    (await prisma.syncQueue.findMany({ where: { entityId: { startsWith: PTAG } } })).map((r) =>
      r.entityId.slice(PTAG.length + 1),
    ),
  );
  assert.deepEqual(
    [...left].sort(),
    ['dead-recent', 'pending-old', 'synced-new'],
    'recent finished rows, younger dead rows, and ALL pending rows survive',
  );

  // Throttle: a second run inside 24h is a no-op even with prunable rows present.
  const target = await prisma.syncQueue.findFirstOrThrow({
    where: { entityId: `${PTAG}-synced-new` },
  });
  await prisma.syncQueue.update({
    where: { id: target.id },
    data: { syncedAt: new Date(now - 30 * day) },
  });
  const second = await pruneSyncQueue(new Date(now + 60_000));
  assert.equal(second, 0, 'daily throttle holds');

  await prisma.syncQueue.deleteMany({ where: { entityId: { startsWith: PTAG } } });
});
