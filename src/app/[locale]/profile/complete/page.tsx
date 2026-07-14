import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { PageTransition } from '@/components/layout/PageTransition';
import { ProfileForm } from './ProfileForm';
import { ExitButton } from './ExitButton';
import { requireUser } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}

export default async function CompleteProfilePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const { next } = await searchParams;

  // Require auth, then hydrate any existing values.
  const sessionUser = await requireUser({ next: `/profile/complete` });
  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      name: true,
      phone: true,
      email: true,
      profile: {
        select: {
          countryCode: true,
          age: true,
          nationalId: true,
          passportId: true,
          region: true,
        },
      },
    },
  });

  const profile = dbUser?.profile;
  const initialIdType: 'national' | 'passport' = profile?.passportId ? 'passport' : 'national';
  const initialIdNumber = profile?.passportId ?? profile?.nationalId ?? undefined;

  const t = await getTranslations('auth.profile');

  return (
    <PageTransition className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-background px-5 py-12">
      {/* Champagne haze high on the canvas — theme-aware via the gold token. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(55%_60%_at_50%_0%,rgb(var(--ci-gold)/0.09),transparent_70%)]"
      />

      {/* Escape hatch — pinned top-start. Cancels sign-in / leaves onboarding and
          goes to the main page (signs out, so the bounce-back gate no longer
          applies). */}
      <div className="absolute start-4 top-4 z-10 sm:start-6 sm:top-6">
        <ExitButton />
      </div>

      <div className="w-full max-w-md lg:max-w-3xl">
        <div className="flex justify-center">
          {/* Theme-aware wordmark (see globals.css .logo-*-variant). */}
          <CrownLogo size="md" className="logo-light-variant" />
          <CrownLogo size="md" light className="logo-dark-variant" />
        </div>

        {/* Card panel with a hairline gold crest. Wider on desktop. */}
        <div className="mt-9 rounded-2xl border border-border bg-card p-7 shadow-[0_24px_70px_-30px_rgba(22,41,75,0.28)] sm:p-8 lg:p-10">
          <div
            aria-hidden
            className="mx-auto mb-6 h-px w-16 bg-gradient-to-r from-transparent via-gold-400/70 to-transparent"
          />
          <div className="space-y-1.5 text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight text-gold-adaptive">
              {t('completeTitle')}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t('completeSubtitle')}
            </p>
          </div>

          <div className="mt-7">
            <ProfileForm
              initialName={dbUser?.name ?? undefined}
              initialPhone={dbUser?.phone ?? undefined}
              initialEmail={dbUser?.email ?? undefined}
              initialCountryCode={profile?.countryCode ?? undefined}
              initialAge={profile?.age ?? undefined}
              initialIdType={initialIdType}
              initialIdNumber={initialIdNumber}
              initialRegion={profile?.region ?? undefined}
              next={next}
            />
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
