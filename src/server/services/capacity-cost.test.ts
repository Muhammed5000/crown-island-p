/**
 * Unit tests for the capacity bookkeeping helpers (capacity-cost.ts).
 *
 * These drive overbooking prevention: a wrong cost or a missed day lets a slot
 * be over-reserved (or leaks capacity on release). Pure logic, no real DB —
 * `clampSlotCapacity` is exercised against a recording fake transaction.
 *
 * Run: npx tsx --test src/server/services/capacity-cost.test.ts
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Prisma, ServiceKind } from '@prisma/client';
import {
  capacityCostFor,
  unitCapacityCost,
  eachDay,
  clampSlotCapacity,
  capacityExceeded,
  releaseBookingSlotCapacity,
} from './capacity-cost';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('capacityCostFor', () => {
  it('EVENT bills per person; everything else bills 1 booking', () => {
    assert.equal(capacityCostFor('EVENT' as ServiceKind, 3), 3);
    assert.equal(capacityCostFor('EVENT' as ServiceKind, 1), 1);
    for (const k of ['DAY_USE', 'CABANA', 'OTHER'] as ServiceKind[]) {
      assert.equal(capacityCostFor(k, 5), 1, k);
      assert.equal(capacityCostFor(k, 1), 1, k);
    }
  });
});

describe('unitCapacityCost', () => {
  it('EVENT still bills people; other kinds bill units (min 1)', () => {
    assert.equal(unitCapacityCost('EVENT' as ServiceKind, 2, 6), 6); // people, units ignored
    assert.equal(unitCapacityCost('CABANA' as ServiceKind, 2, 6), 2); // units
    assert.equal(unitCapacityCost('DAY_USE' as ServiceKind, 1, 6), 1); // legacy single-unit
    assert.equal(unitCapacityCost('CABANA' as ServiceKind, 0, 6), 1); // floor at 1
    assert.equal(unitCapacityCost('OTHER' as ServiceKind, 3, 1), 3);
  });
});

describe('eachDay', () => {
  it('single day when end is null or not after start', () => {
    const s = day('2026-06-10');
    assert.deepEqual(eachDay(s, null), [s]);
    assert.deepEqual(eachDay(s, s), [s]);
    assert.deepEqual(eachDay(s, day('2026-06-09')), [s]); // end before start
  });

  it('inclusive range, one BookingSlot per day', () => {
    const got = eachDay(day('2026-06-10'), day('2026-06-12'));
    assert.deepEqual(
      got.map((d) => d.toISOString().slice(0, 10)),
      ['2026-06-10', '2026-06-11', '2026-06-12'],
    );
  });

  it('safety-caps a runaway range at 61 days', () => {
    const got = eachDay(day('2026-01-01'), day('2027-01-01'));
    assert.ok(got.length <= 61, `expected <= 61, got ${got.length}`);
  });
});

describe('capacityExceeded', () => {
  it('null cap means unlimited — never exceeds', () => {
    assert.equal(capacityExceeded(1_000_000, 1_000_000, null), false);
    assert.equal(capacityExceeded(-5, 3, null), false);
  });

  it('exact fit is allowed; one over is exceeded', () => {
    assert.equal(capacityExceeded(8, 2, 10), false); // used + add === cap
    assert.equal(capacityExceeded(8, 3, 10), true);
    assert.equal(capacityExceeded(0, 10, 10), false);
    assert.equal(capacityExceeded(0, 11, 10), true);
  });

  it('clamps a NEGATIVE stored counter to 0 (corruption must not widen the check)', () => {
    // Raw math: -5 + 3 = -2 <= 3 → would pass. Clamped: 0 + 3 = 3 <= 3 → passes
    // legitimately. But adding more than the cap must fail even when the stored
    // counter is negative:
    assert.equal(capacityExceeded(-5, 3, 3), false);
    assert.equal(capacityExceeded(-5, 4, 3), true); // raw math would have said false
    assert.equal(capacityExceeded(-100, 11, 10), true);
  });

  it('positive overflow still detected', () => {
    assert.equal(capacityExceeded(10, 1, 10), true);
    assert.equal(capacityExceeded(3, 0, 3), false); // adding nothing never tips it
  });
});

describe('clampSlotCapacity', () => {
  function recorder() {
    const calls: Array<{ where: unknown; data: unknown }> = [];
    const tx = {
      bookingSlot: {
        updateMany: async (args: { where: unknown; data: unknown }) => {
          calls.push(args);
          return { count: 0 };
        },
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, calls };
  }

  it('no-ops on empty days', async () => {
    const { tx, calls } = recorder();
    await clampSlotCapacity(tx, 'svc-1', []);
    assert.equal(calls.length, 0);
  });

  it('issues exactly three floor-at-zero clamps scoped to the service + days', async () => {
    const { tx, calls } = recorder();
    const days = [day('2026-06-10'), day('2026-06-11')];
    await clampSlotCapacity(tx, 'svc-1', days);
    assert.equal(calls.length, 3);

    const fields = calls.map((c) => {
      const where = c.where as Record<string, unknown>;
      assert.equal(where.serviceId, 'svc-1');
      assert.deepEqual(where.date, { in: days });
      const field = Object.keys(where).find((k) => k.startsWith('reserved'))!;
      // Only rows that already went negative are touched, and they're set to 0.
      assert.deepEqual(where[field], { lt: 0 });
      assert.deepEqual(c.data, { [field]: 0 });
      return field;
    });
    assert.deepEqual(fields.sort(), ['reservedCars', 'reservedHandicap', 'reservedPeople']);
  });
});

describe('releaseBookingSlotCapacity', () => {
  function recorder() {
    const calls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
    const tx = {
      bookingSlot: {
        updateMany: async (args: { where: unknown; data: unknown }) => {
          calls.push(args as { where: Record<string, unknown>; data: Record<string, unknown> });
          return { count: 1 };
        },
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, calls };
  }

  // A per-day decrement call targets ONE Date; the clampSlotCapacity calls target
  // `{ date: { in: [...] } }`. Split them so we can assert the decrements alone.
  const isDecrement = (c: { where: Record<string, unknown> }) => c.where.date instanceof Date;

  it('decrements cars AND handicap on EVERY day of a multi-day booking (not just day 0)', async () => {
    const { tx, calls } = recorder();
    await releaseBookingSlotCapacity(tx, {
      serviceId: 'svc-1',
      bookingDate: day('2026-06-10'),
      endDate: day('2026-06-12'), // 3 inclusive days
      people: 4,
      cars: 2,
      handicapPeople: 1,
      unitsPerDay: 1,
      service: { kind: 'CABANA' as ServiceKind },
    });

    const decrements = calls.filter(isDecrement);
    assert.equal(decrements.length, 3, 'one decrement per inclusive day');

    // perDayCost for a 1-unit CABANA = 1. Cars/handicap must decrement on ALL days.
    for (const d of decrements) {
      assert.deepEqual(d.data, {
        reservedPeople: { decrement: 1 },
        reservedCars: { decrement: 2 },
        reservedHandicap: { decrement: 1 },
      });
    }

    // Regression guard: the old model released cars/handicap on day 0 only, which
    // left days 2..N over-reserved. Total released must be cars×days, not cars×1.
    const totalCars = decrements.reduce(
      (s, d) => s + (d.data.reservedCars as { decrement: number }).decrement,
      0,
    );
    assert.equal(totalCars, 6, '2 cars × 3 days');
  });

  it('single-day booking releases cars/handicap once', async () => {
    const { tx, calls } = recorder();
    await releaseBookingSlotCapacity(tx, {
      serviceId: 'svc-1',
      bookingDate: day('2026-06-10'),
      endDate: null,
      people: 2,
      cars: 1,
      handicapPeople: 0,
      unitsPerDay: 1,
      service: { kind: 'DAY_USE' as ServiceKind },
    });
    const decrements = calls.filter(isDecrement);
    assert.equal(decrements.length, 1);
    assert.deepEqual(decrements[0]!.data, {
      reservedPeople: { decrement: 1 },
      reservedCars: { decrement: 1 },
      reservedHandicap: { decrement: 0 },
    });
  });
});
