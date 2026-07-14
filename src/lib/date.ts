/**
 * Date helpers — kept locale-light. UI formatting uses Intl.DateTimeFormat directly.
 */

export function toIsoDate(d: Date): string {
  // yyyy-mm-dd in the local timezone — matches Prisma's `@db.Date` expectations.
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a `yyyy-mm-dd` string to the Date at UTC midnight of that civil day
 * (`Date.UTC(y, m-1, d)`) — the way booking days are stored. Returns null when
 * the string is not `yyyy-mm-dd` OR is not a real calendar date.
 *
 * DATE-001: this now STRICTLY range-checks. A value like `2026-02-31`, `2026-13-01`
 * or `2026-06-00` would otherwise silently roll forward (`Date.UTC` normalizes
 * overflow), landing a booking on the wrong visit day / capacity bucket. We build
 * the date and reject it unless it round-trips to the exact y/m/d supplied.
 */
export function parseIsoDateUTC(iso: string): Date | null {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null; // impossible calendar date (rolled over)
  }
  return dt;
}

/**
 * Expand an inclusive `[startIso, endIso]` (`yyyy-mm-dd`) range to the list of
 * civil-day strings it covers (UTC midnights), capped at 60 days. Returns
 * `[startIso]` for a single/empty/reversed range. Used to render a booking's
 * per-day breakdown (e.g. at the reception desk).
 */
export function rangeDays(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`).getTime();
  const end = new Date(`${endIso}T00:00:00Z`).getTime();
  for (let t = start; t <= end && out.length < 60; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out.length ? out : [startIso];
}

/**
 * Parse report-filter searchParams (`yyyy-mm-dd`) into UTC instants that bound
 * the selected range **in resort-local (Africa/Cairo) civil days** (TIME-001).
 *
 * The venue operates in Cairo, so a "1 July" report must cover Cairo-midnight to
 * Cairo-midnight, not UTC-midnight to UTC-midnight — otherwise a sale just after
 * local midnight (00:00–02:00/03:00 Cairo) lands on the previous UTC day and the
 * daily totals are wrong. `from`/`toExclusive` are the UTC instants of those
 * Cairo boundaries; group buckets with `resortDayKey` (below), not
 * `toISOString()`. Defaults to the last 30 Cairo days; a reversed range is
 * swapped, not rejected.
 */
export function parseReportRange(
  fromStr?: string | null,
  toStr?: string | null,
  now: Date = new Date(),
): { from: Date; toExclusive: Date } {
  const RE = /^\d{4}-\d{2}-\d{2}$/;
  type Civil = [number, number, number];
  const parts = (s: string): Civil => {
    const [y, m, d] = s.split('-').map(Number);
    return [y!, m!, d!];
  };
  /** Shift a civil date by `days`, letting Date.UTC normalize month/year rollover. */
  const shift = ([y, m, d]: Civil, days: number): Civil => {
    const n = new Date(Date.UTC(y, m - 1, d + days));
    return [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()];
  };
  const midMs = ([y, m, d]: Civil): number => Date.UTC(y, m - 1, d);

  const todayKey = resortDayKey(now); // Cairo civil "today" as yyyy-mm-dd
  const today = parts(todayKey);

  let from: Civil = fromStr && RE.test(fromStr) ? parts(fromStr) : shift(today, -29);
  let toInclusive: Civil = toStr && RE.test(toStr) ? parts(toStr) : today;
  if (midMs(toInclusive) < midMs(from)) [from, toInclusive] = [toInclusive, from];

  // Bound the span (safety cap): several report queries load every matching row in
  // the range into memory, so a hand-crafted `?from=2000-01-01&to=2030-01-01` must
  // not be honored. ~13 months covers any legitimate month/quarter/year report.
  const MAX_DAYS = 400;
  const spanDays = Math.round((midMs(toInclusive) - midMs(from)) / 86_400_000);
  if (spanDays > MAX_DAYS - 1) toInclusive = shift(from, MAX_DAYS - 1);

  return {
    from: resortCivilDayStartUTC(...from),
    toExclusive: resortCivilDayStartUTC(...shift(toInclusive, 1)),
  };
}

export function isPastDate(iso: string, now: Date = new Date()): boolean {
  const today = startOfDay(now);
  const target = startOfDay(new Date(iso));
  return target.getTime() < today.getTime();
}

export function formatDate(
  date: Date | string,
  locale: 'ar' | 'en' = 'ar',
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'long' },
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', opts).format(d);
}

/**
 * Format an inclusive `start → end` date range as a plain string.
 *
 * No bidi control characters are embedded (they print as garbage). The
 * "start → end" reading order is kept stable by rendering the value inside an
 * element with `dir="ltr"` — see `DateRange` below / the `dir="ltr"` wrappers at
 * the call sites — so the range is never reordered by an RTL (Arabic) layout.
 */
export function formatDateRange(
  start: Date | string,
  end: Date | string,
  locale: 'ar' | 'en' = 'ar',
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'long' },
): string {
  const a = formatDate(start, locale, opts);
  const b = formatDate(end, locale, opts);
  return `${a} → ${b}`;
}

/**
 * Resort-local civil-day helpers.
 *
 * Crown Island is a single-location El Montazah (Cairo) venue. Booking days are
 * stored as `Date.UTC(localY, localM, localD)` — UTC midnight of the resort-local
 * civil day the guest selected. "Today" for gate admissibility, same-day booking,
 * and working-hours must therefore be the resort's CURRENT civil day in
 * Africa/Cairo, computed independently of the host's process timezone:
 * serverless/containers usually run in UTC, which would otherwise shift the day
 * boundary by 2–3h and refuse valid same-day passes near local midnight (and
 * silently undo the gate-admission civil-day fix). These helpers are
 * timezone-explicit and do not depend on `process.env.TZ`.
 */
export const RESORT_TIME_ZONE = 'Africa/Cairo';

/**
 * The resort-local civil day of `now`, expressed as a UTC-midnight ms timestamp
 * so it compares directly against stored booking day keys
 * (`Date.UTC(localY, localM, localD)`).
 */
export function resortCivilDayUTC(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RESORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'));
}

/**
 * Milliseconds to ADD to a UTC instant to get the zone's wall-clock time
 * (i.e. wallTime − utcTime) at that instant. Derived from Intl so it tracks
 * Egypt's DST (UTC+2 standard / UTC+3 summer) rather than a hard-coded offset.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const hour = get('hour') === 24 ? 0 : get('hour'); // ICU renders midnight as "24" in some locales
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return asIfUtc - instant.getTime();
}

/**
 * The UTC instant of resort-local (Africa/Cairo) MIDNIGHT that starts the civil
 * day `(y, m, d)`. Egypt observes DST so the offset isn't fixed; we derive it at
 * that date. Used for financial report boundaries (TIME-001).
 */
export function resortCivilDayStartUTC(y: number, m: number, d: number): Date {
  const guessUtcMidnight = Date.UTC(y, m - 1, d);
  const offset = zoneOffsetMs(new Date(guessUtcMidnight), RESORT_TIME_ZONE);
  return new Date(guessUtcMidnight - offset);
}

/**
 * The resort-local (Africa/Cairo) civil day of `instant` as `yyyy-mm-dd`. Use
 * this — NOT `instant.toISOString().slice(0,10)` — to bucket report rows by the
 * business day (TIME-001).
 */
export function resortDayKey(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RESORT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** The resort-local wall clock of `now` as `"HH:MM"` (24h, zero-padded). */
export function resortHourMinute(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: RESORT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hourRaw = parts.find((p) => p.type === 'hour')!.value;
  const minute = parts.find((p) => p.type === 'minute')!.value;
  // ICU renders midnight as "24" in some locales; normalise to "00".
  const hour = hourRaw === '24' ? '00' : hourRaw;
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}
