import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/server/db/prisma';
import { getChangesSince } from './changes-core';
import { pullBookings, pullAll } from './pull';
import { SYNC_PULL_SAFETY_LAG_MS } from './config';
import { createSyncTestBooking, createSyncTestUser } from './test-fixtures';

test('getChangesSince(null) minimizes customer credentials in the booking bundle', async (t) => {
  const fixture = await createSyncTestUser('pull-credentials');
  t.after(fixture.cleanup);
  const totalBookings = await prisma.booking.count();
  const bundle = await getChangesSince(null);

  assert.equal(bundle.bookings.length, totalBookings, 'a null cursor pulls every booking');
  assert.ok(bundle.nextCursor, 'a server-clock cursor is returned');
  assert.ok(bundle.bookingUnits.length >= 0);

  // Customer/partner verifiers are not needed for venue operations. Only staff
  // roles retain the credentials required for local/offline staff login.
  assert.ok(bundle.users.length > 0, 'the bundle carries user accounts');
  const syncedFixture = (bundle.users as Record<string, unknown>[]).find(
    (u) => u.id === fixture.user.id,
  );
  assert.ok(syncedFixture, 'the referenced customer account is present');
  assert.equal(syncedFixture.passwordHash, null, 'customer password hash is removed');
  assert.equal(syncedFixture.pinHash, null, 'customer PIN hash is removed');
});

test('the cursor advances with a bounded safety-lag overlap — old rows are not re-sent', async () => {
  const first = await getChangesSince(null);
  // The PERSISTED cursor is rolled back by the safety lag (changes-core A-06), so
  // the next window re-scans only that recent tail — never the whole set. Every
  // re-sent booking must therefore be very recent; anything older is not resent.
  const second = await getChangesSince(first.nextCursor);
  assert.ok(
    second.bookings.length <= first.bookings.length,
    'the cursor advanced (a tail overlap, not a full re-send)',
  );
  // lag + generous slack: rows re-sent must all be inside the safety-lag window.
  const lagCutoff = new Date(Date.now() - (SYNC_PULL_SAFETY_LAG_MS + 30_000));
  for (const b of second.bookings as { updatedAt: string | Date }[]) {
    assert.ok(
      new Date(b.updatedAt) >= lagCutoff,
      'only tail rows inside the safety-lag window are re-sent, never old ones',
    );
  }
});

test('pullBookings upserts the bundle in topological order, idempotently (no dupes)', async () => {
  const before = await prisma.booking.count();
  const bundle = await getChangesSince(null);

  // Feed the SAME bundle back through the pull (single-DB round-trip): every row
  // upserts onto itself, exercising the real FK order without creating dupes.
  const r1 = await pullBookings({ fetchBundle: async () => bundle });
  assert.equal(r1.pulled.bookings, before);

  // Replaying the identical bundle is still a no-op on counts.
  await pullBookings({ fetchBundle: async () => bundle });
  const after = await prisma.booking.count();
  assert.equal(after, before, 'idempotent pull must not create duplicate bookings');

  // Cursor was advanced + persisted.
  const state = await prisma.syncState.findUnique({ where: { key: 'pull:bookings' } });
  assert.ok(state?.cursor, 'pull cursor is persisted');
});

test('getChangesSince carries BookingSlot capacity counters (mirrored read-only to local)', async () => {
  const bundle = await getChangesSince(null);
  assert.ok(Array.isArray(bundle.bookingSlots), 'the bundle carries a bookingSlots array');
});

test('pullBookings mirrors BookingSlot by the (serviceId,date) natural key, idempotently', async () => {
  const service = await prisma.service.findFirst({ select: { id: true } });
  if (!service) return; // no catalog seeded — nothing to assert
  // A far-future date so this never collides with a real slot for the service.
  const date = new Date('2099-01-01T00:00:00.000Z');
  await prisma.bookingSlot.deleteMany({ where: { serviceId: service.id, date } });

  // Online delivers `date` as an ISO string over JSON; the helper normalises it.
  const slot = {
    id: 'test-slot-2099-a',
    serviceId: service.id,
    date: date.toISOString(),
    reservedPeople: 7,
    reservedCars: 2,
    reservedHandicap: 1,
  };
  await pullBookings({
    fetchBundle: async () =>
      ({
        nextCursor: new Date().toISOString(),
        counts: {},
        users: [],
        bookingSlots: [slot],
      }) as never,
  });
  const applied = await prisma.bookingSlot.findUnique({
    where: { serviceId_date: { serviceId: service.id, date } },
  });
  assert.equal(applied?.reservedPeople, 7, 'the capacity counter is mirrored onto local');

  // Re-pull the SAME (serviceId,date) under a DIFFERENT id + counter: the natural-key
  // upsert must update the SAME row in place — never duplicate, never collide on the
  // by-id PK the way the generic upsertMany would.
  const slot2 = { ...slot, id: 'test-slot-2099-b', reservedPeople: 9 };
  await pullBookings({
    fetchBundle: async () =>
      ({
        nextCursor: new Date().toISOString(),
        counts: {},
        users: [],
        bookingSlots: [slot2],
      }) as never,
  });
  const rows = await prisma.bookingSlot.findMany({ where: { serviceId: service.id, date } });
  assert.equal(rows.length, 1, 'natural-key upsert never duplicates the (serviceId,date) slot');
  assert.equal(rows[0]?.reservedPeople, 9, 're-pull overwrites the counter in place');

  await prisma.bookingSlot.deleteMany({ where: { serviceId: service.id, date } });
});

test('the pull does NOT overwrite local-owned gate columns on Booking (field-scoped omit)', async (t) => {
  const fixture = await createSyncTestBooking('pull-local-fields');
  t.after(fixture.cleanup);
  const { booking } = fixture;
  const orig = booking.checkedInCount;

  // A bundle whose Booking row carries a DIFFERENT checkedInCount (as if online
  // sent stale/empty gate state). The pull must leave local's value intact.
  const divergent = { ...booking, checkedInCount: orig + 999 } as unknown as Record<
    string,
    unknown
  >;
  const bundle = {
    nextCursor: new Date().toISOString(),
    counts: {},
    users: [],
    customerProfiles: [],
    visitCodes: [],
    categoryTermsAcceptances: [],
    bookings: [divergent],
    bookingUnits: [],
    guestIdDocuments: [],
    invoices: [],
    invoiceLines: [],
    refundLines: [],
    payments: [],
    cancellationRequests: [],
    sanctions: [],
    reviews: [],
  };

  await pullBookings({ fetchBundle: async () => bundle as never });

  const after = await prisma.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: { checkedInCount: true },
  });
  assert.equal(after.checkedInCount, orig, 'local gate state survived the pull');
});

test('getChangesSince({includeSets:false}) omits the id-sets and slot mirror (sets cadence)', async () => {
  const bundle = await getChangesSince(null, { includeSets: false });
  assert.equal(bundle.catalogIds, undefined, 'no catalog id-sets on a sets-omitted pull');
  assert.equal(bundle.blockedIdentityIds, undefined, 'no blocklist id-set either');
  assert.equal(bundle.bookingSlots, undefined, 'no BookingSlot scan either');
  // The incremental sections are unaffected.
  assert.ok(Array.isArray(bundle.users));
});

test('a sets-omitted bundle never triggers the delete-mirror (catalog survives)', async (t) => {
  // A locally-present service that the bundle does NOT vouch for must survive a
  // pull whose bundle carries no id-sets at all (rollout skew / sets cadence).
  const template = await prisma.service.findFirst();
  if (!template) return; // no catalog seeded
  const { id: _id, slug: _slug, ...rest } = template as Record<string, unknown> & {
    id: string;
    slug: string;
  };
  const clone = await prisma.service.create({
    data: { ...rest, slug: `setsomit-${process.hrtime.bigint().toString()}` } as never,
  });
  t.after(async () => {
    await prisma.service.deleteMany({ where: { id: clone.id } });
  });

  await pullAll({
    fetchBundle: async () =>
      ({ nextCursor: new Date().toISOString(), counts: {}, users: [] }) as never,
  });
  const still = await prisma.service.findUnique({ where: { id: clone.id } });
  assert.ok(still, 'no id-sets → no delete-mirror → the local row survives');
});

test('delete-mirror: an unreferenced stale service is removed, a booked one is kept', async (t) => {
  const template = await prisma.service.findFirst();
  if (!template) return;
  const tag = process.hrtime.bigint().toString();
  const { id: _id, slug: _slug, ...rest } = template as Record<string, unknown> & {
    id: string;
    slug: string;
  };
  const orphan = await prisma.service.create({
    data: { ...rest, slug: `delmir-orphan-${tag}` } as never,
  });
  const booked = await prisma.service.create({
    data: { ...rest, slug: `delmir-booked-${tag}` } as never,
  });
  const userFixture = await createSyncTestUser('delmir');
  const booking = await prisma.booking.create({
    data: {
      reference: `TEST-delmir-${tag}`,
      userId: userFixture.user.id,
      serviceId: booked.id,
      bookingDate: new Date('2099-03-01T00:00:00.000Z'),
      people: 1,
      adults: 1,
      cars: 0,
      clientRequestId: `delmir-${tag}`,
    },
  });
  t.after(async () => {
    await prisma.booking.deleteMany({ where: { id: booking.id } });
    await prisma.service.deleteMany({ where: { id: { in: [orphan.id, booked.id] } } });
    await userFixture.cleanup();
  });

  // Authoritative id-sets = everything currently local EXCEPT the two test rows
  // (as if online never had them). All other tables vouch for their full sets.
  const [cats, svcs, prs, sps] = await Promise.all([
    prisma.category.findMany({ select: { id: true } }),
    prisma.service.findMany({ select: { id: true } }),
    prisma.priceRule.findMany({ select: { id: true } }),
    prisma.servicePlace.findMany({ select: { id: true } }),
  ]);
  const bundle = {
    nextCursor: new Date().toISOString(),
    counts: {},
    users: [],
    catalogIds: {
      category: cats.map((c) => c.id),
      service: svcs.map((s) => s.id).filter((id) => id !== orphan.id && id !== booked.id),
      priceRule: prs.map((r) => r.id),
      servicePlace: sps.map((s) => s.id),
    },
  };
  await pullAll({ fetchBundle: async () => bundle as never });

  assert.equal(
    await prisma.service.findUnique({ where: { id: orphan.id } }),
    null,
    'the unreferenced stale service is hard-mirrored away',
  );
  assert.ok(
    await prisma.service.findUnique({ where: { id: booked.id } }),
    'a service still referenced by a booking is kept (FK-safe pre-check)',
  );
});

test('pullAll applies a section larger than one chunk fully (chunked transactions)', async (t) => {
  const tag = process.hrtime.bigint().toString();
  const COUNT = 250; // > CHUNK (200) → two transaction slices
  const users = Array.from({ length: COUNT }, (_, i) => ({
    id: `chunk-${tag}-${i}`,
    email: `chunk-${tag}-${i}@example.test`,
    name: 'Chunk fixture',
  }));
  t.after(async () => {
    await prisma.user.deleteMany({ where: { id: { startsWith: `chunk-${tag}-` } } });
  });

  await pullAll({
    fetchBundle: async () =>
      ({ nextCursor: new Date().toISOString(), counts: {}, users }) as never,
  });
  const applied = await prisma.user.count({ where: { id: { startsWith: `chunk-${tag}-` } } });
  assert.equal(applied, COUNT, 'every chunk slice landed');
});

test('a failing LATE section leaves the cursor unmoved; earlier sections stay applied (idempotent re-pull)', async (t) => {
  const tag = process.hrtime.bigint().toString();
  const goodUser = { id: `poison-${tag}-u`, email: `poison-${tag}@example.test`, name: 'P' };
  t.after(async () => {
    await prisma.user.deleteMany({ where: { id: goodUser.id } });
  });
  const before = await prisma.syncState.findUnique({ where: { key: 'pull:bookings' } });

  const bundle = {
    nextCursor: new Date('2031-01-01T00:00:00.000Z').toISOString(), // must NOT be persisted
    counts: {},
    users: [goodUser],
    // cancellationRequests is the LAST section; an unknown column makes its
    // upsert throw on every attempt.
    cancellationRequests: [{ id: `poison-${tag}-cr`, definitelyNotAColumn: true }],
  };
  await assert.rejects(
    pullAll({ fetchBundle: async () => bundle as never }),
    'a poisoned section must reject the pull',
  );

  const after = await prisma.syncState.findUnique({ where: { key: 'pull:bookings' } });
  assert.equal(
    after?.cursor ?? null,
    before?.cursor ?? null,
    'the cursor only advances after EVERY section succeeded',
  );
  assert.ok(
    await prisma.user.findUnique({ where: { id: goodUser.id } }),
    'earlier sections stay applied — safe because the re-pull is idempotent',
  );
});

test('pull parks an incoming ACTIVE sanction while the local settlement push is queued', async (t) => {
  const userFixture = await createSyncTestUser('park-sanction');
  const sanction = await prisma.sanction.create({
    data: {
      userId: userFixture.user.id,
      amountCents: 700,
      reason: 'park test',
      createdById: userFixture.user.id,
      status: 'PAID',
      settledAt: new Date(),
    },
  });
  t.after(async () => {
    await prisma.syncQueue.deleteMany({ where: { entityType: 'Sanction', entityId: sanction.id } });
    await prisma.sanction.deleteMany({ where: { id: sanction.id } });
    await userFixture.cleanup();
  });
  // The settlement push is still in flight (pending on the outbox).
  await prisma.syncQueue.create({
    data: {
      entityType: 'Sanction',
      entityId: sanction.id,
      op: 'upsert',
      payload: { id: sanction.id },
      status: 'pending',
    },
  });

  // Online (staler) still shows the fine ACTIVE — e.g. a cursor-reset full pull.
  const staleActive = {
    id: sanction.id,
    userId: userFixture.user.id,
    amountCents: 700,
    reason: 'park test',
    createdById: userFixture.user.id,
    status: 'ACTIVE',
    settledAt: null,
  };
  const bundle = () =>
    ({ nextCursor: new Date().toISOString(), counts: {}, users: [], sanctions: [staleActive] }) as never;

  await pullAll({ fetchBundle: async () => bundle() });
  const parked = await prisma.sanction.findUniqueOrThrow({ where: { id: sanction.id } });
  assert.equal(parked.status, 'PAID', 'local settlement survives while its push is queued');

  // Once the push has left the queue (landed or dead), online is authoritative
  // again — a genuine admin reactivation must apply.
  await prisma.syncQueue.deleteMany({ where: { entityType: 'Sanction', entityId: sanction.id } });
  await pullAll({ fetchBundle: async () => bundle() });
  const reasserted = await prisma.sanction.findUniqueOrThrow({ where: { id: sanction.id } });
  assert.equal(reasserted.status, 'ACTIVE', 'no queued push → online copy applies');
});
