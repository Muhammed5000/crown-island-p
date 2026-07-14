'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { moderateReviewAction } from '@/features/admin/reviews-actions';

/** Approve / reject a review with an optional note (sent to the customer). */
export function ModerationForm({
  reviewId,
  status,
}: {
  reviewId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}) {
  const t = useTranslations('adminReviews');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const decide = (decision: 'APPROVED' | 'REJECTED') => {
    setError(null);
    startTransition(async () => {
      const res = await moderateReviewAction({
        reviewId,
        status: decision,
        adminNote: note.trim() || undefined,
      });
      if (res.ok) router.refresh();
      else setError(t('errorGeneric'));
    });
  };

  return (
    <div className="space-y-3">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        rows={3}
        maxLength={500}
        placeholder={t('notePlaceholder')}
        className="w-full resize-none rounded-2xl border border-border/50 bg-background/60 p-3 text-sm text-foreground outline-none transition-colors focus:border-gold-400"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => decide('APPROVED')}
          disabled={pending || status === 'APPROVED'}
          className="rounded-2xl bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t('approve')}
        </button>
        <button
          type="button"
          onClick={() => decide('REJECTED')}
          disabled={pending || status === 'REJECTED'}
          className="rounded-2xl bg-red-600 px-4 py-2.5 font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t('reject')}
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
