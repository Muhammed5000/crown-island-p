import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/server/db/prisma';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { Pagination } from '@/components/ui/Pagination';
import { ExportButton } from '../ExportButton';
import { ProfessionalReportExport } from './ProfessionalReport';

const STATUS_TONES = {
  DRAFT: 'muted' as const,
  ISSUED: 'warning' as const,
  PAID: 'success' as const,
  FAILED: 'danger' as const,
  CANCELLED: 'muted' as const,
};

export default async function AdminInvoicesPage({
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

  const [total, invoices] = await Promise.all([
    prisma.invoice.count(),
    prisma.invoice.findMany({
      include: { booking: { include: { user: { select: { name: true, email: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-gold-700">{t('invoices')}</h1>
        <ExportButton type="invoices" />
      </header>

      <ProfessionalReportExport locale={locale} />

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">booking</th>
                <th className="px-4 py-3 text-start">user</th>
                <th className="px-4 py-3 text-end">total</th>
                <th className="px-4 py-3 text-end">status</th>
                <th className="px-4 py-3 text-end">paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${inv.bookingId}`}
                      dir="ltr"
                      className="font-display text-accent underline-offset-4 hover:underline"
                    >
                      {inv.booking.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {inv.booking.user.name ?? inv.booking.user.email ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {formatMoney(inv.totalCents, { locale, currency: 'EGP' })}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Badge tone={STATUS_TONES[inv.status]}>{inv.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-end text-xs text-muted-foreground">
                    {inv.paidAt ? formatDate(inv.paidAt, locale) : '—'}
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
        baseUrl="/admin/invoices"
        searchParams={sp}
      />
    </div>
  );
}
