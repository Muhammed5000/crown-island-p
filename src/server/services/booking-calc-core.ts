import type { PriceRule, ServiceKind, ExtraPersonMode } from '@prisma/client';
import type { PriceLine } from './pricing';

/**
 * Pure (dependency-free) core of the booking calculation engine.
 *
 * This module deliberately imports only *types* (erased at build time) so it can
 * be unit-tested with plain `node:test` / `tsx` without pulling in `server-only`
 * or the Prisma client. The async orchestrator that needs the database lives in
 * `booking-calc.ts`, which re-exports everything here.
 *
 * See `booking-calc.ts` for the regime overview (legacy head-count vs per-unit).
 */

// ── Service rule subset the engine needs ───────────────────────────────────────
export interface ServiceRules {
  kind: ServiceKind;
  basePriceCents: number;
  extraPersonPriceCents: number;
  includedPersonsPerUnit: number;
  maxPersonsPerUnit: number | null;
  allowExtraPeople: boolean;
  extraPersonMode: ExtraPersonMode;
  /** Cap on the "Extra Person" add-on PER UNIT (× the adults-driven unit count);
   * null = no limit. See {@link maxExtraPersonsFor}. */
  maxExtraPersonsPerUnit: number | null;
  allowChildren: boolean;
  maxChildAge: number;
  freeChildrenPerUnit: number;
  /** "Maximum children". For CABANA/EVENT/OTHER it's a flat per-booking cap
   * (null = no limit). For BEACH it's PER UMBRELLA — the whole-booking limit is
   * this × the umbrella count (see beachTicketCapacity). */
  maxChildrenPerBooking: number | null;
  extraChildPriceCents: number;
  childrenCountAsPersons: boolean;
  allowMultiDay: boolean;
  maxBookingDays: number | null;
  placeAssignmentRequired: boolean;
  maxPeoplePerBooking: number | null;
  maxCarsPerBooking: number | null;
}

export interface Allocation {
  /** Physical units consumed per day. */
  unitsPerDay: number;
  /** Persons covered by the base price (across all units that day). */
  includedPersons: number;
  /** Persons charged the extra-person price (EXTRA_CHARGE mode only). */
  extraPersons: number;
  /** Children carried free (across all units). */
  includedChildren: number;
  /** Children charged the extra-child price. */
  extraChildren: number;
}

export interface PerDayCost {
  /** ISO yyyy-mm-dd. */
  date: string;
  lines: PriceLine[];
  subtotalCents: number;
}

/** Price-rule subset {@link priceUnitDay} consults. */
export type PriceRuleForCalc = Pick<
  PriceRule,
  'kind' | 'amountCents' | 'startDate' | 'endDate' | 'weekdayMask'
>;

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * The pricing/capacity regime a service follows. This is decided **by the
 * service's `kind`**, not by ad-hoc field combinations — each category owns its
 * own capacity + pricing logic and they never share a single global rule:
 *
 *   • EVENT_PER_PERSON — every guest is billed individually (each adult at the
 *     per-person base price, each child at the configurable child price).
 *   • CABANA_TICKET     — one ticket covers `includedPersonsPerUnit` adults +
 *     `freeChildrenPerUnit` children; any adult OR child beyond that opens an
 *     additional full ticket.
 *   • BEACH_TICKET      — one umbrella (one ticket) covers `includedPersonsPerUnit`
 *     ADULTS (default 4). Children never use umbrella space, so ADULTS alone
 *     drive the umbrella count (every group of up to the capacity opens another
 *     umbrella — never an extra-person surcharge). "Maximum children" is a
 *     per-umbrella cap that scales with the umbrellas. See `beachTicketCapacity`.
 *   • LEGACY            — the original head-count regime (delegated to
 *     `quote()`); used by OTHER / unconfigured services.
 *
 * Prices and the per-ticket capacities remain admin-configurable on the
 * service; only the *logic* that turns them into units + charges is fixed here.
 */
export type ServiceBehavior =
  | 'EVENT_PER_PERSON'
  | 'CABANA_TICKET'
  | 'BEACH_TICKET'
  | 'LEGACY';

export function behaviorFor(kind: ServiceKind): ServiceBehavior {
  switch (kind) {
    case 'EVENT':
      return 'EVENT_PER_PERSON';
    case 'CABANA':
      return 'CABANA_TICKET';
    case 'DAY_USE':
      return 'BEACH_TICKET';
    default:
      return 'LEGACY';
  }
}

/**
 * Whether `children` exceeds the service's "maximum children" per booking for
 * the EVENT / OTHER regimes (a flat per-booking cap). A null cap means "no
 * limit".
 *
 * The grouped-ticket regimes are handled separately because their cap is
 * PER TICKET and scales with the ticket count the ADULTS open:
 *   • Beach (DAY_USE) — `maxChildrenPerBooking` is PER UMBRELLA (see
 *     {@link beachTicketCapacity}).
 *   • Cabana (CABANA) — `maxChildrenPerBooking` is PER CABANA (see
 *     {@link cabanaTicketCapacity}).
 * Both are enforced in calcBooking, so this returns false for them and the flat
 * cap applies only to the per-person EVENT and legacy OTHER services.
 */
export function exceedsChildrenCap(rules: ServiceRules, children: number): boolean {
  const behavior = behaviorFor(rules.kind);
  if (behavior === 'BEACH_TICKET' || behavior === 'CABANA_TICKET') return false;
  if (rules.maxChildrenPerBooking == null) return false;
  return children > rules.maxChildrenPerBooking;
}

/**
 * The per-booking PARTY-SIZE cap (`maxPeoplePerBooking`) counts ADULTS only —
 * never children. Children have their own ceiling ({@link exceedsChildrenCap}
 * and the per-ticket caps), so they must not consume an adult's slot: a service
 * capped at "12 people" admits 12 adults *plus* their children. This is uniform
 * across every kind and matches what the booking UI enforces (the adults
 * stepper is bounded by this cap). Beach already worked this way; the other
 * kinds used to count total heads, which wrongly rejected e.g. "12 adults + 1
 * child" the moment any child was added. Null cap ⇒ no limit.
 */
export function exceedsPeopleCap(rules: ServiceRules, adults: number): boolean {
  if (rules.maxPeoplePerBooking == null) return false;
  return adults > rules.maxPeoplePerBooking;
}

/** What {@link beachTicketCapacity} returns — the umbrella maths for one party. */
export interface BeachCapacity {
  /** People (adults) one umbrella / beach ticket covers (= `ticketCapacity`). */
  includedCapacityPerTicket: number;
  /** Beach tickets required for the party (driven by ADULTS only). */
  requiredTickets: number;
  /** Umbrellas required — identical to `requiredTickets` (1 umbrella per ticket). */
  requiredUmbrellas: number;
  /** Max children this party may carry = per-umbrella cap × umbrellas (null = no limit). */
  maxChildren: number | null;
  /** True when the party needs more than one umbrella. */
  extraTicketRequired: boolean;
}

/**
 * Beach / umbrella capacity — the SINGLE definition of the umbrella rule, shared
 * by the engine ({@link allocateUnits}) and the booking form so server and
 * preview never disagree.
 *
 * One umbrella (one beach ticket) covers `ticketCapacity` ADULTS (the admin's
 * `includedPersonsPerUnit`, default 4). **Children never use umbrella capacity
 * and never count toward the umbrella count** — adults alone drive it:
 *
 *   requiredUmbrellas = ceil(adults / ticketCapacity)   (at least 1)
 *
 * "Maximum children" is a PER-UMBRELLA cap (`maxChildrenPerUmbrella`), so the
 * whole-booking child limit scales with the umbrellas the adults opened:
 *
 *   maxChildren = maxChildrenPerUmbrella × requiredUmbrellas   (null = no limit)
 *
 * Pure, so the maths is identical on the server (the source of truth) and in any
 * preview. Pricing multiplies the base ticket price by `requiredTickets`.
 */
export function beachTicketCapacity(args: {
  adults: number;
  ticketCapacity: number;
  maxChildrenPerUmbrella: number | null;
}): BeachCapacity {
  const toCount = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);
  const cap = Math.max(1, toCount(args.ticketCapacity) || 1);
  const adults = toCount(args.adults);
  const requiredTickets = Math.max(1, Math.ceil(adults / cap));
  const maxChildren =
    args.maxChildrenPerUmbrella != null ? toCount(args.maxChildrenPerUmbrella) * requiredTickets : null;
  return {
    includedCapacityPerTicket: cap,
    requiredTickets,
    requiredUmbrellas: requiredTickets,
    maxChildren,
    extraTicketRequired: requiredTickets > 1,
  };
}

/** What {@link cabanaTicketCapacity} returns — the cabana child-cap maths. */
export interface CabanaCapacity {
  /** Cabanas required for the party, driven by ADULTS only (= ceil(adults / cap)). */
  requiredCabanas: number;
  /** Max children this party may carry = per-cabana cap × cabanas (null = no limit). */
  maxChildren: number | null;
}

/**
 * Cabana child-capacity — the SINGLE definition of the cabana "maximum children"
 * rule, shared by the engine ({@link calcBooking}) and the booking form so the
 * server (source of truth) and the stepper preview never disagree. It mirrors
 * {@link beachTicketCapacity} for umbrellas.
 *
 * The cabana count is driven by ADULTS only — the exact same adult-to-cabana
 * logic already used in {@link allocateUnits} (`ceil(adults / includedPersonsPerUnit)`):
 *
 *   requiredCabanas = ceil(adults / ticketCapacity)   (at least 1)
 *
 * "Maximum children" (`maxChildrenPerCabana`) is a PER-CABANA cap, so the
 * whole-booking child limit scales with the cabanas the adults opened:
 *
 *   maxChildren = maxChildrenPerCabana × requiredCabanas   (null = no limit)
 *
 * Crucially it is driven by ADULTS, NOT by the children-inflated unit count, so
 * children can never enlarge their own ceiling (which would make the cap a
 * no-op). Reuses the identical adult-driven scaling kernel as the umbrella rule
 * so the two grouped-ticket regimes can never drift apart.
 */
export function cabanaTicketCapacity(args: {
  adults: number;
  ticketCapacity: number;
  maxChildrenPerCabana: number | null;
}): CabanaCapacity {
  const { requiredTickets, maxChildren } = beachTicketCapacity({
    adults: args.adults,
    ticketCapacity: args.ticketCapacity,
    maxChildrenPerUmbrella: args.maxChildrenPerCabana,
  });
  return { requiredCabanas: requiredTickets, maxChildren };
}

/**
 * Whole-booking ceiling for the paid "Extra Person" add-on. The admin sets a
 * PER-UNIT cap (`maxExtraPersonsPerUnit`); the ceiling scales with the
 * ADULTS-driven unit count (umbrellas / cabanas) — the exact same kernel as
 * {@link beachTicketCapacity} — so a 2-umbrella party with a per-unit cap of 2
 * may carry up to 4 extra persons. Driven by ADULTS only (extra persons never
 * open units anyway), so the maths is identical on the server and in the
 * stepper preview. Null cap ⇒ no limit.
 */
export function maxExtraPersonsFor(args: {
  adults: number;
  ticketCapacity: number;
  maxExtraPersonsPerUnit: number | null;
}): number | null {
  if (args.maxExtraPersonsPerUnit == null) return null;
  const { requiredTickets } = beachTicketCapacity({
    adults: args.adults,
    ticketCapacity: args.ticketCapacity,
    maxChildrenPerUmbrella: null,
  });
  return Math.max(0, Math.trunc(args.maxExtraPersonsPerUnit)) * requiredTickets;
}

/** Inclusive count of days in a UTC-midnight date range. */
export function dayCount(first: Date, last: Date): number {
  const ms = last.getTime() - first.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

/**
 * Split a party into units + included/extra people and children, following the
 * service's {@link behaviorFor} regime. Pure: depends only on the service rules
 * and the requested adults/children.
 *
 * `extraPersons` is the OPTIONAL customer-selected "Extra Person" add-on count
 * (see `Service.allowExtraPeople`). It is a standalone paid extra that is
 * deliberately kept OUT of the unit maths — it never changes `unitsPerDay`
 * (umbrellas / cabanas) and never counts toward capacity; it only rides through
 * to the `extraPersons` field so {@link priceUnitDay} can bill it separately at
 * `extraPersonPriceCents`. It is honoured only when the service enables the
 * add-on AND uses a grouped-ticket regime (beach / cabana); ignored otherwise.
 */
export function allocateUnits(
  rules: ServiceRules,
  adults: number,
  children: number,
  extraPersons = 0,
): Allocation {
  const a = Math.max(0, Math.trunc(adults));
  const c = Math.max(0, Math.trunc(children));
  // Add-on extra people: gated by the admin switch; never folded into `a`, so it
  // can never inflate the umbrella/cabana count or the capacity cost.
  const e = rules.allowExtraPeople ? Math.max(0, Math.trunc(extraPersons)) : 0;

  switch (behaviorFor(rules.kind)) {
    case 'EVENT_PER_PERSON': {
      // Every head is billed individually — no physical units to split, and no
      // "extra" overflow. One logical booking carries the whole party; pricing
      // multiplies by the per-person / per-child price (see priceUnitDay).
      return {
        unitsPerDay: 1,
        includedPersons: a,
        extraPersons: 0,
        includedChildren: c,
        extraChildren: 0,
      };
    }

    case 'CABANA_TICKET': {
      // One ticket holds `includedPersonsPerUnit` adults AND `freeChildrenPerUnit`
      // children. Exceeding EITHER capacity opens another full ticket, so the
      // unit count is the max of the adult- and child-driven requirements.
      const adultCap = Math.max(1, rules.includedPersonsPerUnit);
      const childCap = Math.max(0, rules.freeChildrenPerUnit);
      const ticketsForAdults = Math.ceil(a / adultCap);
      const ticketsForChildren = childCap > 0 ? Math.ceil(c / childCap) : 0;
      let unitsPerDay = Math.max(1, ticketsForAdults, ticketsForChildren);
      // If the cabana carries no dedicated child capacity, children fall back to
      // consuming adult capacity so they can never ride for free.
      if (childCap === 0 && c > 0) {
        unitsPerDay = Math.max(unitsPerDay, Math.ceil((a + c) / adultCap));
      }
      // Everyone is carried by a ticket; the only "extra" billed is the optional
      // Extra Person add-on (`e`), which is independent of the ticket count.
      return {
        unitsPerDay,
        includedPersons: a,
        extraPersons: e,
        includedChildren: c,
        extraChildren: 0,
      };
    }

    case 'BEACH_TICKET': {
      // One umbrella (one beach ticket) covers `includedPersonsPerUnit` ADULTS.
      // Children never use umbrella space, so ADULTS alone drive the umbrella
      // count; every group of up to the capacity opens ANOTHER umbrella. The
      // per-umbrella children cap is enforced in calcBooking. See
      // `beachTicketCapacity` (the shared definition).
      const { requiredUmbrellas } = beachTicketCapacity({
        adults: a,
        ticketCapacity: rules.includedPersonsPerUnit,
        maxChildrenPerUmbrella: rules.maxChildrenPerBooking,
      });
      return {
        unitsPerDay: requiredUmbrellas,
        includedPersons: a,
        // Optional Extra Person add-on — billed separately, never opens an
        // umbrella (adults alone drive `requiredUmbrellas` above).
        extraPersons: e,
        includedChildren: c,
        extraChildren: 0,
      };
    }

    default: {
      // LEGACY head-count: the whole party is one slot; per-person pricing is
      // handled by PriceRules in quote(), so there are no extras to surface.
      return {
        unitsPerDay: 1,
        includedPersons: a,
        extraPersons: 0,
        includedChildren: 0,
        extraChildren: 0,
      };
    }
  }
}

/**
 * Resolve the base price for a given date from the service's price rules, then
 * build the day's price lines for the service's {@link behaviorFor} regime.
 *
 * The resolved `perUnit` price is the per-adult price for EVENT services and the
 * per-ticket price for CABANA / BEACH. PER_PERSON rules are intentionally
 * ignored here — extra-person pricing comes from `Service.extraPersonPriceCents`
 * (BEACH) or rolls into additional tickets (CABANA), and per-head event pricing
 * comes from the base price directly.
 */
export function priceUnitDay(
  rules: ServiceRules,
  priceRules: PriceRuleForCalc[],
  date: Date,
  allocation: Allocation,
  cars: number,
): PriceLine[] {
  let perUnit = rules.basePriceCents;
  let weekendAdd = 0;
  let perCarCents = 0;

  for (const rule of priceRules) {
    if (rule.startDate && date < rule.startDate) continue;
    if (rule.endDate && date > rule.endDate) continue;

    switch (rule.kind) {
      // FLAT is intentionally NOT handled: `Service.basePriceCents` is the SINGLE
      // source of truth for the per-ticket base price (the value the admin form
      // edits). A FLAT rule used to silently override it, so editing the base
      // price had no effect (the "admin set one price, system shows another" bug).
      // Only DATE_OVERRIDE — a deliberate dated exception — may replace the base.
      case 'DATE_OVERRIDE':
        perUnit = rule.amountCents;
        weekendAdd = 0; // override replaces the day's base entirely
        break;
      case 'WEEKEND_SURCHARGE': {
        const dow = date.getUTCDay();
        if (rule.weekdayMask != null && (rule.weekdayMask & (1 << dow)) !== 0) {
          weekendAdd += rule.amountCents;
        }
        break;
      }
      case 'PER_CAR':
        perCarCents = rule.amountCents;
        break;
      // PER_PERSON: ignored here (see doc comment).
    }
  }

  perUnit += weekendAdd;

  const lines: PriceLine[] = [];

  if (behaviorFor(rules.kind) === 'EVENT_PER_PERSON') {
    // Bill every guest individually: each adult at the per-person base price,
    // each child at the configurable child price.
    if (allocation.includedPersons > 0) {
      lines.push({
        kind: 'PER_PERSON',
        labelKey: 'services.perPerson',
        unitCents: perUnit,
        quantity: allocation.includedPersons,
        totalCents: perUnit * allocation.includedPersons,
      });
    }
    if (allocation.includedChildren > 0 && rules.extraChildPriceCents > 0) {
      lines.push({
        kind: 'EXTRA_CHILD',
        labelKey: 'services.perChild',
        unitCents: rules.extraChildPriceCents,
        quantity: allocation.includedChildren,
        totalCents: rules.extraChildPriceCents * allocation.includedChildren,
      });
    }
  } else {
    // Ticket regimes (CABANA / BEACH): one base line per ticket, then any
    // BEACH per-person / per-child surcharges from the allocation.
    lines.push({
      kind: 'BASE',
      labelKey: 'services.unit',
      unitCents: perUnit,
      quantity: allocation.unitsPerDay,
      totalCents: perUnit * allocation.unitsPerDay,
    });
    if (allocation.extraPersons > 0 && rules.extraPersonPriceCents > 0) {
      lines.push({
        kind: 'PER_PERSON',
        labelKey: 'services.extraPerson',
        unitCents: rules.extraPersonPriceCents,
        quantity: allocation.extraPersons,
        totalCents: rules.extraPersonPriceCents * allocation.extraPersons,
      });
    }
    if (allocation.extraChildren > 0 && rules.extraChildPriceCents > 0) {
      lines.push({
        kind: 'EXTRA_CHILD',
        labelKey: 'services.extraChild',
        unitCents: rules.extraChildPriceCents,
        quantity: allocation.extraChildren,
        totalCents: rules.extraChildPriceCents * allocation.extraChildren,
      });
    }
  }

  if (cars > 0 && perCarCents > 0) {
    lines.push({
      kind: 'PER_CAR',
      labelKey: 'services.perCar',
      unitCents: perCarCents,
      quantity: cars,
      totalCents: perCarCents * cars,
    });
  }
  return lines;
}

/** Merge identical lines (same kind + label + unit price) across days. */
export function aggregateLines(perDay: PerDayCost[]): PriceLine[] {
  const map = new Map<string, PriceLine>();
  for (const day of perDay) {
    for (const line of day.lines) {
      const key = `${line.kind}|${line.labelKey}|${line.unitCents}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.totalCents += line.totalCents;
      } else {
        map.set(key, { ...line });
      }
    }
  }
  return Array.from(map.values());
}
