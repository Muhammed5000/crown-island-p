import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { isLocale } from '@/i18n/config';
import { getGateActivityReport } from '@/server/services/gate-scan';

interface Props {
  params: Promise<{ locale: string }>;
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
 * Admin → Gate activity.
 */
export default async function AdminGateActivityPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const { operators, events } = await getGateActivityReport(locale);

  const dt = (d: Date) => formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' });
  const money = (cents: number) => formatMoney(cents, { locale, currency: 'EGP' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-gold-700">{t('gateActivity')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Working time, admit / deny counts, reception sales, and the full activity trail for staff
          and security operators.
        </p>
      </div>

      {/* Per-operator summary */}
      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">operator</th>
                <th className="px-4 py-3 text-start">role</th>
                <th className="px-4 py-3 text-start">working time</th>
                <th className="px-4 py-3 text-end">admitted (people)</th>
                <th className="px-4 py-3 text-end">denied (people)</th>
                <th className="px-4 py-3 text-end">reception</th>
                <th className="px-4 py-3 text-end">scans</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {operators.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No staff or security users yet.
                  </td>
                </tr>
              ) : (
                operators.map((op) => (
                  <tr key={op.id} className="align-top hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/admin/gate-activity/${op.id}`}
                        className="text-accent underline-offset-4 hover:underline"
                      >
                        {op.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={ROLE_TONES[op.role] ?? 'navy'}>{op.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {op.firstScan && op.lastScan ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-foreground">{formatDuration(op.durationMs)}</span>
                          <span className="text-xs" dir="ltr">
                            {dt(op.firstScan)} → {dt(op.lastScan)}
                          </span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span className="font-semibold text-green-700">{op.admittedPeople}</span>
                      <span className="text-xs text-muted-foreground"> · {op.admittedScans} scans</span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span className="font-semibold text-red-700">{op.deniedPeople}</span>
                      <span className="text-xs text-muted-foreground"> · {op.deniedScans} scans</span>
                    </td>
                    <td className="px-4 py-3 text-end">
                      {op.receptionScans > 0 ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-semibold text-gold-700">{money(op.receptionAmountCents)}</span>
                          <span className="text-xs text-muted-foreground">
                            {op.receptionScans} bookings · {op.receptionPeople} people
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end text-muted-foreground">
                      {op.admittedScans + op.deniedScans + op.receptionScans}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Per-scan trail */}
      <div>
        <h2 className="mb-2 font-display text-lg font-semibold text-gold-700">Scan trail</h2>
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">when</th>
                  <th className="px-4 py-3 text-start">operator</th>
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
                    <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                      No gate activity recorded yet.
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id} className="align-top hover:bg-muted/30">
                      <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">
                        {dt(e.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-foreground">{e.operatorName}</span>
                        <span className="block text-xs text-muted-foreground">{e.operatorRole}</span>
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
