import { setRequestLocale } from 'next-intl/server';
import { GavelIcon } from 'lucide-react';
import { SanctionStatus } from '@prisma/client';
import { Link } from '@/i18n/navigation';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, CardBody } from '@/components/ui/Card';
import { requireAdmin } from '@/server/auth/guards';
import { adminListSanctions } from '@/server/services/sanctions';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';

const STATUS_TONE: Record<SanctionStatus, BadgeTone> = {
  ACTIVE: 'danger',
  PAID: 'success',
  WAIVED: 'info',
  CANCELLED: 'muted',
};

const FILTERS = ['ALL', ...Object.values(SanctionStatus)] as const;

/**
 * Admin: every sanction across all customers, filterable by status. Sanctions
 * are CREATED from the customer's profile page (where the admin already has
 * the full context) — this list is the cross-customer overview.
 */
export default async function AdminSanctionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  await requireAdmin();

  const sp = await searchParams;
  const statusFilter = Object.values(SanctionStatus).includes(sp.status as SanctionStatus)
    ? (sp.status as SanctionStatus)
    : undefined;

  const sanctions = await adminListSanctions(statusFilter);
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const activeTotal = sanctions
    .filter((s) => s.status === 'ACTIVE')
    .reduce((sum, s) => sum + s.amountCents, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Sanctions</h1>
        <p className="text-sm text-muted-foreground">
          Financial penalties placed on customers. ACTIVE sanctions are collected automatically on
          the customer&apos;s next booking (online or at reception). Add a sanction from the
          customer&apos;s profile page.
          {activeTotal > 0 ? ` Outstanding now: ${money(activeTotal)}.` : ''}
        </p>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f === 'ALL' ? !statusFilter : statusFilter === f;
          const href = f === 'ALL' ? '/admin/sanctions' : `/admin/sanctions?status=${f}`;
          return (
            <Link
              key={f}
              href={href}
              className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                active
                  ? 'border-gold-400/60 bg-gold-400/15 text-gold-700'
                  : 'border-border/60 text-muted-foreground hover:border-gold-400/40 hover:text-foreground'
              }`}
            >
              {f}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          {sanctions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-14 text-center text-sm text-muted-foreground">
              <GavelIcon className="size-8 text-gold-400/50" strokeWidth={1.5} />
              No sanctions{statusFilter ? ` with status ${statusFilter}` : ''}.
            </div>
          ) : (
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">Customer</th>
                  <th className="px-4 py-3 text-end">Amount</th>
                  <th className="px-4 py-3 text-start">Reason</th>
                  <th className="px-4 py-3 text-start">Created</th>
                  <th className="px-4 py-3 text-start">Settled</th>
                  <th className="px-4 py-3 text-end">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {sanctions.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customers/${s.userId}`}
                        className="font-medium text-foreground underline-offset-4 hover:text-gold-700 hover:underline"
                      >
                        {s.user.name ?? s.user.email ?? s.user.phone ?? s.userId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-end font-bold tabular-nums text-foreground">
                      {money(s.amountCents)}
                    </td>
                    <td className="max-w-[280px] px-4 py-3 text-muted-foreground">
                      <p className="truncate" title={s.reason}>{s.reason}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(s.createdAt, locale)}
                      {s.createdByName ? <p className="text-xs">by {s.createdByName}</p> : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.settledAt ? (
                        <>
                          {formatDate(s.settledAt, locale)}
                          {s.paidByBookingReference ? (
                            <p className="text-xs">
                              booking{' '}
                              <Link
                                href={`/admin/bookings/${s.paidByBookingId}`}
                                className="text-gold-600 underline-offset-4 hover:underline"
                              >
                                {s.paidByBookingReference}
                              </Link>
                            </p>
                          ) : s.settledByName ? (
                            <p className="text-xs">by {s.settledByName}</p>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <span className="inline-flex flex-wrap justify-end gap-1.5">
                        {s.lockedByPendingBooking ? <Badge tone="warning">In checkout</Badge> : null}
                        <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
