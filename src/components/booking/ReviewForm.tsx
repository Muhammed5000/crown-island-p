'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { RatingStars } from '@/components/ui/RatingStars';
import { submitReview } from '@/features/review/actions';

const MAX_COMMENT = 500;

/**
 * Post-visit review form — interactive star rating + comment. Uses
 * onSubmit + useTransition with controlled inputs (NOT `<form action>` with
 * uncontrolled fields) so validation errors don't wipe what the guest typed.
 */
export function ReviewForm({ bookingId }: { bookingId: string }) {
  const t = useTranslations('reviews');
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (rating < 1) {
      setError(t('errorRating'));
      return;
    }
    if (comment.trim().length < 1) {
      setError(t('errorComment'));
      return;
    }
    startTransition(async () => {
      const res = await submitReview({ bookingId, rating, comment: comment.trim() });
      if (res.ok) {
        router.refresh(); // re-render the detail page → shows the submitted review
      } else {
        setError(t('errorGeneric'));
      }
    });
  };

  return (
    <div className="space-y-3">
      <RatingStars value={rating} onChange={setRating} size={30} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
        rows={4}
        maxLength={MAX_COMMENT}
        placeholder={t('placeholder')}
        className="w-full resize-none rounded-2xl border border-border/50 bg-background/60 p-3 text-sm text-foreground outline-none transition-colors focus:border-gold-400"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {comment.length}/{MAX_COMMENT}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-2xl bg-primary px-5 py-2.5 font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? t('submitting') : t('submit')}
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
