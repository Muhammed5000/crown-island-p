import { setRequestLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { PageTransition } from '@/components/layout/PageTransition';
import { CompleteRegistrationForm } from './CompleteRegistrationForm';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string; token?: string }>;
}

export default async function CompleteRegistrationPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const { email: emailParam, token: tokenParam } = await searchParams;

  // If they arrived without an email OR the verification token, something went
  // wrong upstream (or someone hit this page directly) — start them over at the
  // verify step. The token is required: registration completion claims it as the
  // inbox-possession proof (AUTH-001). `redirect()` throws internally but its
  // declared return type doesn't tell TS that, hence the explicit assertion.
  if (!emailParam || !tokenParam) {
    redirect({ href: '/login', locale });
  }
  const email = emailParam as string;
  const token = tokenParam as string;

  const t = await getTranslations('auth');

  return (
    <PageTransition className="relative isolate min-h-dvh overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_55%_at_50%_-5%,rgba(194,161,78,0.12),rgba(194,161,78,0)_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-32 -z-0 mx-auto h-[600px] max-w-3xl bg-topo-lines bg-[length:600px_600px] bg-center opacity-25 [mask-image:radial-gradient(circle,black_25%,transparent_70%)]"
      />

      <div className="relative mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-12 pt-14">
        <div className="halo-gold flex justify-center">
          <CrownLogo size="md" />
        </div>

        <Card variant="glass" className="mt-8">
          <CardBody className="space-y-5 px-6 py-7">
            <div className="space-y-1 text-center">
              <span className="ornament text-[10px] uppercase tracking-[0.4em] text-gold-700">
                {t('verifySuccess')}
              </span>
              <h1 className="mt-2 font-display text-2xl font-bold text-gold-700">
                {t('completeRegTitle')}
              </h1>
              <p className="text-sm text-muted-foreground">{t('completeRegSubtitle')}</p>
              <p dir="ltr" className="pt-2 font-display text-sm tracking-[0.06em] text-gold-600">
                {email}
              </p>
            </div>

            <CompleteRegistrationForm email={email} token={token} />
          </CardBody>
        </Card>
      </div>
    </PageTransition>
  );
}
