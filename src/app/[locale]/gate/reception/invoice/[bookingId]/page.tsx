import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireReceptionOrNull } from '@/server/auth/guards';
import { getReceptionBookingForInvoice, assignedPlaceLabels } from '@/server/services/reception';
import { getSettings } from '@/server/settings/settings';
import { resolveInvoiceTerms } from '@/server/services/invoice-terms';
import { renderQrSvg } from '@/lib/qr';
import { visitTokenForBooking, recordVisitPrinted } from '@/server/services/visit-code';
import { prisma } from '@/server/db/prisma';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateRange } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { PrintButton } from '@/components/gate/PrintButton';

interface Props {
  params: Promise<{ locale: string; bookingId: string }>;
}

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Cash',
  INSTAPAY: 'InstaPay',
  CREDIT_AGRICOLE: 'Card',
  VODAFONE_CASH: 'Vodafone Cash',
  APPLE_PAY: 'Apple Pay',
};

/**
 * Printable reception invoice. Reception-authorised staff only. Includes every
 * booking + payment detail and, for InstaPay, the uploaded proof image.
 */
export default async function ReceptionInvoicePage({ params }: Props) {
  const { locale, bookingId } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const staff = await requireReceptionOrNull();
  if (!staff) notFound();

  const booking = await getReceptionBookingForInvoice(bookingId);
  if (!booking || !booking.invoice) notFound();

  const ar = locale === 'ar';

  // Terms & Conditions of the booking's exact category (admin-authored), falling
  // back to the global Settings terms only when the category has none. Data is
  // already loaded by getReceptionBookingForInvoice (service.category).
  const settings = await getSettings();
  const terms = resolveInvoiceTerms(booking.service.category, settings, locale);

  // The DAILY VISIT QR — signed over the customer's per-day root code, so ONE
  // scan at the gate opens EVERY booking this customer has for the day (this
  // one included). Identical token recipe to the customer-app QR. Only printed
  // for CONFIRMED bookings so a held/cancelled invoice never carries a pass.
  // Sibling bookings of the same visit are listed on the invoice so the staff
  // and the guest can see everything the one pass covers.
  let qrSvg: string | null = null;
  let visitSiblings: {
    id: string;
    reference: string;
    status: string;
    serviceName: string;
  }[] = [];
  if (booking.status === 'CONFIRMED') {
    const { token, visit } = await visitTokenForBooking(prisma, booking.id);
    qrSvg = await renderQrSvg(token);
    await recordVisitPrinted(visit.id);
    const siblings = await prisma.booking.findMany({
      where: { visitCodeId: visit.id, id: { not: booking.id } },
      select: {
        id: true,
        reference: true,
        status: true,
        service: { select: { nameEn: true, nameAr: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    visitSiblings = siblings.map((s) => ({
      id: s.id,
      reference: s.reference,
      status: s.status,
      serviceName: ar ? s.service.nameAr : s.service.nameEn,
    }));
  }
  const tServices = await getTranslations('services');
  const tBooking = await getTranslations('booking');
  const lineLabel = (key: string) => {
    if (key.startsWith('services.')) return tServices(key.slice('services.'.length));
    if (key.startsWith('booking.')) return tBooking(key.slice('booking.'.length));
    return key;
  };

  const payment = booking.payments[0];
  const methodLabel = payment ? (PAYMENT_LABEL[payment.provider] ?? payment.provider) : '—';
  const serviceName = ar ? booking.service.nameAr : booking.service.nameEn;
  const categoryName = ar ? booking.service.category.nameAr : booking.service.category.nameEn;
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const places = assignedPlaceLabels(booking.units);
  const placeTypeLabel = booking.service.placeType
    ? booking.service.placeType.charAt(0) + booking.service.placeType.slice(1).toLowerCase()
    : 'Place';
  const multiDay = booking.endDate && booking.endDate > booking.bookingDate;
  const dateValue = multiDay
    ? formatDateRange(booking.bookingDate, booking.endDate!, locale)
    : formatDate(booking.bookingDate, locale);
  const guestsValue =
    `${booking.adults} adult${booking.adults === 1 ? '' : 's'}` +
    (booking.children > 0 ? ` · ${booking.children} child${booking.children === 1 ? '' : 'ren'}` : '');

  return (
    <div
      dir="ltr"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '70px 16px 40px',
        fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
      }}
    >
      {/* Print rules: drop the dark background + hide chrome, keep only the invoice.
          The QR svg is forced to fill its box (the raw svg carries width=256), and
          on print it is fixed to a scannable size with exact color so printer
          drivers can't lighten it; Terms items never split across a page break. */}
      <style>{`
        #ci-invoice .ci-qr svg { width: 100%; height: auto; display: block; }
        @page { margin: 12mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          #ci-invoice { box-shadow: none !important; margin: 0 !important; }
          #ci-terms, #ci-terms li, .ci-qr { break-inside: avoid; page-break-inside: avoid; }
          .ci-qr, .ci-qr svg { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .ci-qr { width: 34mm !important; }
        }
      `}</style>

      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintButton label="Print invoice" />
      </div>

      <div
        id="ci-invoice"
        style={{
          width: '100%',
          maxWidth: 720,
          background: '#fff',
          color: '#1a1206',
          borderRadius: 14,
          padding: '34px 38px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e3bf73', paddingBottom: 18 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-aurelia-display), serif', fontSize: 26, fontWeight: 700, color: '#1a1206' }}>
              Crown Island
            </div>
            <div style={{ fontSize: 12, color: '#7a6f57', letterSpacing: '0.18em', marginTop: 2 }}>EL MONTAZAH · RECEPTION INVOICE</div>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#7a6f57' }}>Reference</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>{booking.reference}</div>
              <div style={{ fontSize: 12, color: '#7a6f57', marginTop: 6 }}>Issued {formatDate(booking.createdAt, locale)}</div>
            </div>
            {qrSvg ? (
              <div className="ci-qr" dir="ltr" style={{ width: 124 }}>
                <div role="img" aria-label={`Visit pass QR code for ${booking.reference}`} dangerouslySetInnerHTML={{ __html: qrSvg }} style={{ width: '100%' }} />
                <div style={{ fontSize: 9.5, color: '#7a6f57', letterSpacing: '0.08em', marginTop: 4, textTransform: 'uppercase' }}>
                  {ar
                    ? visitSiblings.length > 0 ? 'تصريح اليوم — لكل الحجوزات' : 'امسح للتحقق'
                    : visitSiblings.length > 0 ? 'Day pass — all bookings' : 'Scan to verify'}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 28px', padding: '22px 0', borderBottom: '1px solid #eee' }}>
          <Field label="Customer" value={booking.guestName ?? booking.user.name ?? booking.user.email ?? '—'} />
          <Field label="Phone" value={booking.guestPhone ?? booking.user.phone ?? '—'} />
          <Field label="Experience" value={categoryName} />
          <Field label="Service" value={serviceName} />
          <Field label={multiDay ? 'Booking dates' : 'Booking date'} value={dateValue} />
          <Field label="Guests" value={guestsValue} />
          <Field label="Cars" value={String(booking.cars)} />
          <Field label="Payment method" value={methodLabel} />
          <Field label="Status" value={booking.status} />
          {booking.service.placeAssignmentRequired ? (
            <Field
              label={`${placeTypeLabel}s (${booking.unitsPerDay})`}
              value={places.length > 0 ? places.join(', ') : 'Pending assignment'}
            />
          ) : null}
        </div>

        {/* Other bookings covered by the same visit pass (one QR for the day) */}
        {visitSiblings.length > 0 ? (
          <div style={{ padding: '14px 0', borderBottom: '1px solid #eee' }}>
            <div style={{ fontSize: 11, color: '#7a6f57', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              {ar ? 'حجوزات أخرى على نفس التصريح' : 'Also covered by this pass'}
            </div>
            {visitSiblings.map((s) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '3px 0' }}>
                <span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{s.reference}</span>
                  {' · '}
                  {s.serviceName}
                </span>
                <span style={{ color: s.status === 'CONFIRMED' ? '#1c7c46' : '#a05a18', fontWeight: 600 }}>{s.status}</span>
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: '#7a6f57', marginTop: 6 }}>
              {ar
                ? 'رمز QR واحد يفتح كل حجوزات هذا اليوم عند البوابة.'
                : 'The single QR above opens every booking of this day at the gate.'}
            </div>
          </div>
        ) : null}

        {/* Line items */}
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '18px 0' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 11, color: '#7a6f57', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              <th style={{ padding: '6px 0' }}>Description</th>
              <th style={{ padding: '6px 0', textAlign: 'center' }}>Qty</th>
              <th style={{ padding: '6px 0', textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {booking.invoice.lines.map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid #f0ece2', fontSize: 14 }}>
                <td style={{ padding: '8px 0' }}>{lineLabel(l.label)}</td>
                <td style={{ padding: '8px 0', textAlign: 'center' }}>{l.quantity}</td>
                <td style={{ padding: '8px 0', textAlign: 'right' }}>{money(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ width: 260 }}>
            <Row label="Subtotal" value={money(booking.invoice.subtotalCents)} />
            {booking.invoice.taxCents > 0 ? <Row label="Tax" value={money(booking.invoice.taxCents)} /> : null}
            {booking.invoice.feeCents > 0 ? <Row label="Fees" value={money(booking.invoice.feeCents)} /> : null}
            {/* Refundable deposit, separated from the service amount (it is
                inside the invoice Total but is a liability, not a charge). */}
            {booking.insurance && booking.insurance.amountCents > 0 ? (
              <Row label={tBooking('insuranceDeposit')} value={money(booking.insurance.amountCents)} />
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #1a1206', marginTop: 6, paddingTop: 8, fontWeight: 800, fontSize: 18 }}>
              <span>Total</span>
              <span>{money(booking.invoice.totalCents)}</span>
            </div>
          </div>
        </div>

        {/* InstaPay proof */}
        {payment?.provider === 'INSTAPAY' && payment.proofUrl ? (
          <div style={{ marginTop: 26, borderTop: '1px solid #eee', paddingTop: 18 }}>
            <div style={{ fontSize: 12, color: '#7a6f57', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              InstaPay payment proof
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={payment.proofUrl} alt="InstaPay proof" style={{ maxWidth: 300, maxHeight: 320, borderRadius: 8, border: '1px solid #eee' }} />
          </div>
        ) : null}

        {/* Terms & Conditions — the booking category's own terms (admin-authored),
            falling back to the global terms only when the category has none. */}
        {terms.length > 0 ? (
          <div id="ci-terms" style={{ marginTop: 26, borderTop: '1px solid #eee', paddingTop: 18 }}>
            <div style={{ fontSize: 12, color: '#7a6f57', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
              {ar ? 'الشروط والأحكام' : 'Terms & Conditions'}
            </div>
            <ol
              dir={ar ? 'rtl' : 'ltr'}
              style={{
                margin: 0,
                paddingInlineStart: 20,
                fontSize: 12.5,
                lineHeight: 1.7,
                color: '#3a3325',
                textAlign: ar ? 'right' : 'left',
              }}
            >
              {terms.map((term, i) => (
                <li key={i} style={{ marginBottom: 5 }}>
                  {term}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <p style={{ marginTop: 28, fontSize: 11, color: '#9a8f77', textAlign: 'center' }}>
          Created at reception by {staff.name ?? staff.email} · Crown Island © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#9a8f77', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1206' }}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#3a3325', padding: '3px 0' }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
