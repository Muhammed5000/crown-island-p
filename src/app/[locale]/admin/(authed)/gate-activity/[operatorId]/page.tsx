import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { isLocale } from '@/i18n/config';
import { getOperatorGateProfile } from '@/server/services/gate-scan';

interface Props {
  params: Promise<{ locale: string; operatorId: string }>;
}

/** Human "Xh Ym" working-time label from a millisecond span. */
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
  STAFF: 'info',
  SECURITY: 'navy',
  TESTER: 'info',
  CUSTOMER: 'muted',
};

/**
 * Admin → Gate activity → single operator profile.
 *
 * Shows the operator's work broken down per day (working time + admit / deny
 * counts) and the full chronological history of every booking they scanned.
 */
export default async function GateOperatorProfilePage({ params }: Props) {
  const { locale, operatorId } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const profile = await getOperatorGateProfile(operatorId, locale);
  if (!profile) notFound();

  const { operator, totals, days, events } = profile;

  const dt = (d: Date) => formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' });
  const money = (cents: number) => formatMoney(cents, { locale, currency: 'EGP' });
  const dayLabel = (key: string) =>
    formatDate(new Date(`${key}T00:00:00Z`), locale, { dateStyle: 'full' });
  const timeOnly = (d: Date) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);

  const stats = [
    { label: 'days worked', value: String(totals.daysWorked) },
    {
      label: 'admitted (people)',
      value: String(totals.admittedPeople),
      tone: 'text-green-700',
    },
    { label: 'denied (people)', value: String(totals.deniedPeople), tone: 'text-red-700' },
    {
      label: 'reception (collected)',
      value: money(totals.receptionAmountCents),
      tone: 'text-gold-700',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/gate-activity"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          ← {t('gateActivity')}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-gold-700">{operator.name}</h1>
          <Badge tone={ROLE_TONES[operator.role] ?? 'navy'}>{operator.role}</Badge>
        </div>
        {operator.email ? (
          <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
            {operator.email}
          </p>
        ) : null}
        {totals.firstScan && totals.lastScan ? (
          <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
            {dt(totals.firstScan)} → {dt(totals.lastScan)}
          </p>
        ) : null}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardBody>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{s.label}</p>
              <p
                className={`mt-2 font-display text-3xl font-semibold tabular-nums ${s.tone ?? 'text-gold-700'}`}
              >
                {s.value}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Per-day work */}
      <div>
        <h2 className="mb-2 font-display text-lg font-semibold text-gold-700">Daily work</h2>
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">day</th>
                  <th className="px-4 py-3 text-start">working time</th>
                  <th className="px-4 py-3 text-end">admitted (people)</th>
                  <th className="px-4 py-3 text-end">denied (people)</th>
                  <th className="px-4 py-3 text-end">reception</th>
                  <th className="px-4 py-3 text-end">scans</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {days.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                      No gate activity recorded for this operator yet.
                    </td>
                  </tr>
                ) : (
                  days.map((d) => (
                    <tr key={d.date} className="align-top hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">{dayLabel(d.date)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-foreground">
                            {formatDuration(d.durationMs)}
                          </span>
                          <span className="text-xs" dir="ltr">
                            {timeOnly(d.firstScan)} → {timeOnly(d.lastScan)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <span className="font-semibold text-green-700">{d.admittedPeople}</span>
                        <span className="text-xs text-muted-foreground"> · {d.admittedScans} scans</span>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <span className="font-semibold text-red-700">{d.deniedPeople}</span>
                        <span className="text-xs text-muted-foreground"> · {d.deniedScans} scans</span>
                      </td>
                      <td className="px-4 py-3 text-end">
                        {d.receptionScans > 0 ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="font-semibold text-gold-700">{money(d.receptionAmountCents)}</span>
                            <span className="text-xs text-muted-foreground">
                              {d.receptionScans} bookings · {d.receptionPeople} people
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-end text-muted-foreground">
                        {d.admittedScans + d.deniedScans + d.receptionScans}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      {/* Full scan history */}
      <div>
        <h2 className="mb-2 font-display text-lg font-semibold text-gold-700">Scan history</h2>
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">when</th>
                  <th className="px-4 py-3 text-start">result</th>
                  <th className="px-4 py-3 text-start">guest</th>
                  <th className="px-4 py-3 text-start">category</th>
                  <th className="px-4 py-3 text-end">people</th>
                  <th className="px-4 py-3 text-end">amount</th>
                  <th className="px-4 py-3 text-start">reference</th>
                  <th className="px-4 py-3 text-start">reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                      No gate activity recorded for this operator yet.
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id} className="align-top hover:bg-muted/30">
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                        {dt(e.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            e.result === 'ADMITTED'
                              ? 'success'
                              : e.result === 'RECEPTION'
                                ? 'gold'
                                : 'danger'
                          }
                        >
                          {e.result}
                        </Badge>
                      </td>
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
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                        {e.reference ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.reason ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
