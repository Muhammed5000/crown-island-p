'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/layout/BackButton';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const tCommon = useTranslations('common');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <Card variant="glass" className="w-full max-w-md">
        <CardBody className="flex flex-col items-center gap-8 py-16 text-center">
          <ErrorIllustration type="storm" />
          
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-gold-700 uppercase tracking-wider">
              {tCommon('errorPage.title')}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {tCommon('errorPage.description')}
            </p>
          </div>

          <div className="flex flex-col items-center gap-3">
            <Button
              onClick={reset}
              variant="gold"
              className="h-12 rounded-2xl px-10 text-sm font-black uppercase tracking-widest"
            >
              {tCommon('retry')}
            </Button>
            <BackButton fallbackHref="/" />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
