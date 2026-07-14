import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeftIcon } from 'lucide-react';
import { redirect, Link } from '@/i18n/navigation';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { LoginForm } from './LoginForm';
import { getSessionUser } from '@/server/auth/guards';
import { activeProviderIds } from '@/server/auth/providers';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { isLocale } from '@/i18n/config';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signIn') };
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    next?: string;
    callbackUrl?: string;
    /**
     * Set by Auth.js when an OAuth flow fails (see `authConfig.pages.error`).
     * Known codes worth surfacing:
     *   - `Configuration` — bad client_id / secret, or redirect-uri mismatch
     *      in the provider's console.
     *   - `AccessDenied` — user denied consent.
     *   - `Verification` — magic-link / email token invalid or expired.
     *   - `OAuthSignin` / `OAuthCallback` — network or signature failure.
     * Anything else falls through to a generic message.
     */
    error?: string;
  }>;
}

const AUTH_ERROR_KEYS: Record<string, string> = {
  Configuration: 'errorConfiguration',
  AccessDenied: 'errorAccessDenied',
  Verification: 'errorVerification',
  OAuthSignin: 'errorOAuth',
  OAuthCallback: 'errorOAuth',
  OAuthCreateAccount: 'errorOAuth',
  OAuthAccountNotLinked: 'errorOAuthLinking',
};

/**
 * Decide the safe post-login destination.
 * Accepts BOTH `?next=` (our own) and `?callbackUrl=` (NextAuth default) so
 * proxy-triggered redirects don't lose the original destination.
 *
 * Only same-origin paths starting with `/` are honoured; absolute URLs are
 * dropped to avoid open-redirect.
 */
function resolveNext(next?: string, callbackUrl?: string): string | undefined {
  // Reject open-redirect shapes (`//evil`, `/\evil`, schemes) before use.
  const safe = safeRedirectPath(next || callbackUrl);
  if (!safe) return undefined;
  // Strip locale prefix so the i18n router accepts the path.
  return safe.replace(/^\/(?:ar|en)(?=\/|$)/, '') || '/';
}

/**
 * Login — Screen 02 from the design handoff.
 *
 *  - Logo at top
 *  - "Sign in or create account" line
 *  - Social providers in order: Google → Facebook → Apple
 *  - "or" divider
 *  - Phone (gold-outlined) button
 *  - Terms text at the bottom
 */
export default async function LoginPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const next = resolveNext(sp.next, sp.callbackUrl);

  const user = await getSessionUser();
  if (user) {
    redirect({ href: next || '/booking', locale });
  }

  const t = await getTranslations('auth');
  const tProfile = await getTranslations('auth.profile');
  const active = activeProviderIds();

  // Look up a translation key for the Auth.js error code. Unknown codes fall
  // back to a generic message so we never render the raw `Configuration` /
  // `OAuthSignin` token to a customer.
  const errorMessage = (() => {
    if (!sp.error) return null;
    const key = AUTH_ERROR_KEYS[sp.error] ?? 'errorGeneric';
    try {
      return t(key);
    } catch {
      return t('errorGeneric');
    }
  })();

  // In development the literal error code is far more useful than a friendly
  // message — surface it so the dev sees "Configuration" / "OAuthCallback" /
  // etc. directly and can act on it. Production users only see the polished
  // copy above; raw codes never reach a real customer.
  const devErrorCode =
    process.env.NODE_ENV !== 'production' && sp.error ? sp.error : null;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background">
      {/* Midnight Ocean atmosphere — one soft champagne breath, obsidian foot. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-[55%] bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(194,161,78,0.10),transparent_62%)]" />
        {/* Soft tonal foot — theme-aware so it reads as a light floor in
            Seaside Daylight and an obsidian floor in Midnight Ocean (was a
            hardcoded light #eef2f4 that painted a grey band over dark mode). */}
        <div className="absolute inset-x-0 bottom-0 h-[42%] bg-[linear-gradient(to_top,rgb(var(--ci-muted)),transparent)]" />
      </div>

      {/* Back to the main page — guests can browse the catalog without signing in. */}
      <Link
        href="/"
        className="absolute start-4 top-4 z-20 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:start-6 sm:top-6"
      >
        <ArrowLeftIcon className="size-4 rtl:-scale-x-100" strokeWidth={2} aria-hidden />
        {tProfile('backHome')}
      </Link>

      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-7 pt-12">
        <div className="reveal mt-8 flex justify-center" style={{ animationDelay: '0.05s' }}>
          <CrownLogo size="lg" />
        </div>

        <p
          className="reveal my-10 text-center font-display text-lg font-light tracking-tight text-foreground/90"
          style={{ animationDelay: '0.14s' }}
        >
          {t('signInSubtitle')}
        </p>

        {errorMessage ? (
          <div
            role="alert"
            className="mb-6 space-y-1 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-center text-sm text-danger"
          >
            <p>{errorMessage}</p>
            {devErrorCode ? (
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-danger/80">
                {devErrorCode}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="reveal" style={{ animationDelay: '0.22s' }}>
          <LoginForm
            enabledProviders={{
              google: active.has('google'),
              facebook: active.has('facebook'),
              apple: active.has('apple'),
            }}
            next={next}
          />
        </div>

        <p
          className="reveal mx-auto mt-auto max-w-xs pb-8 pt-6 text-center text-[11px] leading-relaxed text-muted-foreground"
          style={{ animationDelay: '0.34s' }}
        >
          {t.rich('termsNotice', {
            privacy: (chunks) => (
              <Link
                href="/privacy-policy"
                className="font-semibold text-foreground underline decoration-gold-400/50 underline-offset-2 transition-colors hover:text-gold-700"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </main>
  );
}
