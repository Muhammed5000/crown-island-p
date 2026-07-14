import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { ChevronLeftIcon, CheckCircle2Icon, AlertTriangleIcon } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { isLocale } from '@/i18n/config';
import { verifyEmailToken } from '@/features/auth/actions';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

/**
 * Magic link landing page.
 *
 * The user clicks the link in their inbox, lands here, and we immediately
 * consume the token. Three outcomes:
 *
 *  - new email, token valid → forward to /auth/complete-registration?email=…
 *  - existing email, token valid → tell them "you already have an account,
 *    sign in with your password"
 *  - token invalid / expired → show a clear error + a "request new link" CTA
 *
 * We consume the token server-side on first page render so refreshing the
 * page (or sharing the URL) can't re-validate it.
 */
export default async function VerifyEmailPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const { token } = await searchParams;
  const t = await getTranslations('auth');

  const result = token ? await verifyEmailToken(token) : { ok: false as const, code: 'invalid_or_expired' as const };

  // New user — bounce straight into the registration flow, carrying BOTH the
  // email and the raw token. The token (not just the email) is required to
  // complete registration: `registerCustomer` claims it atomically as the
  // inbox-possession proof (AUTH-001). `token` is defined here because a
  // successful `verifyEmailToken` implies it was present.
  if (result.ok && result.status === 'new_user') {
    redirect({
      href: `/auth/complete-registration?email=${encodeURIComponent(result.email)}&token=${encodeURIComponent(token as string)}`,
      locale,
    });
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_55%_at_50%_-5%,rgba(194,161,78,0.12),rgba(194,161,78,0)_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-topo-lines bg-[length:600px_600px] bg-center opacity-25 [mask-image:radial-gradient(circle,black_25%,transparent_70%)]"
      />

      <Card variant="glass" className="relative w-full max-w-md">
        <CardBody className="space-y-5 px-6 py-9 text-center">
          <div className="halo-gold flex justify-center">
            <CrownLogo size="md" />
          </div>

          {result.ok && result.status === 'existing_user' ? (
            <>
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-gold-400/15 text-gold-600 ring-1 ring-gold-400/30">
                <CheckCircle2Icon className="size-7" strokeWidth={1.75} />
              </div>
              <div className="space-y-2">
                <span className="ornament text-[10px] uppercase tracking-[0.4em] text-gold-700">
                  {t('verifySuccess')}
                </span>
                <h1 className="font-display text-2xl font-bold text-gold-700">
                  {t('verifySuccess')}
                </h1>
                <p className="text-sm text-muted-foreground">{t('verifyExisting')}</p>
              </div>
              <Link
                href="/login"
                className="gleam inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-gold-button px-6 text-[12px] font-bold uppercase tracking-[0.18em] text-ink shadow-gold-lg transition-all hover:-translate-y-px"
              >
                {t('signIn')}
              </Link>
            </>
          ) : (
            <>
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-red-500/12 text-red-600 ring-1 ring-red-500/30">
                <AlertTriangleIcon className="size-7" strokeWidth={1.75} />
              </div>
              <div className="space-y-2">
                <span className="ornament text-[10px] uppercase tracking-[0.4em] text-red-600/80">
                  {t('verifyTitle')}
                </span>
                <h1 className="font-display text-2xl font-bold text-foreground">{t('verifyTitle')}</h1>
                <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                  {t('invalidOrExpired')}
                </p>
              </div>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-gold-400/40 bg-transparent px-6 text-[12px] font-bold uppercase tracking-[0.18em] text-gold-700 transition-all hover:border-gold-500 hover:bg-gold-400/10"
              >
                <ChevronLeftIcon className="size-4 rtl:rotate-180" />
                <span>{t('signIn')}</span>
              </Link>
            </>
          )}
        </CardBody>
      </Card>
    </main>
  );
}
