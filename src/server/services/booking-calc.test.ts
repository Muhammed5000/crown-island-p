/**
 * Unit tests for the booking calculation engine's pure helpers.
 *
 * No test runner is installed; this uses Node's built-in `node:test` (Node ≥20),
 * matching the convention in `src/server/audit/sanitize.test.ts`. Run with:
 *
 *   npx tsx --test src/server/services/booking-calc.test.ts
 *
 * Only the pure functions are covered here (behaviour selection, allocation,
 * per-day pricing, day counting). The async `calcBooking` orchestrator is
 * exercised end-to-end via the booking flow.
 *
 * The three service categories each own their own logic (see `behaviorFor`):
 *   • EVENT  — every guest billed individually (per-person + per-child).
 *   • CABANA — ticket of 4 adults + 2 children; extras open more tickets.
 *   • DAY_USE (beach) — one umbrella covers 4 people (children count per the
 *     `childrenCountAsPersons` admin setting); overflow opens more umbrellas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateUnits,
  beachTicketCapacity,
  cabanaTicketCapacity,
  behaviorFor,
  exceedsChildrenCap,
  exceedsPeopleCap,
  maxExtraPersonsFor,
  priceUnitDay,
  dayCount,
  type ServiceRules,
} from './booking-calc-core';

// ── Fixtures: one service per category, prices in piastres (EGP × 100). ──

/**
 * BEACH: one umbrella (ticket) covers 4 ADULTS at 320_000. Children never use
 * umbrella space — adults alone drive the umbrella count.
 */
const beach: ServiceRules = {
  kind: 'DAY_USE',
  basePriceCents: 320_000,
  extraPersonPriceCents: 0,
  includedPersonsPerUnit: 4,
  maxPersonsPerUnit: null,
  allowExtraPeople: false,
  extraPersonMode: 'NEW_UNIT',
  maxExtraPersonsPerUnit: null,
  allowChildren: true,
  maxChildAge: 8,
  freeChildrenPerUnit: 0,
  maxChildrenPerBooking: null,
  extraChildPriceCents: 0,
  childrenCountAsPersons: true,
  allowMultiDay: false,
  maxBookingDays: null,
  placeAssignmentRequired: false,
  maxPeoplePerBooking: 8,
  maxCarsPerBooking: 2,
};

/** CABANA: one ticket holds 4 adults + 2 children; extras open more tickets. */
const cabana: ServiceRules = {
  kind: 'CABANA',
  basePriceCents: 250_000,
  extraPersonPriceCents: 0,
  includedPersonsPerUnit: 4,
  maxPersonsPerUnit: 4,
  allowExtraPeople: false,
  extraPersonMode: 'NEW_UNIT',
  maxExtraPersonsPerUnit: null,
  allowChildren: true,
  maxChildAge: 8,
  freeChildrenPerUnit: 2,
  maxChildrenPerBooking: null,
  extraChildPriceCents: 0,
  childrenCountAsPersons: false,
  allowMultiDay: true,
  maxBookingDays: 7,
  placeAssignmentRequired: true,
  maxPeoplePerBooking: 16,
  maxCarsPerBooking: 4,
};

/** EVENT: 300 EGP per adult, 150 EGP per child, billed individually. */
const event: ServiceRules = {
  kind: 'EVENT',
  basePriceCents: 30_000,
  extraPersonPriceCents: 0,
  includedPersonsPerUnit: 1,
  maxPersonsPerUnit: null,
  allowExtraPeople: false,
  extraPersonMode: 'NEW_UNIT',
  maxExtraPersonsPerUnit: null,
  allowChildren: true,
  maxChildAge: 8,
  freeChildrenPerUnit: 0,
  maxChildrenPerBooking: null,
  extraChildPriceCents: 15_000,
  childrenCountAsPersons: false,
  allowMultiDay: false,
  maxBookingDays: null,
  placeAssignmentRequired: false,
  maxPeoplePerBooking: 50,
  maxCarsPerBooking: 20,
};

// ── behaviorFor: kind drives the regime ──────────────────────────────────────

test('behaviorFor maps each kind to its own regime', () => {
  assert.equal(behaviorFor('EVENT'), 'EVENT_PER_PERSON');
  assert.equal(behaviorFor('CABANA'), 'CABANA_TICKET');
  assert.equal(behaviorFor('DAY_USE'), 'BEACH_TICKET');
  assert.equal(behaviorFor('OTHER'), 'LEGACY');
});

// ── EVENT: per-person ────────────────────────────────────────────────────────

test('allocateUnits EVENT: every head is carried individually, no extras', () => {
  const a = allocateUnits(event, 10, 2);
  assert.deepEqual(a, {
    unitsPerDay: 1,
    includedPersons: 10,
    extraPersons: 0,
    includedChildren: 2,
    extraChildren: 0,
  });
});

test('priceUnitDay EVENT: adults × base + children × child price + cars', () => {
  const date = new Date(Date.UTC(2026, 5, 10)); // Wednesday
  const rules = [{ kind: 'PER_CAR', amountCents: 15_000, startDate: null, endDate: null, weekdayMask: null }] as const;
  const alloc = allocateUnits(event, 10, 2);
  const lines = priceUnitDay(event, [...rules], date, alloc, 3);

  const perPerson = lines.find((l) => l.kind === 'PER_PERSON')!;
  assert.equal(perPerson.labelKey, 'services.perPerson');
  assert.equal(perPerson.quantity, 10);
  assert.equal(perPerson.totalCents, 300_000);

  const child = lines.find((l) => l.kind === 'EXTRA_CHILD')!;
  assert.equal(child.labelKey, 'services.perChild');
  assert.equal(child.quantity, 2);
  assert.equal(child.totalCents, 30_000);

  const cars = lines.find((l) => l.kind === 'PER_CAR')!;
  assert.equal(cars.totalCents, 45_000);

  // EVENT never emits a BASE/ticket line.
  assert.equal(lines.find((l) => l.kind === 'BASE'), undefined);
  const total = lines.reduce((s, l) => s + l.totalCents, 0);
  assert.equal(total, 300_000 + 30_000 + 45_000);
});

// ── CABANA: ticket of 4 adults + 2 children, extras open new tickets ─────────

test('allocateUnits CABANA: 4 adults + 2 children fit one ticket', () => {
  const a = allocateUnits(cabana, 4, 2);
  assert.equal(a.unitsPerDay, 1);
  assert.equal(a.includedPersons, 4);
  assert.equal(a.includedChildren, 2);
  assert.equal(a.extraPersons, 0);
  assert.equal(a.extraChildren, 0);
});

test('allocateUnits CABANA: a 5th adult opens a 2nd ticket', () => {
  const a = allocateUnits(cabana, 5, 0);
  assert.equal(a.unitsPerDay, 2);
});

test('allocateUnits CABANA: a 3rd child opens a 2nd ticket', () => {
  // 4 adults + 3 children ⇒ max(ceil(4/4), ceil(3/2)) = max(1, 2) = 2 tickets.
  const a = allocateUnits(cabana, 4, 3);
  assert.equal(a.unitsPerDay, 2);
  assert.equal(a.extraChildren, 0); // children are carried by tickets, not surcharged
});

test('allocateUnits CABANA: children capacity rides on ticket count', () => {
  // 8 adults ⇒ 2 tickets ⇒ 4 child slots; 4 children all fit, still 2 tickets.
  const a = allocateUnits(cabana, 8, 4);
  assert.equal(a.unitsPerDay, 2);
});

test('priceUnitDay CABANA: base price per ticket, no per-head charges', () => {
  const date = new Date(Date.UTC(2026, 5, 10)); // Wednesday
  const alloc = allocateUnits(cabana, 4, 3); // 2 tickets
  const lines = priceUnitDay(cabana, [], date, alloc, 0);

  const base = lines.find((l) => l.kind === 'BASE')!;
  assert.equal(base.quantity, 2);
  assert.equal(base.totalCents, 500_000);
  assert.equal(lines.find((l) => l.kind === 'PER_PERSON'), undefined);
  assert.equal(lines.find((l) => l.kind === 'EXTRA_CHILD'), undefined);
});

// ── BEACH: one umbrella covers N ADULTS; children never use umbrella space ────

test('allocateUnits BEACH: capacity adults fit one umbrella; children do not count', () => {
  const a = allocateUnits(beach, 4, 6); // 4 adults = 1 umbrella; 6 children add nothing
  assert.equal(a.unitsPerDay, 1);
  assert.equal(a.includedPersons, 4);
  assert.equal(a.includedChildren, 6); // recorded, but never drive umbrellas
  assert.equal(a.extraPersons, 0);
  assert.equal(a.extraChildren, 0);
});

test('allocateUnits BEACH: a 5th ADULT opens a 2nd umbrella', () => {
  const a = allocateUnits(beach, 5, 0); // ceil(5/4) = 2 umbrellas
  assert.equal(a.unitsPerDay, 2);
  assert.equal(a.extraPersons, 0); // overflow is a NEW umbrella, never a surcharge
});

test('allocateUnits BEACH: children NEVER change the umbrella count', () => {
  assert.equal(allocateUnits(beach, 4, 0).unitsPerDay, 1);
  assert.equal(allocateUnits(beach, 4, 12).unitsPerDay, 1); // 12 children, still 1 umbrella
  assert.equal(allocateUnits(beach, 8, 0).unitsPerDay, 2); // 8 adults ⇒ 2 umbrellas
  assert.equal(allocateUnits(beach, 9, 99).unitsPerDay, 3); // 9 adults ⇒ 3, children irrelevant
});

test('priceUnitDay BEACH: price = umbrellas × base ticket, no surcharge lines', () => {
  const date = new Date(Date.UTC(2026, 5, 10)); // Wednesday
  const alloc = allocateUnits(beach, 5, 3); // 5 adults ⇒ 2 umbrellas; children don't add
  const lines = priceUnitDay(beach, [], date, alloc, 0);

  const base = lines.find((l) => l.kind === 'BASE')!;
  assert.equal(base.quantity, 2);
  assert.equal(base.unitCents, 320_000);
  assert.equal(base.totalCents, 640_000);
  assert.equal(lines.find((l) => l.kind === 'PER_PERSON'), undefined);
  assert.equal(lines.find((l) => l.kind === 'EXTRA_CHILD'), undefined);
  assert.equal(lines.reduce((s, l) => s + l.totalCents, 0), 640_000);
});

test('priceUnitDay BEACH: weekend lifts each umbrella; per-car added once', () => {
  const friday = new Date(Date.UTC(2026, 5, 12)); // Friday (getUTCDay() === 5)
  const rules = [
    { kind: 'WEEKEND_SURCHARGE', amountCents: 20_000, startDate: null, endDate: null, weekdayMask: (1 << 5) | (1 << 6) },
    { kind: 'PER_CAR', amountCents: 15_000, startDate: null, endDate: null, weekdayMask: null },
  ] as const;
  const alloc = allocateUnits(beach, 5, 0); // 2 umbrellas
  const lines = priceUnitDay(beach, [...rules], friday, alloc, 1);

  const base = lines.find((l) => l.kind === 'BASE')!;
  assert.equal(base.quantity, 2);
  assert.equal(base.unitCents, 340_000); // 320k + 20k weekend, per umbrella
  assert.equal(base.totalCents, 680_000);
  assert.equal(lines.find((l) => l.kind === 'PER_PERSON'), undefined); // overflow ⇒ umbrella

  const cars = lines.find((l) => l.kind === 'PER_CAR')!;
  assert.equal(cars.totalCents, 15_000);
  assert.equal(lines.reduce((s, l) => s + l.totalCents, 0), 680_000 + 15_000);
});

// ── basePriceCents is the single source of truth ─────────────────────────────

test('priceUnitDay BEACH: a stale FLAT rule is IGNORED — basePriceCents wins (regression)', () => {
  // Regression for the Freska Beach "Beach Entrance" bug: a leftover FLAT rule
  // used to silently override the admin-set base price ("I put one price, the
  // system gives another"). The base MUST come from basePriceCents (320_000),
  // never the FLAT amount (999_999).
  const date = new Date(Date.UTC(2026, 5, 10)); // Wednesday
  const rules = [
    { kind: 'FLAT', amountCents: 999_999, startDate: null, endDate: null, weekdayMask: null },
  ] as const;
  const alloc = allocateUnits(beach, 1, 0);
  const lines = priceUnitDay(beach, [...rules], date, alloc, 0);

  const base = lines.find((l) => l.kind === 'BASE')!;
  assert.equal(base.unitCents, 320_000); // basePriceCents — NOT the FLAT 999_999
  assert.equal(base.totalCents, 320_000);
  assert.equal(lines.reduce((s, l) => s + l.totalCents, 0), 320_000);
});

test('priceUnitDay BEACH: DATE_OVERRIDE still replaces the base on its date', () => {
  // The one deliberate, dated exception that MAY override basePriceCents.
  const date = new Date(Date.UTC(2026, 5, 10));
  const rules = [
    { kind: 'DATE_OVERRIDE', amountCents: 500_000, startDate: null, endDate: null, weekdayMask: null },
  ] as const;
  const alloc = allocateUnits(beach, 1, 0);
  const lines = priceUnitDay(beach, [...rules], date, alloc, 0);

  const base = lines.find((l) => l.kind === 'BASE')!;
  assert.equal(base.unitCents, 500_000); // DATE_OVERRIDE replaces basePriceCents
});

// ── exceedsChildrenCap: the flat per-booking children cap ────────────────────

test('exceedsChildrenCap: null cap (default / legacy rows) never limits children', () => {
  // Backward-compat guard: existing services have maxChildrenPerBooking = null.
  assert.equal(exceedsChildrenCap(cabana, 100), false);
  assert.equal(exceedsChildrenCap(event, 100), false);
  assert.equal(exceedsChildrenCap(beach, 100), false);
});

test('exceedsChildrenCap CABANA: exempt (cabana uses the per-cabana cap, not this)', () => {
  // Cabana now scales its "maximum children" by the ADULT-driven cabana count
  // (see cabanaTicketCapacity), enforced in calcBooking — so the flat helper is
  // a no-op for cabana, exactly like beach.
  const capped: ServiceRules = { ...cabana, maxChildrenPerBooking: 8 };
  assert.equal(exceedsChildrenCap(capped, 40), false); // cabana is handled in calcBooking
});

test('exceedsChildrenCap EVENT: flat per-booking cap', () => {
  const capped: ServiceRules = { ...event, maxChildrenPerBooking: 5 };
  assert.equal(exceedsChildrenCap(capped, 5), false);
  assert.equal(exceedsChildrenCap(capped, 6), true);
});

test('exceedsChildrenCap BEACH: exempt (beach uses the per-umbrella cap, not this)', () => {
  const capped: ServiceRules = { ...beach, maxChildrenPerBooking: 5 };
  assert.equal(exceedsChildrenCap(capped, 50), false); // beach is handled in calcBooking
});

// ── beachTicketCapacity: adults drive umbrellas; children cap is per-umbrella ──

test('beachTicketCapacity: ADULTS drive umbrellas — 1–4 ⇒ 1, 5–8 ⇒ 2, 9 ⇒ 3', () => {
  const cap = (adults: number) =>
    beachTicketCapacity({ adults, ticketCapacity: 4, maxChildrenPerUmbrella: null });

  assert.equal(cap(1).requiredUmbrellas, 1);
  assert.equal(cap(4).requiredUmbrellas, 1);
  assert.equal(cap(4).extraTicketRequired, false);
  assert.equal(cap(5).requiredUmbrellas, 2); // 5 adults ⇒ 2 umbrellas (user's example)
  assert.equal(cap(5).extraTicketRequired, true);
  assert.equal(cap(8).requiredUmbrellas, 2);
  assert.equal(cap(9).requiredUmbrellas, 3);
  assert.equal(cap(17).requiredUmbrellas, 5);
});

test('beachTicketCapacity: maxChildren is PER UMBRELLA (× umbrellas)', () => {
  // 5 adults ⇒ 2 umbrellas; 3 children/umbrella ⇒ 6 children allowed (user's example).
  const r = beachTicketCapacity({ adults: 5, ticketCapacity: 4, maxChildrenPerUmbrella: 3 });
  assert.equal(r.requiredUmbrellas, 2);
  assert.equal(r.maxChildren, 6);
  // 4 adults ⇒ 1 umbrella ⇒ 3 children allowed.
  assert.equal(beachTicketCapacity({ adults: 4, ticketCapacity: 4, maxChildrenPerUmbrella: 3 }).maxChildren, 3);
  // No per-umbrella cap ⇒ no children limit.
  assert.equal(beachTicketCapacity({ adults: 4, ticketCapacity: 4, maxChildrenPerUmbrella: null }).maxChildren, null);
});

test('beachTicketCapacity: capacity is configurable and reported back', () => {
  const r = beachTicketCapacity({ adults: 7, ticketCapacity: 6, maxChildrenPerUmbrella: null });
  assert.equal(r.includedCapacityPerTicket, 6);
  assert.equal(r.requiredUmbrellas, 2); // ceil(7/6)
});

test('beachTicketCapacity: invalid inputs are clamped, never crash', () => {
  assert.equal(beachTicketCapacity({ adults: -5, ticketCapacity: 4, maxChildrenPerUmbrella: 3 }).requiredUmbrellas, 1);
  assert.equal(beachTicketCapacity({ adults: NaN, ticketCapacity: 4, maxChildrenPerUmbrella: null }).requiredUmbrellas, 1);
  assert.equal(beachTicketCapacity({ adults: 5, ticketCapacity: 0, maxChildrenPerUmbrella: null }).requiredUmbrellas, 5); // cap ⇒ 1
  assert.equal(beachTicketCapacity({ adults: 1000, ticketCapacity: 4, maxChildrenPerUmbrella: null }).requiredUmbrellas, 250);
});

test('exceedsChildrenCap LEGACY (OTHER): flat cap applies', () => {
  const other: ServiceRules = { ...event, kind: 'OTHER', maxChildrenPerBooking: 3 };
  assert.equal(exceedsChildrenCap(other, 3), false);
  assert.equal(exceedsChildrenCap(other, 4), true);
});

// ── exceedsPeopleCap: the per-booking party cap counts ADULTS only ───────────

test('exceedsPeopleCap: adults AT the cap are allowed; only OVER the cap is rejected', () => {
  assert.equal(exceedsPeopleCap(event, 50), false); // event cap = 50 (inclusive)
  assert.equal(exceedsPeopleCap(event, 51), true);
  assert.equal(exceedsPeopleCap(beach, 8), false); // beach cap = 8
  assert.equal(exceedsPeopleCap(beach, 9), true);
});

test('exceedsPeopleCap: children NEVER count — only the adult head is bounded (regression)', () => {
  // The reported bug: a "12 people" service rejected the booking the instant a
  // child was added, because the cap counted total heads (adults + children).
  // The cap takes ONLY adults — so 12 adults is fine for a 12-cap service no
  // matter how many children ride along (children are capped separately).
  const cap12: ServiceRules = { ...event, maxPeoplePerBooking: 12 };
  assert.equal(exceedsPeopleCap(cap12, 12), false); // 12 adults + any children ⇒ OK
  assert.equal(exceedsPeopleCap(cap12, 13), true); // a 13th ADULT ⇒ rejected
});

test('exceedsPeopleCap: uniform across kinds (beach already worked this way)', () => {
  // Beach and the per-person/legacy kinds now share one adults-only rule.
  for (const rules of [beach, cabana, event]) {
    const capped: ServiceRules = { ...rules, maxPeoplePerBooking: 4 };
    assert.equal(exceedsPeopleCap(capped, 4), false);
    assert.equal(exceedsPeopleCap(capped, 5), true);
  }
});

test('exceedsPeopleCap: null cap ⇒ no limit', () => {
  const uncapped: ServiceRules = { ...event, maxPeoplePerBooking: null };
  assert.equal(exceedsPeopleCap(uncapped, 999), false);
});

// ── cabanaTicketCapacity: adults drive cabanas; child cap is per-cabana ───────

test('cabanaTicketCapacity: ADULTS drive cabanas — 1–4 ⇒ 1, 5–8 ⇒ 2, 9 ⇒ 3', () => {
  const cap = (adults: number) =>
    cabanaTicketCapacity({ adults, ticketCapacity: 4, maxChildrenPerCabana: 2 });

  assert.equal(cap(1).requiredCabanas, 1);
  assert.equal(cap(4).requiredCabanas, 1);
  assert.equal(cap(5).requiredCabanas, 2); // a 5th adult opens a 2nd cabana
  assert.equal(cap(6).requiredCabanas, 2);
  assert.equal(cap(8).requiredCabanas, 2);
  assert.equal(cap(9).requiredCabanas, 3);
});

test('cabanaTicketCapacity: maxChildren is PER CABANA (× cabanas), driven by adults', () => {
  // The acceptance matrix: 1 cabana ⇒ 2 children, 2 cabanas ⇒ 4, 3 cabanas ⇒ 6.
  const cap = (adults: number) =>
    cabanaTicketCapacity({ adults, ticketCapacity: 4, maxChildrenPerCabana: 2 }).maxChildren;

  assert.equal(cap(1), 2); // Case 1
  assert.equal(cap(4), 2); // Case 2 — still 1 cabana, max 2
  assert.equal(cap(5), 4); // Case 3 — 2 cabanas, max 4
  assert.equal(cap(6), 4); // Case 4
  assert.equal(cap(8), 4); // Case 5
  assert.equal(cap(9), 6); // Case 6 — 3 cabanas, max 6
});

test('cabanaTicketCapacity: children never enlarge their own ceiling (no-op guard)', () => {
  // The cap depends ONLY on adults — passing more children cannot change it, so a
  // party can never split into extra cabanas to slip past the cap.
  assert.equal(cabanaTicketCapacity({ adults: 4, ticketCapacity: 4, maxChildrenPerCabana: 2 }).maxChildren, 2);
  // 4 adults ⇒ 1 cabana ⇒ ceiling 2: so 3, 4 children must be rejected by callers.
  assert.equal(cabanaTicketCapacity({ adults: 5, ticketCapacity: 4, maxChildrenPerCabana: 2 }).maxChildren, 4);
});

test('cabanaTicketCapacity: null per-cabana cap ⇒ no children limit', () => {
  assert.equal(
    cabanaTicketCapacity({ adults: 9, ticketCapacity: 4, maxChildrenPerCabana: null }).maxChildren,
    null,
  );
});

// ── Extra Person add-on: a standalone paid counter that NEVER opens a unit ────

/** Beach with the paid Extra Person add-on enabled at 50 EGP each. */
const beachExtra: ServiceRules = {
  ...beach,
  allowExtraPeople: true,
  extraPersonPriceCents: 5_000,
};

/** Cabana with the paid Extra Person add-on enabled at 40 EGP each. */
const cabanaExtra: ServiceRules = {
  ...cabana,
  allowExtraPeople: true,
  extraPersonPriceCents: 4_000,
};

test('allocateUnits BEACH add-on: extra persons never change the umbrella count', () => {
  // The user's acceptance matrix — adults alone drive umbrellas; the add-on rides alongside.
  assert.equal(allocateUnits(beachExtra, 4, 0, 0).unitsPerDay, 1); // Ex.1: 4 adults, 0 extra ⇒ 1
  assert.equal(allocateUnits(beachExtra, 5, 0, 0).unitsPerDay, 2); // Ex.2: 5 adults, 0 extra ⇒ 2
  assert.equal(allocateUnits(beachExtra, 4, 0, 1).unitsPerDay, 1); // Ex.3: 4 adults, 1 extra ⇒ 1
  assert.equal(allocateUnits(beachExtra, 4, 0, 2).unitsPerDay, 1); // Ex.4: 4 adults, 2 extra ⇒ 1
  assert.equal(allocateUnits(beachExtra, 5, 0, 1).unitsPerDay, 2); // Ex.5: 5 adults, 1 extra ⇒ 2
});

test('allocateUnits BEACH add-on: extra persons are carried in `extraPersons`, not units', () => {
  const a = allocateUnits(beachExtra, 4, 0, 2);
  assert.equal(a.unitsPerDay, 1);
  assert.equal(a.includedPersons, 4); // adults unchanged
  assert.equal(a.extraPersons, 2); // the two add-on people
});

test('allocateUnits CABANA add-on: extra persons never change the cabana count', () => {
  assert.equal(allocateUnits(cabanaExtra, 4, 0, 0).unitsPerDay, 1);
  assert.equal(allocateUnits(cabanaExtra, 5, 0, 0).unitsPerDay, 2);
  assert.equal(allocateUnits(cabanaExtra, 4, 0, 1).unitsPerDay, 1);
  assert.equal(allocateUnits(cabanaExtra, 4, 0, 2).unitsPerDay, 1);
  assert.equal(allocateUnits(cabanaExtra, 5, 0, 1).unitsPerDay, 2);
  assert.equal(allocateUnits(cabanaExtra, 4, 0, 3).extraPersons, 3);
});

test('allocateUnits add-on: disabled service IGNORES extra persons (gated by allowExtraPeople)', () => {
  // `beach` / `cabana` fixtures have allowExtraPeople:false → the count is dropped.
  assert.equal(allocateUnits(beach, 4, 0, 3).extraPersons, 0);
  assert.equal(allocateUnits(cabana, 4, 0, 3).extraPersons, 0);
});

test('priceUnitDay BEACH add-on: extra persons add their own line, base untouched', () => {
  const date = new Date(Date.UTC(2026, 5, 10)); // Wednesday
  const alloc = allocateUnits(beachExtra, 4, 0, 2); // 1 umbrella + 2 add-on people
  const lines = priceUnitDay(beachExtra, [], date, alloc, 0);

  const base = lines.find((l) => l.kind === 'BASE')!;
  assert.equal(base.quantity, 1); // still one umbrella
  assert.equal(base.totalCents, 320_000);

  const extra = lines.find((l) => l.kind === 'PER_PERSON')!;
  assert.equal(extra.labelKey, 'services.extraPerson');
  assert.equal(extra.quantity, 2);
  assert.equal(extra.unitCents, 5_000);
  assert.equal(extra.totalCents, 10_000);

  // Total = 1 umbrella + 2 extra people, nothing more.
  assert.equal(lines.reduce((s, l) => s + l.totalCents, 0), 320_000 + 10_000);
});

test('priceUnitDay CABANA add-on: 4 adults + 1 extra ⇒ 1 cabana + 1 extra-person line', () => {
  const date = new Date(Date.UTC(2026, 5, 10));
  const alloc = allocateUnits(cabanaExtra, 4, 0, 1);
  const lines = priceUnitDay(cabanaExtra, [], date, alloc, 0);

  assert.equal(lines.find((l) => l.kind === 'BASE')!.quantity, 1); // one cabana
  const extra = lines.find((l) => l.kind === 'PER_PERSON')!;
  assert.equal(extra.quantity, 1);
  assert.equal(extra.totalCents, 4_000);
});

// ── maxExtraPersonsFor: per-unit cap scales with the adults-driven unit count ──

test('maxExtraPersonsFor: null cap ⇒ no limit', () => {
  assert.equal(
    maxExtraPersonsFor({ adults: 5, ticketCapacity: 4, maxExtraPersonsPerUnit: null }),
    null,
  );
});

test('maxExtraPersonsFor: cap × adults-driven units (umbrellas/cabanas)', () => {
  const cap = (adults: number) =>
    maxExtraPersonsFor({ adults, ticketCapacity: 4, maxExtraPersonsPerUnit: 2 });
  assert.equal(cap(1), 2); // 1 unit  ⇒ 2
  assert.equal(cap(4), 2); // 1 unit  ⇒ 2
  assert.equal(cap(5), 4); // 2 units ⇒ 4 (a 5th adult opens a 2nd unit)
  assert.equal(cap(8), 4); // 2 units ⇒ 4
  assert.equal(cap(9), 6); // 3 units ⇒ 6
});

test('maxExtraPersonsFor: extra persons cannot enlarge their own ceiling (adults-only)', () => {
  // Driven purely by adults + capacity — independent of children / extra count.
  assert.equal(maxExtraPersonsFor({ adults: 4, ticketCapacity: 4, maxExtraPersonsPerUnit: 3 }), 3);
});

// ── dayCount ─────────────────────────────────────────────────────────────────

test('dayCount: inclusive range', () => {
  const a = new Date(Date.UTC(2026, 5, 10));
  const b = new Date(Date.UTC(2026, 5, 12));
  assert.equal(dayCount(a, a), 1);
  assert.equal(dayCount(a, b), 3);
});
