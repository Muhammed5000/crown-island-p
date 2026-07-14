import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireReceptionOrNull } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { listGuestIds } from '@/server/services/guest-id';
import {
  getPayableSanctionsByPhone,
  getPayableSanctionsForUser,
} from '@/server/services/sanctions';
import { visitTokenForBooking } from '@/server/services/visit-code';
import { formatMoney } from '@/lib/money';
import { renderQrSvg } from '@/lib/qr';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { GuestIdCheckIn, type GuestIdDocView } from '@/components/gate/GuestIdCheckIn';

interface Props {
  params: Promise<{ locale: string; bookingId: string }>;
}

/**
 * Reception check-in — guest ID collection (`/gate/reception/checkin/[bookingId]`).
 *
 * Reception-authorised staff land here after creating a walk-in booking, opening
 * an existing one, or scanning a QR pass that still needs IDs. The page loads the
 * guest count + any IDs already on file and renders the upload grid. The final
 * "Complete Check-In" is gated server-side in `checkInBooking`.
 */
export default async function ReceptionCheckInPage({ params }: Props) {
  const { locale, bookingId } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const staff = await requireReceptionOrNull();
  if (!staff) {
    return (
      <main dir="ltr" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'radial-gradient(ellipse at top, #ffffff 0%, #f4f6f7 55%), #f4f6f7' }}>
        <div
          style={{
            maxWidth: 380, textAlign: 'center', padding: '32px 28px', borderRadius: 20,
            background: '#ffffff', border: '1px solid rgba(28,43,64,0.12)',
            boxShadow: '0 10px 30px rgba(28,43,64,0.08)',
            color: '#1c2b40', fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
          }}
        >
          <p style={{ fontFamily: 'var(--font-aurelia-display), serif', fontSize: 28, fontWeight: 600, color: '#9c7d34', margin: 0 }}>403</p>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: '12px 0 8px' }}>Reception access restricted</h1>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(28,43,64,0.62)', margin: 0 }}>
            This account is not authorised for the reception desk.
          </p>
        </div>
      </main>
    );
  }

  const ar = locale === 'ar';
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: { select: { name: true, phone: true } },
      service: { include: { category: { select: { nameEn: true, nameAr: true } } } },
      units: { select: { unitIndex: true, placeId: true } },
      invoice: { select: { totalCents: true } },
      payments: { where: { status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' }, take: 1, select: { provider: true } },
      // Deposit-checkout entry point (footer link) — id-only presence check.
      insurance: { select: { id: true } },
    },
  });
  if (!booking) notFound();

  // The admitted screen's entry-pass ticket shows the DAILY VISIT QR (the same
  // signed token the gate scans). Only CONFIRMED bookings get a pass.
  let qrSvg: string | null = null;
  if (booking.status === 'CONFIRMED') {
    try {
      const { token } = await visitTokenForBooking(prisma, booking.id);
      qrSvg = await renderQrSvg(token);
    } catch {
      qrSvg = null;
    }
  }
  const PAYMENT_LABEL: Record<string, string> = {
    CASH: 'Cash',
    INSTAPAY: 'InstaPay',
    CREDIT_AGRICOLE: 'Card',
    VODAFONE_CASH: 'Vodafone Cash',
    APPLE_PAY: 'Apple Pay',
  };
  const provider = booking.payments[0]?.provider ?? null;

  // Placement roll-up (deduped by unit index) drives the wizard's places step.
  const requiresPlacement = booking.service.placeAssignmentRequired;
  const placedByIndex = new Map<number, boolean>();
  for (const u of booking.units) {
    placedByIndex.set(u.unitIndex, (placedByIndex.get(u.unitIndex) ?? false) || !!u.placeId);
  }
  const placedTotal = placedByIndex.size || booking.unitsPerDay;
  const placedCount = [...placedByIndex.values()].filter(Boolean).length;
  const placementStatus: 'NOT_REQUIRED' | 'PENDING' | 'PARTIAL' | 'COMPLETE' = !requiresPlacement
    ? 'NOT_REQUIRED'
    : placedCount === 0
      ? 'PENDING'
      : placedCount >= placedTotal
        ? 'COMPLETE'
        : 'PARTIAL';

  // Outstanding sanctions for the GUEST being checked in (info-only here —
  // they're collected through bookings, never at the check-in step). Online
  // bookings carry the customer's userId; walk-ins match by guest phone.
  const guestSanctions = booking.createdByStaffId
    ? booking.guestPhone
      ? await getPayableSanctionsByPhone(booking.guestPhone)
      : null
    : await getPayableSanctionsForUser(booking.userId);
  const sanctionTotalCents = guestSanctions?.totalCents ?? 0;

  const docs = await listGuestIds(booking.id);
  const initialDocs: GuestIdDocView[] = docs.map((d) => ({
    guestSeq: d.guestSeq,
    imageUrl: d.imageUrl,
    fileName: d.fileName,
    verificationStatus: d.verificationStatus,
    guestName: d.guestName ?? null,
    entered: d.checkedInAt != null,
  }));

  return (
    <>
      {sanctionTotalCents > 0 ? (
        <div
          style={{
            margin: '16px auto 0',
            maxWidth: 980,
            padding: '14px 18px',
            borderRadius: 12,
            background: 'rgba(232,131,106,0.1)',
            border: '1px solid rgba(232,131,106,0.35)',
            color: '#e8836a',
            fontSize: 13,
            lineHeight: 1.5,
            fontFamily:
              "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          }}
        >
          <strong style={{ display: 'block', marginBottom: 2 }}>
            ⚠ This guest has unpaid sanctions —{' '}
            {formatMoney(sanctionTotalCents, { locale, currency: 'EGP' })}
          </strong>
          The administration flagged this customer. The amount is collected automatically with
          their next booking (it is NOT collected at check-in).
        </div>
      ) : null}
      <GuestIdCheckIn
      locale={locale}
      booking={{
        id: booking.id,
        reference: booking.reference,
        guestName: booking.guestName ?? booking.user.name ?? 'Guest',
        // Walk-ins carry the guest's phone in `guestPhone`; online bookings leave
        // it null, so fall back to the customer account's phone (mirrors the name
        // fallback above and the reception desk / gate-scan convention) instead of
        // showing a dash to the reception operator.
        guestPhone: booking.guestPhone ?? booking.user.phone ?? '—',
        serviceName: ar ? booking.service.nameAr : booking.service.nameEn,
        categoryName: ar ? booking.service.category.nameAr : booking.service.category.nameEn,
        dateLabel: formatDate(booking.bookingDate, locale),
        people: booking.people,
        adults: booking.adults,
        children: booking.children,
        extraPersons: booking.extraPersons,
        cars: booking.cars,
        enteredCount: booking.checkedInCount,
        // "Already checked in" means FULLY entered — a partial entry still lets
        // the wizard admit the rest of the party. Admissible = people + extra persons.
        alreadyCheckedIn: booking.checkedInCount >= booking.people + booking.extraPersons,
        requiresPlacement,
        placementStatus,
        totalCents: booking.invoice?.totalCents ?? null,
        paymentLabel: provider ? (PAYMENT_LABEL[provider] ?? provider) : null,
        qrSvg,
      }}
      initialDocs={initialDocs}
    />
      {booking.insurance ? <DepositCheckoutFooter locale={locale} bookingId={booking.id} /> : null}
    </>
  );
}

/** Footer link to the deposit-checkout window, shown only when the booking holds a deposit. */
async function DepositCheckoutFooter({ locale, bookingId }: { locale: string; bookingId: string }) {
  const t = await getTranslations('reception.checkout');
  return (
    <div dir="ltr" style={{ maxWidth: 980, margin: '0 auto', padding: '4px 16px 28px', textAlign: 'center' }}>
      <a
        href={`/${locale === 'en' ? 'en/' : ''}gate/reception/checkout/${bookingId}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, height: 42, padding: '0 20px',
          borderRadius: 12, background: 'rgba(194,161,78,0.10)', border: '1px solid rgba(156,125,52,0.35)',
          color: '#9c7d34', fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
          fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
        }}
      >
        {t('checkinLink')}
      </a>
    </div>
  );
}
