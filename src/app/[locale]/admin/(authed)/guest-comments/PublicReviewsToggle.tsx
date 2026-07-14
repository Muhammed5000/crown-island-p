'use client';

import { useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { setPublicReviewsEnabledAction } from '@/features/admin/reviews-actions';

/** Master switch: show/hide approved reviews on customer-facing pages. */
export function PublicReviewsToggle({ enabled }: { enabled: boolean }) {
  const t = useTranslations('adminReviews');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      const res = await setPublicReviewsEnabledAction({ enabled: !enabled });
      if (res.ok) router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={enabled}
      className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
        enabled
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
          : 'border-border/60 text-muted-foreground hover:bg-muted/50'
      }`}
      title={t('publicToggleHint')}
    >
      <span className={`size-2.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
      {enabled ? t('publicOn') : t('publicOff')}
    </button>
  );
}
