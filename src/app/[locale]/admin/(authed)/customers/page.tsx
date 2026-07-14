import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { adminListCustomers, type CustomerSort } from '@/server/services/admin-customers';
import { adminListTags } from '@/server/services/admin-tags';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { ExportButton } from '../ExportButton';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; sort?: string; page?: string; tag?: string }>;
}

export default async function AdminCustomersPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  const page = sp.page ? parseInt(sp.page, 10) : 1;
  const sort: CustomerSort = sp.sort === 'name' ? 'name' : 'recent';

  const [{ items, total, totalPages }, tags] = await Promise.all([
    adminListCustomers({ q: sp.q, sort, page, pageSize: 20, tagId: sp.tag }),
    adminListTags(),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">{t('customers')}</h1>
          <p className="text-xs text-muted-foreground">{total} {total === 1 ? 'customer' : 'customers'}</p>
        </div>
        <ExportButton type="customers" />
      </header>

      <form className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder={`${tCommon('search')} — name, email, phone, ID…`}
          className="h-10 min-w-[240px] flex-1 rounded-2xl border border-border/60 bg-input px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          name="sort"
          defaultValue={sort}
          className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="recent">Newest first</option>
          <option value="name">Name (A–Z)</option>
        </select>
        <select
          name="tag"
          defaultValue={sp.tag ?? ''}
          className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {tags.map((tg) => (
            <option key={tg.id} value={tg.id}>{tg.name}</option>
          ))}
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
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">Customer</th>
                <th className="px-4 py-3 text-start">Phone</th>
                <th className="px-4 py-3 text-start">Region</th>
                <th className="px-4 py-3 text-end">Bookings</th>
                <th className="px-4 py-3 text-end">Spent</th>
                <th className="px-4 py-3 text-start">Last booking</th>
                <th className="px-4 py-3 text-start">Registered</th>
                <th className="px-4 py-3 text-end">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${c.id}`} className="group flex flex-col">
                      <span className="font-medium text-accent underline-offset-4 group-hover:underline">
                        {c.name ?? '—'}
                      </span>
                      <span className="text-xs text-muted-foreground">{c.email ?? '—'}</span>
                    </Link>
                    {c.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.tags.map((tg) => (
                          <Badge key={tg.id} tone={tg.color as BadgeTone}>{tg.name}</Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.region ?? '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-foreground">{c.totalBookings}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-foreground">
                    {c.spentCents > 0 ? formatMoney(c.spentCents, { locale, currency: 'EGP' }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.lastBookingAt ? formatDate(c.lastBookingAt, locale) : '—'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(c.createdAt, locale)}</td>
                  <td className="px-4 py-3 text-end">
                    <span className="inline-flex flex-wrap justify-end gap-1.5">
                      {c.hasActiveSanctions ? <Badge tone="danger">Sanctions</Badge> : null}
                      <Badge tone={c.verified ? 'success' : 'muted'}>{c.verified ? 'Verified' : 'Unverified'}</Badge>
                    </span>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">—</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination currentPage={page} totalPages={totalPages} baseUrl="/admin/customers" searchParams={sp} />
    </div>
  );
}
