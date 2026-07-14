import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/server/db/prisma';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { CancelPaymentButton } from '../bookings/[id]/CancelPaymentButton';
import { Pagination } from '@/components/ui/Pagination';

const TONES = {
  PENDING: 'warning' as const,
  SUCCEEDED: 'success' as const,
  FAILED: 'danger' as const,
  REFUND_PENDING: 'warning' as const,
  REFUNDED: 'muted' as const,
};

export default async function AdminPaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations('admin');

  const page = sp.page ? parseInt(sp.page, 10) : 1;
  const pageSize = 20;

  const [total, payments] = await Promise.all([
    prisma.payment.count(),
    prisma.payment.findMany({
      // Booking status drives whether the Cancel action is available. Refund
      // is a separate flow on the booking detail page.
      include: { booking: { select: { id: true, reference: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-gold-700">{t('payments')}</h1>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">booking</th>
                <th className="px-4 py-3 text-start">provider</th>
                <th className="px-4 py-3 text-start">intentId</th>
                <th className="px-4 py-3 text-end">amount</th>
                <th className="px-4 py-3 text-end">status</th>
                <th className="px-4 py-3 text-end">created</th>
                <th className="px-4 py-3 text-end">actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${p.booking.id}`}
                      dir="ltr"
                      className="font-display text-accent underline-offset-4 hover:underline"
                    >
                      {p.booking.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.provider}</td>
                  <td
                    className="px-4 py-3 text-muted-foreground"
                    dir="ltr"
                    title={p.paymobOrderId ?? ''}
                  >
                    {p.paymobOrderId ? `${p.paymobOrderId.slice(0, 18)}…` : '—'}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {formatMoney(p.amountCents, { locale, currency: 'EGP' })}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Badge tone={TONES[p.status]}>{p.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-end text-xs text-muted-foreground">
                    {formatDate(p.createdAt, locale)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {p.status === 'PENDING' && p.booking.status === 'PENDING_PAYMENT' ? (
                      <CancelPaymentButton bookingId={p.booking.id} compact />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination
        currentPage={page}
        totalPages={Math.ceil(total / pageSize)}
        baseUrl="/admin/payments"
        searchParams={sp}
      />
    </div>
  );
}
