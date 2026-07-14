import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/server/db/prisma';
import { formatMoney } from '@/lib/money';
import { isLocale } from '@/i18n/config';

/**
 * What each PriceRule kind actually does, so an admin can tell at a glance which
 * rows affect the price. The base ticket price (edited in service settings) is
 * the SINGLE source of truth; these rules only ADJUST it — except FLAT, which is
 * retired and never applied (it used to silently override the base, which is the
 * "I set one price, the system shows another" bug this page now makes obvious).
 */
const RULE_INFO: Record<string, { label: string; note: string; applied: boolean }> = {
  PER_PERSON: { label: 'Extra person', note: 'Added per additional guest', applied: true },
  PER_CAR: { label: 'Per car', note: 'Added per car', applied: true },
  WEEKEND_SURCHARGE: { label: 'Weekend surcharge', note: 'Added on the marked weekdays', applied: true },
  DATE_OVERRIDE: { label: 'Dated override', note: 'Replaces the base price on its dates', applied: true },
  FLAT: { label: 'Flat price (retired)', note: 'Ignored — the base price wins', applied: false },
};

export default async function AdminPricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('admin');

  const services = await prisma.service.findMany({
    include: {
      category: true,
      priceRules: { orderBy: { priority: 'asc' } },
    },
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-foreground">{t('pricing')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          The <strong className="text-foreground">base price</strong> is the active per-ticket price
          for each service — edit it in the service&apos;s settings. The rules below only{' '}
          <em className="not-italic">adjust</em> that base (extra guests, cars, weekends, dated overrides); they never
          silently replace it.
        </p>
      </div>

      <div className="space-y-3">
        {services.map((s) => (
          <Card key={s.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.3em] text-gold-600/80">
                    {locale === 'ar' ? s.category.nameAr : s.category.nameEn}
                  </p>
                  <h2 className="mt-0.5 font-display text-base text-gold-600">
                    {locale === 'ar' ? s.nameAr : s.nameEn}
                  </h2>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Base price (active)
                  </p>
                  <p className="font-display text-lg tabular-nums text-foreground">
                    {formatMoney(s.basePriceCents, { locale, currency: 'EGP' })}
                  </p>
                  <Link
                    href={`/admin/services/${s.id}/edit`}
                    className="text-xs text-gold-600 underline-offset-4 hover:underline"
                  >
                    {t('edit')}
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardBody className="overflow-x-auto p-0">
              {s.priceRules.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No adjustments — guests pay exactly the base price.
                </p>
              ) : (
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-start">Rule</th>
                      <th className="px-4 py-3 text-end">Amount</th>
                      <th className="px-4 py-3 text-end">Weekdays</th>
                      <th className="px-4 py-3 text-end">Priority</th>
                      <th className="px-4 py-3 text-end">{t('active')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {s.priceRules.map((r) => {
                      const info = RULE_INFO[r.kind];
                      // A rule only changes the price when it is BOTH active and a
                      // kind the engine still honours (FLAT is retired).
                      const applied = r.isActive && (info?.applied ?? true);
                      return (
                        <tr key={r.id} className={applied ? undefined : 'opacity-60'}>
                          <td className="px-4 py-3">
                            <span className="text-foreground">{info?.label ?? r.kind}</span>
                            {info?.note && (
                              <span className="block text-xs text-muted-foreground">{info.note}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-end tabular-nums">
                            {formatMoney(r.amountCents, { locale, currency: 'EGP' })}
                          </td>
                          <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">
                            {r.weekdayMask ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-end tabular-nums">{r.priority}</td>
                          <td className="px-4 py-3 text-end">
                            {applied ? (
                              <Badge tone="success">{t('active')}</Badge>
                            ) : (
                              <Badge tone="muted">
                                {r.isActive ? 'Ignored' : t('inactive')}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
