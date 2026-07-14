import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { formatDate, parseReportRange } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { isLocale } from '@/i18n/config';
import { getStaffDirectory } from '@/server/services/staff-performance';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}

/** Human "Xh Ym" label from a millisecond span. */
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

/**
 * Admin → Staff. Operational performance directory: one row per gate/reception
 * staff member with their bookings, scans, revenue handled, cash collected and
 * working hours over the selected date range. Links to each staffer's profile.
 */
export default async function AdminStaffPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const range = parseReportRange(sp.from, sp.to);
  const fromIso = range.from.toISOString().slice(0, 10);
  const toIso = new Date(range.toExclusive.getTime() - 86_400_000).toISOString().slice(0, 10);

  const t = await getTranslations('admin');
  const rows = await getStaffDirectory(range);

  const money = (cents: number) => formatMoney(cents, { locale, currency: 'EGP' });
  const dt = (d: Date) => formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' });
  const exportHref = (format: 'csv' | 'xlsx') =>
    `/api/admin/export?type=report-staff&from=${fromIso}&to=${toIso}&format=${format}`;

  const totals = rows.reduce(
    (a, r) => {
      a.bookings += r.rollup.bookings;
      a.scans += r.rollup.gateScans;
      a.revenue += r.rollup.revenueCents;
      a.cash += r.rollup.cashCents;
      a.worked += r.rollup.workedMs;
      return a;
    },
    { bookings: 0, scans: 0, revenue: 0, cash: 0, worked: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">{t('staff')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Per-staff bookings, gate scans, revenue handled, cash collected and working hours.
            Revenue is the net paid-invoice amount (refunds removed); cash is what was physically
            collected at the desk — the two are shown separately, never added together.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <form className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <input
                type="date"
                name="from"
                defaultValue={fromIso}
                className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <input
                type="date"
                name="to"
                defaultValue={toIso}
                className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <button
              type="submit"
              className="h-10 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Apply
            </button>
          </form>
          <a
            href={exportHref('xlsx')}
            className="h-10 rounded-2xl border border-border/60 bg-input px-4 text-sm leading-10 text-foreground hover:border-accent"
          >
            Excel
          </a>
        </div>
      </div>

      {/* Totals across all staff in range */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        {[
          { label: 'net revenue', value: money(totals.revenue), tone: 'text-gold-700' },
          { label: 'cash collected', value: money(totals.cash), tone: 'text-gold-700' },
          { label: 'reception bookings', value: String(totals.bookings) },
          { label: 'gate scans', value: String(totals.scans) },
          { label: 'working hours', value: formatDuration(totals.worked) },
        ].map((s) => (
          <Card key={s.label}>
            <CardBody>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{s.label}</p>
              <p className={`mt-2 font-display text-2xl font-semibold tabular-nums ${s.tone ?? 'text-foreground'}`}>
                {s.value}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">staff</th>
                <th className="px-4 py-3 text-start">role</th>
                <th className="px-4 py-3 text-end">bookings</th>
                <th className="px-4 py-3 text-end">gate scans</th>
                <th className="px-4 py-3 text-end">admitted</th>
                <th className="px-4 py-3 text-end">net revenue</th>
                <th className="px-4 py-3 text-end">cash collected</th>
                <th className="px-4 py-3 text-end">worked hours</th>
                <th className="px-4 py-3 text-end">active window</th>
                <th className="px-4 py-3 text-start">last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                    No gate or reception staff yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/admin/staff/${r.id}`}
                        className="text-accent underline-offset-4 hover:underline"
                      >
                        {r.name}
                      </Link>
                      {!r.active ? (
                        <span className="ms-2 text-xs text-red-700">inactive</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={ROLE_TONES[r.role] ?? 'navy'}>{r.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">{r.rollup.bookings || '—'}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{r.rollup.gateScans || '—'}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-green-700">
                      {r.rollup.admittedPeople || '—'}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums font-semibold text-gold-700">
                      {r.rollup.revenueCents ? money(r.rollup.revenueCents) : '—'}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">
                      {r.rollup.cashCents ? money(r.rollup.cashCents) : '—'}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {r.rollup.workedMs > 0 ? (
                        <span className="font-semibold text-foreground">{formatDuration(r.rollup.workedMs)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end text-xs text-muted-foreground tabular-nums">
                      {r.rollup.scanWindowMs > 0 ? formatDuration(r.rollup.scanWindowMs) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                      {r.lastActiveAt ? dt(r.lastActiveAt) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <p className="text-xs text-muted-foreground">
        Working hours are measured from real gate/reception activity (a shift auto-starts on the
        first action and a gap longer than 3 hours starts a new one). Historical days before this
        tracking began show an “active window” (first→last scan) instead.
      </p>
    </div>
  );
}
