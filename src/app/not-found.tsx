'use client';

import { useRouter } from 'next/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';

/**
 * Global fallback Not Found page.
 *
 * Rendered for requests that never reach the `[locale]` segment (e.g. a path the
 * i18n proxy doesn't rewrite). It lives at the app root, *outside* the
 * `I18nProvider`, so it can't use next-intl's client hooks or the localized
 * `<Link>`. We therefore keep it self-contained: text is hard-coded in Arabic
 * (the app's default locale — the root layout already sets `<html dir="rtl">`),
 * and the "go back" action uses Next's own router rather than the localized one.
 * Most invalid URLs are caught earlier by `app/[locale]/[...rest]/page.tsx` and
 * shown the locale-aware not-found page.
 */
export default function NotFound() {
  const router = useRouter();

  function goBack() {
    // Return one step back when there's history to pop; otherwise fall home.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <Card variant="glass" className="w-full max-w-md">
        <CardBody className="flex flex-col items-center gap-8 py-16 text-center">
          <ErrorIllustration type="not-found" />

          <div className="space-y-2">
            <h1 className="font-display text-4xl font-black text-gradient-gold">404</h1>
            <p className="text-muted-foreground uppercase tracking-[0.2em] text-xs font-bold">
              الصفحة غير موجودة
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              الصفحة التي تبحث عنها قد أبحرت بعيدًا أو لم تكن موجودة في هذا الأرخبيل.
            </p>
          </div>

          <button
            type="button"
            onClick={goBack}
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 px-10 text-sm font-black uppercase tracking-widest text-navy-950 shadow-gold transition-all hover:brightness-110 active:scale-95"
          >
            العودة للخلف
          </button>
        </CardBody>
      </Card>
    </div>
  );
}
