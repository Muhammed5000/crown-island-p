'use client';

import { useState, useRef, useTransition, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { cn } from '@/lib/cn';

interface Props {
  /** The full policy document text (plain text, one point per line). */
  document: string;
  /**
   * The next-intl namespace holding the gate copy (eyebrow, gateTitle,
   * gateInstruction, readingProgress, endOfDocument, scrollHint, readyHint,
   * checkboxLabel). Both `terms` and `refundPolicy` provide the same keys.
   */
  namespace: string;
  /** Records acceptance and returns where to send the user next. */
  acceptAction: () => Promise<{ ok: boolean; redirectTo?: string }>;
}

/**
 * Generic policy-acceptance gate — the "Crown Terms Desktop" redesign, reused
 * for every full-screen policy the user must accept before entering (Terms &
 * Conditions, Refund Policy, …).
 *
 * Desktop: a two-panel layout — a left context rail (brand, heading, live
 * reading-progress) beside the scrollable document and a sticky acceptance bar.
 * Mobile: the rail collapses to a compact header on top, the document fills the
 * remaining height, and the acceptance bar stacks at the bottom.
 *
 * The core mechanic: the visitor must scroll to the end of the document → the
 * checkbox enables → Continue enables → `acceptAction`.
 */
export function PolicyGate({ document, namespace, acceptAction }: Props) {
  const t = useTranslations(namespace);
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [progress, setProgress] = useState(0); // 0..1
  const [atBottom, setAtBottom] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // If the document is short enough that it doesn't need scrolling, or already
  // at the end, unlock acceptance immediately (preserves prior behaviour).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight + 10 || scrollTop + clientHeight >= scrollHeight - 20) {
        setAtBottom(true);
        setProgress(1);
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [document]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const p = max > 0 ? el.scrollTop / max : 1;
    setProgress(Math.min(1, p));
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20 || p > 0.985) setAtBottom(true);
  };

  function handleAccept() {
    if (!accepted || !atBottom) return;
    setSubmitError(false);
    startTransition(async () => {
      try {
        const res = await acceptAction();
        if (res.ok) {
          // Customers who still need to finish onboarding land on
          // `/profile/complete`; everyone else gets routed by role from the
          // destination the action returns.
          router.push(res.redirectTo ?? '/');
          router.refresh();
        } else {
          // e.g. session expired between page load and submit.
          setSubmitError(true);
        }
      } catch {
        // Infra error (DB down) — surface a retry instead of a stuck button.
        setSubmitError(true);
      }
    });
  }

  // Every non-empty line is a point; strip any leading bullet/number.
  const points = document
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[•\-\d.]+\s*/, ''));

  const pct = Math.round(progress * 100);
  const ready = atBottom && accepted && !isPending;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground lg:flex-row">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_45%_at_30%_0%,rgba(194,161,78,0.09),transparent_60%)]"
      />

      {/* ── LEFT rail (desktop) / top header (mobile) ── */}
      <aside className="relative z-10 flex shrink-0 flex-col border-b border-border px-6 py-7 lg:w-[380px] lg:border-b-0 lg:border-e lg:px-10 lg:py-11">
        {/* App logo — both variants render; the global `.logo-*-variant` rules
            (globals.css) show the one matching the active `data-theme`, so the
            cream wordmark is used under the dark theme and the default under light. */}
        <div className="flex items-center">
          <CrownLogo size="md" className="logo-light-variant" />
          <CrownLogo size="md" light className="logo-dark-variant" />
        </div>

        <div className="mt-6 lg:mt-12">
          <div className="mb-2.5 font-aurelia-sans text-[11px] font-bold uppercase tracking-[0.26em] text-gold-600">
            {t('eyebrow')}
          </div>
          <h1 className="m-0 text-balance font-aurelia-display text-[28px] font-semibold leading-[1.05] tracking-[-0.01em] text-foreground sm:text-[40px] lg:text-[44px]">
            {t('gateTitle')}
          </h1>
          <p className="mt-3 max-w-[320px] font-aurelia-sans text-[14px] leading-[1.6] text-muted-foreground lg:mt-4 lg:text-[13.5px]">
            {t('gateInstruction')}
          </p>
        </div>

        {/* reading progress */}
        <div className="mt-7 lg:mt-10">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('readingProgress')}
            </span>
            <span
              className={cn(
                'font-aurelia-sans text-[12px] font-bold tabular-nums',
                atBottom ? 'text-[#2f9e63]' : 'text-gold-600',
              )}
            >
              {pct}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-[width,background-color] duration-150',
                atBottom ? 'bg-[#2f9e63]' : 'bg-gold-500',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p
            className={cn(
              'mt-3 hidden font-aurelia-sans text-[12px] lg:block',
              atBottom ? 'text-[#2f9e63]' : 'text-muted-foreground',
            )}
          >
            {atBottom ? t('readyHint') : t('scrollHint')}
          </p>
        </div>

        <div className="hidden flex-1 lg:block" />
      </aside>

      {/* ── RIGHT document + acceptance ── */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overscroll-contain touch-pan-y px-6 py-7 lg:px-14 lg:py-11"
        >
          <div className="mx-auto max-w-[720px]">
            {points.length === 0 ? (
              <p className="py-10 text-center font-aurelia-sans text-sm text-muted-foreground">
                {t('gateInstruction')}
              </p>
            ) : (
              <ol className="divide-y divide-border/60">
                {points.map((point, i) => (
                  <li key={i} className="flex gap-3.5 py-4 first:pt-0 sm:gap-4">
                    <span
                      aria-hidden
                      className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-gold-400/15 font-aurelia-sans text-[12px] font-bold tabular-nums text-gold-600 sm:size-7 sm:text-[12.5px]"
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 font-aurelia-sans text-[16px] leading-[1.7] text-foreground sm:text-[15px] lg:text-[14.5px]">
                      {point}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {/* end-of-document marker */}
            <div className="flex items-center justify-center gap-3 py-7">
              <span className="h-px w-10 bg-border" />
              <span className="font-aurelia-display text-[15px] text-muted-foreground">
                {t('endOfDocument')}
              </span>
              <span className="h-px w-10 bg-border" />
            </div>
          </div>
        </div>

        {/* sticky acceptance bar */}
        <div className="shrink-0 border-t border-border bg-[rgba(255,255,255,0.9)] px-6 py-4 backdrop-blur-xl lg:px-14">
          {submitError ? (
            <p
              role="alert"
              className="mx-auto mb-3 max-w-[720px] font-aurelia-sans text-[12px] font-semibold text-danger"
            >
              {tCommon('error')}
            </p>
          ) : null}
          <div className="mx-auto flex max-w-[720px] flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <button
              type="button"
              disabled={!atBottom}
              aria-pressed={accepted}
              onClick={() => atBottom && setAccepted((a) => !a)}
              className={cn(
                'flex flex-1 items-center gap-3.5 rounded-2xl border p-3.5 text-start transition',
                accepted
                  ? 'border-gold-500 bg-gold-400/[0.12]'
                  : 'border-border bg-muted',
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
                <div className="font-aurelia-sans text-[13.5px] font-semibold text-foreground">
                  {t('checkboxLabel')}
                </div>
                <div
                  className={cn(
                    'mt-0.5 font-aurelia-sans text-[12px]',
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
                'inline-flex h-[56px] shrink-0 items-center justify-center gap-2.5 rounded-[15px] px-9 font-aurelia-sans text-[15px] font-bold tracking-[0.02em] transition',
                ready
                  ? 'bg-gradient-to-b from-[#e8c87f] to-[#cba45f] text-navy-950 shadow-[0_12px_30px_rgba(194,161,78,0.28)] hover:brightness-105 active:scale-[0.98]'
                  : 'cursor-not-allowed bg-muted text-muted-foreground',
              )}
            >
              {isPending ? (
                '…'
              ) : (
                <>
                  {tCommon('continue')} <span className="text-[17px] rtl:rotate-180">→</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
