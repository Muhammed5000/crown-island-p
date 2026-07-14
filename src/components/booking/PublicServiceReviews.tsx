import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { RatingStars } from '@/components/ui/RatingStars';
import { getServiceRatingSummary, listPublicReviews } from '@/server/services/review';

/**
 * Public guest reviews for a service — average rating + the latest approved
 * comments. Renders nothing when the admin master toggle is off
 * (`Settings.publicReviewsEnabled`) or when there are no approved reviews yet.
 *
 * Pass `reviewsHref` to surface a "see all reviews" link to the full paginated
 * list page (`/booking/<cat>/<svc>/reviews`).
 */
export async function PublicServiceReviews({
  serviceId,
  reviewsHref,
}: {
  serviceId: string;
  reviewsHref?: string;
}) {
  const [summary, list] = await Promise.all([
    getServiceRatingSummary(serviceId),
    listPublicReviews(serviceId, 1),
  ]);
  if (!summary.enabled || summary.count === 0) return null;

  const t = await getTranslations('reviews');

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base text-gold-700">{t('publicHeading')}</h2>
          <div className="flex items-center gap-2">
            <RatingStars value={Math.round(summary.average)} readOnly size={16} />
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {summary.average.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('reviewsCount', { count: summary.count })}
            </span>
          </div>
        </div>
      </CardHeader>
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
          </div>
        ))}
        {reviewsHref ? (
          <Link
            href={reviewsHref}
            className="block pt-1 text-center text-sm font-semibold text-accent underline-offset-4 hover:underline"
          >
            {t('seeAll')}
          </Link>
        ) : null}
      </CardBody>
    </Card>
  );
}
