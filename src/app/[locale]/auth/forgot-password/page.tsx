import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ChevronLeftIcon } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { PageTransition } from '@/components/layout/PageTransition';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

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
                {t('forgotPassword')}
              </span>
              <h1 className="mt-2 font-display text-2xl font-bold text-gold-700">
                {t('forgotTitle')}
              </h1>
              <p className="text-sm text-muted-foreground">{t('forgotSubtitle')}</p>
            </div>

            <ForgotPasswordForm />

            <div className="border-t border-gold-400/25 pt-4 text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-gold-600 transition-colors hover:text-gold-700"
              >
                <ChevronLeftIcon className="size-3.5 rtl:rotate-180" />
                <span>{t('signIn')}</span>
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </PageTransition>
  );
}
