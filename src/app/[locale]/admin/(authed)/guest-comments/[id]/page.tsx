import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { ReviewStatus } from '@prisma/client';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { RatingStars } from '@/components/ui/RatingStars';
import { ModerationForm } from '../ModerationForm';
import { getAdminReview } from '@/server/services/review';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

const STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  PENDING: 'muted',
  APPROVED: 'success',
  REJECTED: 'danger',
};

export default async function GuestCommentDetailPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const review = await getAdminReview(id);
  if (!review) notFound();

  const t = await getTranslations('adminReviews');
  const ar = locale === 'ar';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/admin/guest-comments" className="text-sm text-accent">
        ← {t('backToList')}
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl text-gold-700">
                {review.user.name || review.user.email || '—'}
              </h1>
              <p className="truncate text-xs text-muted-foreground">{review.user.email}</p>
            </div>
            <Badge tone={STATUS_TONE[review.status]}>{t(`status${review.status}`)}</Badge>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3">
            <RatingStars value={review.rating} readOnly size={22} />
            <span className="text-sm text-muted-foreground">{formatDate(review.createdAt, locale)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground">{review.comment}</p>
          <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/30 p-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t('category')}</dt>
              <dd className="text-foreground">
                {ar ? review.service.category.nameAr : review.service.category.nameEn}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('service')}</dt>
              <dd className="text-foreground">{ar ? review.service.nameAr : review.service.nameEn}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('booking')}</dt>
              <dd>
                <Link href={`/admin/bookings/${review.booking.id}`} className="text-accent">
                  {review.booking.reference}
                </Link>
              </dd>
            </div>
          </dl>
          {review.adminNote ? (
            <p className="rounded-xl border border-border/40 bg-background/40 p-3 text-xs text-muted-foreground">
              <span className="font-semibold">{t('adminNote')}:</span> {review.adminNote}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('moderate')}</h2>
        </CardHeader>
        <CardBody>
          <ModerationForm reviewId={review.id} status={review.status} />
        </CardBody>
      </Card>
    </div>
  );
}
