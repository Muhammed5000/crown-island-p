import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { formatDate, parseReportRange } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { isLocale } from '@/i18n/config';
import { getStaffPerformance, type StaffRollup } from '@/server/services/staff-performance';

interface Props {
  params: Promise<{ locale: string; staffId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const ROLE_TONES: Record<string, 'gold' | 'navy' | 'muted' | 'info' | 'success' | 'danger'> = {
  DEVELOPER: 'danger',
  SUPER_ADMIN: 'gold',
  ADMIN: 'success',
  DIRECTOR: 'gold',
  MANAGER: 'info',
  SUPERVISOR: 'info',
  STAFF: 'info',
  SECURITY: 'navy',
  HOUSEKEEPING: 'muted',
  MAINTENANCE: 'muted',
};

const RESULT_TONE = (r: string): 'success' | 'gold' | 'danger' | 'navy' =>
  r === 'ADMITTED' ? 'success' : r === 'RECEPTION' ? 'gold' : r === 'EXITED' ? 'navy' : 'danger';

/**
 * Admin → Staff → single staff profile. Today / this week / this month headline
 * rollups (revenue handled + working hours), plus a per-day breakdown, the shift
 * (work-session) log, and the full gate/reception activity trail over the range.
 */
export default async function StaffProfilePage({ params, searchParams }: Props) {
  const { locale, staffId } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const range = parseReportRange(sp.from, sp.to);
  const fromIso = range.from.toISOString().slice(0, 10);
  const toIso = new Date(range.toExclusive.getTime() - 86_400_000).toISOString().slice(0, 10);

  const t = await getTranslations('admin');
  const perf = await getStaffPerformance(staffId, range, locale);
  if (!perf) notFound();

  const { staff, windows, ranged, days, sessions, events } = perf;
  const money = (cents: number) => formatMoney(cents, { locale, currency: 'EGP' });
  const dt = (d: Date) => formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' });
  const dayLabel = (key: string) => formatDate(new Date(`${key}T00:00:00Z`), locale, { dateStyle: 'medium' });
  const timeOnly = (d: Date) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

  const periods: { label: string; roll: StaffRollup }[] = [
    { label: 'Today', roll: windows.today },
    { label: 'This week', roll: windows.week },
    { label: 'This month', roll: windows.month },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/admin/staff" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            ← {t('staff')}
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold text-gold-700">{staff.name}</h1>
            <Badge tone={ROLE_TONES[staff.role] ?? 'navy'}>{staff.role}</Badge>
            {!staff.active ? <Badge tone="danger">inactive</Badge> : null}
          </div>
          {staff.email ? (
            <p className="mt-1 text-sm text-muted-foreground" dir="ltr">{staff.email}</p>
          ) : null}
        </div>
        <div className="flex items-end gap-2">
          <form className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input type="date" name="from" defaultValue={fromIso} className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input type="date" name="to" defaultValue={toIso} className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent" />
            </label>
            <button type="submit" className="h-10 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground">
              Apply
            </button>
          </form>
        </div>
      </div>

      {/* Today / week / month headline rollups */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {periods.map((p) => (
          <Card key={p.label}>
            <CardBody className="space-y-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{p.label}</p>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">revenue handled</span>
                <span className="font-display text-2xl font-semibold tabular-nums text-gold-700">{money(p.roll.revenueCents)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">working hours</span>
                <span className="font-semibold tabular-nums text-foreground">{formatDuration(p.roll.workedMs)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{p.roll.bookings} bookings · {p.roll.gateScans} scans</span>
                <span>cash {money(p.roll.cashCents)}</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Selected-range totals */}
      <div>
        <h2 className="mb-2 font-display text-lg font-semibold text-gold-700">
          Selected range <span className="text-sm font-normal text-muted-foreground" dir="ltr">({fromIso} → {toIso})</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'net revenue', value: money(ranged.revenueCents), tone: 'text-gold-700' },
            { label: 'cash collected', value: money(ranged.cashCents) },
            { label: 'bookings', value: String(ranged.bookings) },
            { label: 'gate scans', value: String(ranged.gateScans) },
            { label: 'admitted (people)', value: String(ranged.admittedPeople), tone: 'text-green-700' },
            { label: 'working hours', value: formatDuration(ranged.workedMs) },
          ].map((s) => (
            <Card key={s.label}>
              <CardBody>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{s.label}</p>
                <p className={`mt-2 font-display text-xl font-semibold tabular-nums ${s.tone ?? 'text-foreground'}`}>{s.value}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>

      {/* Per-day breakdown */}
      <div>
        <h2 className="mb-2 font-display text-lg font-semibold text-gold-700">Daily breakdown</h2>
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">day</th>
                  <th className="px-4 py-3 text-start">working time</th>
                  <th className="px-4 py-3 text-end">net revenue</th>
                  <th className="px-4 py-3 text-end">cash</th>
                  <th className="px-4 py-3 text-end">bookings</th>
                  <th className="px-4 py-3 text-end">admitted</th>
                  <th className="px-4 py-3 text-end">denied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {days.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      No activity in this range.
                    </td>
                  </tr>
                ) : (
                  days.map((d) => (
                    <tr key={d.date} className="align-top hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">{dayLabel(d.date)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-foreground">
                            {d.workedMs > 0 ? formatDuration(d.workedMs) : '—'}
                          </span>
                          {d.firstScan && d.lastScan ? (
                            <span className="text-xs" dir="ltr">{timeOnly(d.firstScan)} → {timeOnly(d.lastScan)}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums font-semibold text-gold-700">
                        {d.revenueCents ? money(d.revenueCents) : '—'}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">
                        {d.cashCents ? money(d.cashCents) : '—'}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums">{d.bookings || '—'}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-green-700">{d.admittedPeople || '—'}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-red-700">{d.deniedScans || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      {/* Work sessions (shifts) */}
      <div>
        <h2 className="mb-2 font-display text-lg font-semibold text-gold-700">Work sessions</h2>
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">location</th>
                  <th className="px-4 py-3 text-start">started</th>
                  <th className="px-4 py-3 text-start">ended</th>
                  <th className="px-4 py-3 text-end">worked</th>
                  <th className="px-4 py-3 text-start">status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                      No tracked shifts in this range yet — hours accrue from new gate/reception activity.
                    </td>
                  </tr>
                ) : (
                  sessions.map((s) => (
                    <tr key={s.id} className="align-top hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Badge tone={s.location === 'RECEPTION' ? 'gold' : s.location === 'GATE' ? 'success' : 'navy'}>
                          {s.location}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">{dt(s.startedAt)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                        {s.endedAt ? dt(s.endedAt) : dt(s.lastActivityAt)}
                      </td>
                      <td className="px-4 py-3 text-end font-semibold tabular-nums">{formatDuration(s.workedMs)}</td>
                      <td className="px-4 py-3">
                        {s.open ? (
                          <span className="text-xs font-medium text-green-700">open</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">closed</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      {/* Activity trail */}
      <div>
        <h2 className="mb-2 font-display text-lg font-semibold text-gold-700">Activity trail</h2>
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">when</th>
                  <th className="px-4 py-3 text-start">result</th>
                  <th className="px-4 py-3 text-start">guest</th>
                  <th className="px-4 py-3 text-start">category</th>
                  <th className="px-4 py-3 text-end">people</th>
                  <th className="px-4 py-3 text-end">amount</th>
                  <th className="px-4 py-3 text-start">reference</th>
                  <th className="px-4 py-3 text-start">detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                      No gate or reception activity in this range.
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id} className="align-top hover:bg-muted/30">
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">{dt(e.createdAt)}</td>
                      <td className="px-4 py-3"><Badge tone={RESULT_TONE(e.result)}>{e.result}</Badge></td>
                      <td className="px-4 py-3 text-foreground">{e.guestName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{e.categoryName}</td>
                      <td className="px-4 py-3 text-end text-muted-foreground">{e.people}</td>
                      <td className="px-4 py-3 text-end text-xs" dir="ltr">
                        {e.amountCents != null ? (
                          <span className="font-semibold text-gold-700">{money(e.amountCents)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">{e.reference ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.reason ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
        {events.length >= perf.eventLimit ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the most recent {perf.eventLimit} events — narrow the date range to see older activity.
          </p>
        ) : null}
      </div>
    </div>
  );
}
