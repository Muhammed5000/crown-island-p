import type { BookingStatus } from '@prisma/client';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardFooter } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { BookingStatusBadge } from './BookingStatusBadge';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';

interface Props {
  locale: 'ar' | 'en';
  booking: {
    id: string;
    reference: string;
    status: BookingStatus;
    bookingDate: Date;
    people: number;
    cars: number;
    service: { nameEn: string; nameAr: string; category: { nameEn: string; nameAr: string } };
    invoice: { totalCents: number; currency: string } | null;
  };
  dateLabel: string;
  totalLabel: string;
  referenceLabel: string;
  /** Tiny insurance-deposit chip (refund in progress / refunded), if any. */
  depositChip?: { label: string; tone: BadgeTone } | null;
}

export function BookingRowCard({
  locale,
  booking,
  dateLabel,
  totalLabel,
  referenceLabel,
  depositChip,
}: Props) {
  const category = locale === 'ar' ? booking.service.category.nameAr : booking.service.category.nameEn;
  const service = locale === 'ar' ? booking.service.nameAr : booking.service.nameEn;

  // Status-tinted accent rail — mirrors the schedule cards in the reference
  // image (gold = awaiting action, teal = active, muted = closed out).
  const accentClass =
    booking.status === 'PENDING_PAYMENT'
      ? 'bg-gold-400'
      : booking.status === 'CANCELLED' ||
          booking.status === 'EXPIRED' ||
          booking.status === 'FAILED'
        ? 'bg-muted-foreground/40'
        : 'bg-accent';

  return (
    <Link href={`/bookings/${booking.id}`} className="block focus-visible:outline-none">
      <Card className="group relative transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">
        {/* Status accent rail (image's schedule-card cue). */}
        <span
          aria-hidden
          className={cn('absolute inset-y-4 start-0 w-[3px] rounded-full', accentClass)}
        />
        <CardBody className="space-y-3.5 p-5 ps-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-gold-600">
                {category}
              </p>
              <h2 className="mt-1 truncate text-[19px] font-bold leading-tight text-foreground">
                {service}
              </h2>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <BookingStatusBadge status={booking.status} />
              {depositChip ? <Badge tone={depositChip.tone}>{depositChip.label}</Badge> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{dateLabel}</p>
              <p className="font-medium text-foreground">{formatDate(booking.bookingDate, locale)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{totalLabel}</p>
              <p className="font-medium tabular-nums text-foreground">
                {booking.invoice
                  ? formatMoney(booking.invoice.totalCents, { locale, currency: 'EGP' })
                  : '—'}
              </p>
            </div>
          </div>
        </CardBody>
        <CardFooter>
          <span className="text-xs text-muted-foreground">{referenceLabel}</span>
          <span dir="ltr" className="text-xs font-medium tracking-[0.04em] text-muted-foreground">
            {booking.reference}
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
}
