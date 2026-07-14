import { getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';

/**
 * Customer-facing maintenance card shown on every booking entry page when
 * the admin "Bookings enabled" toggle is OFF. Server-rendered so it can be
 * inlined from any RSC without forcing a client boundary.
 *
 * The copy intentionally avoids blaming the admin and gives no ETA — we
 * don't know when bookings come back on, so promising a time would be a lie.
 */
export async function BookingsDisabledState() {
  const t = await getTranslations('booking');
  return (
    <div className="mx-auto max-w-md px-5 py-10 md:max-w-xl">
      <Card variant="glass">
        <CardBody className="space-y-2 py-6 text-center">
          <h1 className="font-display text-xl font-semibold text-gold-700">
            {t('disabledTitle')}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('disabledSubtitle')}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
