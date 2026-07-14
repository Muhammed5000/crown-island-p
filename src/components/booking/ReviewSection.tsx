import { getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { RatingStars } from '@/components/ui/RatingStars';
import { ReviewForm } from './ReviewForm';

export interface MyReview {
  rating: number;
  comment: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  adminNote: string | null;
}

/**
 * The "Rate your visit" area on the booking detail page. Renders the form when
 * the visit is reviewable, the submitted review + its moderation status once
 * left, or nothing at all otherwise.
 */
export async function ReviewSection({
  bookingId,
  canReview,
  review,
}: {
  bookingId: string;
  canReview: boolean;
  review: MyReview | null;
}) {
  if (!review && !canReview) return null;
  const t = await getTranslations('reviews');

  return (
    <Card className="mb-4">
      <CardHeader>
        <h2 className="font-display text-base text-gold-700">
          {review ? t('yourReview') : t('rateYourVisit')}
        </h2>
      </CardHeader>
      <CardBody className="space-y-3">
        {review ? (
          <>
            <RatingStars value={review.rating} readOnly size={22} />
            <p className="whitespace-pre-wrap text-sm text-foreground">{review.comment}</p>
            {review.status === 'APPROVED' ? (
              <Badge tone="success">{t('statusApproved')}</Badge>
            ) : review.status === 'REJECTED' ? (
              <div className="space-y-1">
                <Badge tone="danger">{t('statusRejected')}</Badge>
                {review.adminNote ? (
                  <p className="text-xs text-muted-foreground">{review.adminNote}</p>
                ) : null}
              </div>
            ) : (
              <Badge tone="muted">{t('statusPending')}</Badge>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('prompt')}</p>
            <ReviewForm bookingId={bookingId} />
          </>
        )}
      </CardBody>
    </Card>
  );
}
