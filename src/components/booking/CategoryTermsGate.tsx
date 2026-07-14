'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { acceptCategoryTermsAction } from '@/features/booking/category-terms-actions';
import { CategoryLogo } from '@/components/brand/CategoryLogo';
import { cn } from '@/lib/cn';

interface Props {
  categoryId: string;
  categoryName: string;
  /** Locale-appropriate terms bullet points to display. */
  terms: string[];
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
}

/**
 * Per-category Terms & Conditions gate shown in place of a category's services
 * until a signed-in customer accepts. The visitor reads the terms (natural page
 * scroll — NO nested scroll container, which was unreliable on mobile and could
 * leave the accept checkbox permanently disabled), and a fixed bottom action bar
 * tracks reading progress and holds the accept + continue controls so they are
 * always reachable above the app's bottom nav.
 *
 * On a successful accept it refreshes the route; the server re-evaluates the gate
 * (acceptance is read uncached) and renders the services.
 */
export function CategoryTermsGate({
  categoryId,
  categoryName,
  terms,
  logoUrl,
  logoDarkUrl,
}: Props) {
  const t = useTranslations('categoryTerms');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [progress, setProgress] = useState(0); // 0..1
  const [atBottom, setAtBottom] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const termsRef = useRef<HTMLDivElement>(null);

  // Track how far the terms section has scrolled through the viewport using the
  // page scroll. Unlock acceptance once its end is reached (or it is shorter than
  // the viewport). The bottom ~150px is covered by the fixed action bar, so the
  // end must clear that zone to count as read.
  const recompute = useCallback(() => {
    const el = termsRef.current;
    if (!el) return;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const rect = el.getBoundingClientRect();
    const p = rect.height > 0 ? Math.min(1, Math.max(0, (vh - rect.top) / rect.height)) : 1;
    setProgress(p);
    if (p >= 0.985 || rect.bottom <= vh - 130) setAtBottom(true);
  }, []);

  useEffect(() => {
    recompute();
    window.addEventListener('scroll', recompute, { passive: true });
    window.addEventListener('resize', recompute);
    // Re-measure after layout settles (fonts/images/late reflow).
    const id = window.setTimeout(recompute, 120);
    return () => {
      window.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
      window.clearTimeout(id);
    };
  }, [recompute, terms]);

  function handleAccept() {
    if (!accepted || !atBottom || isPending) return;
    setError(false);
    startTransition(async () => {
      try {
        const res = await acceptCategoryTermsAction(categoryId);
        if (res.ok) {
          router.refresh();
        } else {
          // Session expired, or the category no longer carries terms.
          setError(true);
        }
      } catch {
        setError(true);
      }
    });
  }

  const pct = Math.round(progress * 100);
  const ready = atBottom && accepted && !isPending;

  return (
    <div className="container mx-auto max-w-2xl px-4 pb-52 pt-6 sm:pt-8">
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-[0_10px_40px_rgba(28,43,64,0.10)]">
        {/* Header */}
        <header className="border-b border-border px-5 py-6 sm:px-8 sm:py-7">
          {logoUrl ? (
            <CategoryLogo
              lightUrl={logoUrl}
              darkUrl={logoDarkUrl ?? undefined}
              className="mb-3 h-11 w-auto max-w-[130px] object-contain"
            />
          ) : null}
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-gold-600">
            {t('eyebrow')}
          </p>
          <h1 className="mt-2 text-balance font-display text-[26px] font-bold leading-tight tracking-tight text-foreground sm:text-3xl">
            {t('title')}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            {t('subtitle', { category: categoryName })}
          </p>
        </header>

        {/* Terms — inline; the page scrolls naturally (no nested scroll). */}
        <div ref={termsRef} className="px-5 py-5 sm:px-8">
          {terms.length === 0 ? (
            <p className="py-8 text-center text-[15px] text-muted-foreground">
              {t('subtitle', { category: categoryName })}
            </p>
          ) : (
            <ol className="divide-y divide-border/70">
              {terms.map((point, i) => (
                <li key={i} className="flex gap-3.5 py-3.5 first:pt-0">
                  <span
                    aria-hidden
                    className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-gold-400/15 text-[12px] font-bold tabular-nums text-gold-600"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-[15.5px] leading-[1.7] text-foreground sm:text-[14.5px]">
                    {point}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="flex items-center justify-center gap-3 pt-6">
            <span className="h-px w-8 bg-border" />
            <span className="font-display text-[13px] text-muted-foreground">{t('endOfDocument')}</span>
            <span className="h-px w-8 bg-border" />
          </div>
        </div>
      </div>

      {/* Fixed action bar — reading progress + accept + continue, always reachable
          above the app's bottom nav (and clear of the desktop rail). */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 xl:ps-[78px]">
        <div className="mx-auto max-w-2xl">
          <div className="space-y-3 rounded-2xl border border-border bg-card/95 p-3 shadow-[0_8px_34px_rgba(28,43,64,0.18)] backdrop-blur">
            {error ? (
              <p role="alert" className="text-[12px] font-semibold text-danger">
                {tCommon('error')}
              </p>
            ) : null}

            {/* reading progress */}
            <div className="flex items-center gap-2.5">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-[width,background-color] duration-150',
                    atBottom ? 'bg-[#2f9e63]' : 'bg-gold-500',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span
                className={cn(
                  'shrink-0 text-[11px] font-bold tabular-nums',
                  atBottom ? 'text-[#2f9e63]' : 'text-gold-600',
                )}
              >
                {atBottom ? '✓' : `${pct}%`}
              </span>
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled={!atBottom}
                aria-pressed={accepted}
                onClick={() => atBottom && setAccepted((a) => !a)}
                className={cn(
                  'flex flex-1 items-center gap-3 rounded-2xl border p-3 text-start transition',
                  accepted ? 'border-gold-500 bg-gold-400/[0.12]' : 'border-border bg-card',
                  !atBottom && 'cursor-not-allowed opacity-55',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-[7px] border-[1.6px] text-[14px] font-bold',
                    accepted
                      ? 'border-gold-500 bg-gold-400 text-navy-950'
                      : 'border-muted-foreground/40 text-transparent',
                  )}
                >
                  ✓
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold leading-tight text-foreground">
                    {t('checkboxLabel')}
                  </div>
                  <div
                    className={cn(
                      'mt-0.5 text-[11.5px] leading-tight',
                      atBottom ? 'text-[#2f9e63]' : 'text-muted-foreground',
                    )}
                  >
                    {atBottom ? t('readyHint') : t('scrollHint')}
                  </div>
                </div>
              </button>

              <button
                type="button"
                disabled={!ready}
                onClick={handleAccept}
                className={cn(
                  'inline-flex h-[52px] w-full shrink-0 items-center justify-center gap-2.5 rounded-[14px] px-8 text-[15px] font-bold tracking-[0.02em] transition sm:w-auto',
                  ready
                    ? 'bg-gradient-to-b from-[#e8c87f] to-[#cba45f] text-navy-950 shadow-[0_12px_30px_rgba(194,161,78,0.28)] hover:brightness-105 active:scale-[0.98]'
                    : 'cursor-not-allowed bg-muted text-muted-foreground',
                )}
              >
                {isPending ? (
                  '…'
                ) : (
                  <>
                    {t('accept')} <span className="text-[17px] rtl:rotate-180">→</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
