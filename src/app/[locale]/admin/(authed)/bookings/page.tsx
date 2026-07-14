import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { BookingStatusBadge } from '@/components/booking/BookingStatusBadge';
import { adminListBookings } from '@/server/services/admin-bookings';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { Pagination } from '@/components/ui/Pagination';
import { ExportButton } from '../ExportButton';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}

export default async function AdminBookingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations('admin');
  const tBooking = await getTranslations('booking');
  const tCommon = await getTranslations('common');

  const page = sp.page ? parseInt(sp.page, 10) : 1;

  const { items: bookings, totalPages } = await adminListBookings({
    q: sp.q,
    status:
      sp.status === 'CONFIRMED' ||
      sp.status === 'PENDING_PAYMENT' ||
      sp.status === 'CANCELLED' ||
      sp.status === 'EXPIRED' ||
      sp.status === 'FAILED'
        ? sp.status
        : undefined,
    page,
    pageSize: 20,
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-gold-700">{t('bookings')}</h1>
        <ExportButton type="bookings" />
      </header>

      <form className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder={tCommon('search')}
          className="h-10 rounded-2xl border border-border/60 bg-input px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">{tCommon('viewAll')}</option>
          <option value="PENDING_PAYMENT">PENDING_PAYMENT</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="EXPIRED">EXPIRED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <button
          type="submit"
          className="h-10 rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          {tCommon('search')}
        </button>
      </form>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{tBooking('reference')}</th>
                <th className="px-4 py-3 text-start">{tBooking('stepDate')}</th>
                <th className="px-4 py-3 text-start">{t('services')}</th>
                <th className="px-4 py-3 text-start">{t('users')}</th>
                <th className="px-4 py-3 text-end">{tBooking('total')}</th>
                <th className="px-4 py-3 text-end">{t('bookings')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      dir="ltr"
                      className="font-display text-accent underline-offset-4 hover:underline"
                    >
                      {b.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(b.bookingDate, locale)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {locale === 'ar' ? b.service.nameAr : b.service.nameEn}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {b.createdByStaffId ? (
                      <div className="flex flex-col">
                        <span className="text-foreground font-medium">{b.guestName ?? '—'}</span>
                        <span className="text-[10px] uppercase tracking-wider opacity-60">Reception ({b.user.name ?? 'Staff'})</span>
                      </div>
                    ) : (
                      b.user.name ?? b.user.email ?? b.user.phone ?? '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {b.invoice
                      ? formatMoney(b.invoice.totalCents, { locale, currency: 'EGP' })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <BookingStatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
              {bookings.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    —
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        baseUrl="/admin/bookings"
        searchParams={sp}
      />
    </div>
  );
}
