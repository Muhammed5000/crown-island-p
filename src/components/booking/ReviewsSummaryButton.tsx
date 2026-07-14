import { getTranslations } from 'next-intl/server';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { RatingStars } from '@/components/ui/RatingStars';
import { getServiceRatingSummary } from '@/server/services/review';

/**
 * Prominent, tappable "jump to reviews" bar shown near the TOP of the service
 * page — the average rating + count, linking to the full reviews list so guests
 * don't have to scroll to the bottom preview card to find it. Renders nothing
 * when the public-reviews master toggle is off or there are no approved reviews.
 */
export async function ReviewsSummaryButton({
  serviceId,
  reviewsHref,
  locale,
}: {
  serviceId: string;
  reviewsHref: string;
  locale: 'ar' | 'en';
}) {
  const summary = await getServiceRatingSummary(serviceId);
  if (!summary.enabled || summary.count === 0) return null;

  const t = await getTranslations('reviews');
  // "Forward" chevron in reading direction: points left under RTL (ar).
  const Chevron = locale === 'ar' ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <Link
      href={reviewsHref}
      className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-3 transition-colors hover:bg-muted/50"
      aria-label={t('seeAll')}
    >
      <span className="flex items-center gap-2">
        <RatingStars value={Math.round(summary.average)} readOnly size={16} />
        <span className="text-sm font-bold tabular-nums text-foreground">
          {summary.average.toFixed(1)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t('reviewsCount', { count: summary.count })}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-accent">
        {t('seeAll')}
        <Chevron className="size-4" aria-hidden />
      </span>
    </Link>
  );
}
