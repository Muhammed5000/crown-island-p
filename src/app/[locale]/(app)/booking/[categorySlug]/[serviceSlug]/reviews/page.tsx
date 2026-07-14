import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TopNav } from '@/components/layout/TopNav';
import { PageTransition } from '@/components/layout/PageTransition';
import { Card, CardBody } from '@/components/ui/Card';
import { RatingStars } from '@/components/ui/RatingStars';
import { Pagination } from '@/components/ui/Pagination';
import { getServiceBySlug } from '@/server/repositories/catalog';
import { getServiceRatingSummary, listPublicReviews } from '@/server/services/review';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; categorySlug: string; serviceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Public "all reviews" page for a single service — the full paginated list behind
 * the preview card on the service page (`PublicServiceReviews`). Deliberately
 * NOT age/terms/bookings gated: guest reviews are public social proof, so any
 * visitor can read them. Hidden (`notFound`) only when the service is missing /
 * inactive or the public-reviews master toggle is off.
 */
export default async function ServiceReviewsPage({ params, searchParams }: Props) {
  const { locale, categorySlug, serviceSlug } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const service = await getServiceBySlug(categorySlug, serviceSlug);
  if (!service) notFound();

  const summary = await getServiceRatingSummary(service.id);
  if (!summary.enabled) notFound();

  const sp = await searchParams;
  const page = Math.max(1, parseInt(str(sp.page) ?? '1', 10) || 1);
  const list = await listPublicReviews(service.id, page);

  const t = await getTranslations('reviews');
  const serviceName = locale === 'ar' ? service.nameAr : service.nameEn;

  return (
    <PageTransition>
      <TopNav title={t('publicHeading')} locale={locale} />
      <div className="mx-auto max-w-md px-5 pb-10 md:max-w-xl">
        <Card className="mt-2">
          <CardBody className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base text-gold-700">{serviceName}</h2>
              <p className="text-xs text-muted-foreground">
                {t('reviewsCount', { count: summary.count })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <RatingStars value={Math.round(summary.average)} readOnly size={16} />
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {summary.average.toFixed(1)}
              </span>
            </div>
          </CardBody>
        </Card>

        {list.items.length === 0 ? (
          <p className="mt-8 text-center text-sm text-muted-foreground">{t('publicEmpty')}</p>
        ) : (
          <Card className="mt-4">
            <CardBody className="space-y-4">
              {list.items.map((r) => (
                <div
                  key={r.id}
                  className="space-y-1 border-b border-border/30 pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{r.reviewer}</span>
                    <RatingStars value={r.rating} readOnly size={14} />
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.comment}</p>
                  <p className="text-[11px] text-muted-foreground/70">
                    {formatDate(r.createdAt, locale)}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
        )}

        <Pagination
          currentPage={list.page}
          totalPages={list.totalPages}
          baseUrl={`/booking/${categorySlug}/${serviceSlug}/reviews`}
          searchParams={sp}
        />
      </div>
    </PageTransition>
  );
}
