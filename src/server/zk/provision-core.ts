/**
 * PURE provisioning helpers (no `server-only`, no DB, no network) so they can be
 * unit-tested directly with `tsx --test`. The impure orchestration that talks to
 * the DB and the ZK server lives in `provision.ts` and calls into these.
 */

/**
 * The ZK access window for a booking, formatted as ZKBio expects
 * (`"yyyy-MM-dd HH:mm:ss"`, interpreted in the ZK server's local time — which is
 * the resort-local time, since the server is on-prem).
 *
 * Booking day keys are stored as UTC midnight of the resort-local CIVIL day
 * (`Date.UTC(localY, localM, localD)`), so we read the y/m/d back with UTC getters
 * and emit them as a naive local datetime string: the guest's card + QR are valid
 * from 00:00:00 on the first day through 23:59:59 on the last day.
 */
export function zkAccessWindow(
  bookingDate: Date,
  endDate: Date | null | undefined,
): { start: string; end: string } {
  const first = bookingDate;
  const last = endDate ?? bookingDate;
  return {
    start: `${isoCivilDay(first)} 00:00:00`,
    end: `${isoCivilDay(last)} 23:59:59`,
  };
}

/** `yyyy-MM-dd` of a stored civil-day key (UTC-midnight ⇒ read with UTC getters). */
export function isoCivilDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The distinct ZK access-level ids that a booking's ASSIGNED places open. Empty
 * until at least one unit has a place with a `zkAccessLevelId` — that is a valid
 * intermediate state (the person is registered; the specific door binds once
 * reception assigns the cabin), not an error.
 */
export function computeDesiredLevels(
  units: ReadonlyArray<{ place: { zkAccessLevelId: string | null } | null }>,
): string[] {
  const set = new Set<string>();
  for (const u of units) {
    const id = u.place?.zkAccessLevelId?.trim();
    if (id) set.add(id);
  }
  return [...set];
}

/**
 * True when the booking's LAST day is strictly before the resort's current civil
 * day — i.e. the access window has fully elapsed and the ZK person + card should
 * be torn down. `nowCivilDayUTC` comes from `resortCivilDayUTC()`.
 */
export function isBookingPastCivilDay(
  lastDay: Date,
  endDate: Date | null | undefined,
  nowCivilDayUTC: number,
): boolean {
  const last = endDate ?? lastDay;
  return nowCivilDayUTC > last.getTime();
}

/**
 * A display name for the ZK person record (not security-critical). Prefers the
 * walk-in guest name, then the account holder's name, then a reference fallback.
 */
export function zkPersonName(input: {
  guestName?: string | null;
  userName?: string | null;
  reference: string;
}): string {
  const name = (input.guestName || input.userName || '').trim();
  return name || `Guest ${input.reference}`;
}

/** Whether a booking status still warrants active ZK access (non-terminal). */
export function isActiveBookingStatus(status: string): boolean {
  return status === 'CONFIRMED' || status === 'PENDING_PAYMENT';
}
