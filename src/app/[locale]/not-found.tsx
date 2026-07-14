import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { BackButton } from '@/components/layout/BackButton';
import { Card, CardBody } from '@/components/ui/Card';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';

export default async function NotFound() {
  // not-found.tsx is a special Next.js file that does NOT receive `params`,
  // so we read the active locale from next-intl's request context instead.
  const locale = await getLocale();
  setRequestLocale(locale);
  const t = await getTranslations('common');

  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy-950 p-6 text-cream">
      <Card variant="glass" className="w-full max-w-md">
        <CardBody className="flex flex-col items-center gap-8 py-16 text-center">
          <ErrorIllustration type="not-found" />

          <div className="space-y-2">
            <h1 className="font-display text-4xl font-black text-gradient-gold">404</h1>
            <p className="text-muted-foreground uppercase tracking-[0.2em] text-xs font-bold">{t('notFound.title')}</p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {t('notFound.description')}
            </p>
          </div>

          {/* Returns the user one step back (router.back()) rather than to the
              site home — so an admin who hits a 404 lands back in the admin
              area they came from. Falls back to home only when there's no
              history to pop. */}
          <BackButton
            label={t('notFound.action')}
            fallbackHref="/"
            className="h-12 rounded-2xl bg-gradient-to-br from-gold-300 via-gold-500 to-gold-700 px-10 text-sm font-black uppercase tracking-widest text-navy-950 shadow-gold hover:brightness-110"
          />
        </CardBody>
      </Card>
    </div>
  );
}
