import { useTranslations } from 'next-intl';
import type { BookingStatus } from '@prisma/client';
import { Badge } from '@/components/ui/Badge';

const TONES: Record<BookingStatus, 'gold' | 'success' | 'warning' | 'danger' | 'muted' | 'info'> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'muted',
  EXPIRED: 'muted',
  FAILED: 'danger',
};

/**
 * Translates a Prisma `BookingStatus` to a coloured pill.
 *
 * Reads labels from the `history.status.*` namespace so AR / EN swap cleanly.
 */
export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const t = useTranslations('history.status');
  return <Badge tone={TONES[status]}>{t(status)}</Badge>;
}
