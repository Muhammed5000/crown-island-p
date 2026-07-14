/**
 * Pure place-capacity ceiling logic (no server-only/Prisma deps → unit-testable).
 *
 * For a service that requires a physical place (cabana/spot), the number of
 * ACTIVE places is an ABSOLUTE ceiling on how many units can be sold in a day —
 * it can never be exceeded, even if the configured `dailyCapacityPeople` was
 * left blank or set higher than the real inventory.
 *
 * Why this exists: the daily counter (`BookingSlot.reservedPeople`) actually
 * holds UNITS for place services (`unitCapacityCost` = max(1, unitsPerDay)), but
 * the cap is named `dailyCapacityPeople`. If an admin set that cap larger than
 * the place count, the unit counter was compared against a people number and the
 * service oversold past its physical inventory. Clamping the effective cap to the
 * active place count closes that hole in ONE place, shared by the online quote,
 * online create, reception create, and the payment-confirm re-check.
 */
export function effectiveDailyCap(
  dailyCap: number | null,
  placeRequired: boolean,
  activePlaceCount: number,
): number | null {
  // Non-place services keep their configured cap (null = unlimited).
  if (!placeRequired) return dailyCap;
  // A place-required service with no active places configured has nothing to
  // clamp against — fall back to the explicit cap (which may itself be null).
  if (activePlaceCount <= 0) return dailyCap;
  // The place count is the hard ceiling: unlimited (null) becomes the place
  // count; an explicit cap is clamped down to it (never up).
  return dailyCap == null ? activePlaceCount : Math.min(dailyCap, activePlaceCount);
}

/**
 * First requested place id that is NOT in the free set, or null if all are free.
 * Drives the preventive "is this place already taken?" check shared by the gate
 * assign path and the reception create path — a clean rejection instead of a
 * late unique-constraint (P2002) collision.
 */
export function firstUnavailablePlace(
  requestedPlaceIds: readonly string[],
  freePlaceIds: ReadonlySet<string>,
): string | null {
  for (const id of requestedPlaceIds) {
    if (!freePlaceIds.has(id)) return id;
  }
  return null;
}
