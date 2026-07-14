import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PageTransition } from '@/components/layout/PageTransition';

interface Props {
  /** The minimum age required to enter the category. */
  minAge: number;
  /** Whether the visitor is signed in (drives sign-in vs update-profile CTA). */
  signedIn: boolean;
}

/**
 * Full-page "this category is age-restricted" panel.
 *
 * Rendered in place of a category's services / a service detail page when the
 * current visitor doesn't meet the category's minimum-age requirement. Guests
 * are nudged to sign in; signed-in users who don't qualify are pointed at their
 * profile to correct their age if it's wrong.
 */
export async function AgeRestricted({ minAge, signedIn }: Props) {
  const t = await getTranslations('ageGate');

  return (
    <PageTransition>
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-16 text-center">
        <div
          aria-hidden
          className="flex size-20 items-center justify-center rounded-full border border-gold-400/30 bg-gold-400/15 font-display text-2xl font-bold text-gold-700"
        >
          {minAge}+
        </div>

        <h1 className="mt-6 font-display text-2xl font-bold text-foreground">
          {t('restrictedTitle')}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t('restrictedBody', { minAge })}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground/80">
          {signedIn ? t('updateAgePrompt') : t('signInPrompt')}
        </p>

        <div className="mt-8 flex w-full flex-col items-center gap-3">
          {signedIn ? (
            <Link
              href="/settings"
              className="inline-flex h-12 min-w-[200px] items-center justify-center rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-navy transition-all hover:-translate-y-px"
            >
              {t('updateProfile')}
            </Link>
          ) : (
            <Link
              href="/login"
              className="inline-flex h-12 min-w-[200px] items-center justify-center rounded-xl bg-primary px-6 text-sm font-bold text-primary-foreground shadow-navy transition-all hover:-translate-y-px"
            >
              {t('signIn')}
            </Link>
          )}
          <Link
            href="/booking"
            className="text-[13px] font-semibold text-accent underline-offset-4 transition-colors hover:text-accent/80 hover:underline"
          >
            {t('back')}
          </Link>
        </div>
      </div>
    </PageTransition>
  );
}
