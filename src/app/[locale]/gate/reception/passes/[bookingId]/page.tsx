import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireReceptionOrNull } from '@/server/auth/guards';
import { getReceptionBookingForInvoice, assignedPlaceLabels } from '@/server/services/reception';
import { formatDate, formatDateRange } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { code128Svg } from '@/lib/code128';
import { PrintButton } from '@/components/gate/PrintButton';

interface Props {
  params: Promise<{ locale: string; bookingId: string }>;
}

export default async function ReceptionPassesPage({ params }: Props) {
  const { locale, bookingId } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const staff = await requireReceptionOrNull();
  if (!staff) notFound();

  const booking = await getReceptionBookingForInvoice(bookingId);
  if (!booking) notFound();

  const ar = locale === 'ar';
  const serviceName = ar ? booking.service.nameAr : booking.service.nameEn;
  const categoryName = ar ? booking.service.category.nameAr : booking.service.category.nameEn;
  const guest = booking.guestName ?? booking.user.name ?? 'Guest';
  const places = assignedPlaceLabels(booking.units);
  const placesLabel = places.length > 0 ? places.join(', ') : null;
  const multiDay = booking.endDate && booking.endDate > booking.bookingDate;
  const dateValue = multiDay
    ? formatDateRange(booking.bookingDate, booking.endDate!, locale)
    : formatDate(booking.bookingDate, locale);

  // Code 128 barcode of the booking reference — identical encoder/settings to
  // the gate/scan bracelet stickers (`printTicketBarcode`), so the same gate
  // scanner reads it. NOT a QR code. Rendered once and reused for every copy.
  // The SVG carries a viewBox + preserveAspectRatio="none", so the print CSS
  // can lock it to the exact bracelet size (64 × 15 mm) without distorting the
  // *relative* bar widths the scanner depends on.
  const barcodeSvg = code128Svg(booking.reference, {
    moduleWidth: 2,
    height: 60,
    quiet: 10,
    dark: '#0a132a',
    light: '#ffffff',
  });

  // One bracelet per guest — the printed copy count always equals the booking's
  // people count (min 1 as a safety floor for malformed/zero rows).
  const passesCount = booking.people > 0 ? booking.people : 1;
  const passes = Array.from({ length: passesCount }, (_, i) => i + 1);

  return (
    <div
      dir="ltr"
      style={{
        minHeight: '100dvh',
        padding: '32px 16px',
        fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
        background: '#f4f4f4',
        color: '#0a132a',
      }}
    >
      <style>{`
        /* ── Bracelet sizing (matches gate/scan printTicket.ts) ──
           Each wristband label is 70mm wide; the barcode itself is locked to
           64 x 15mm so it prints sharp, scannable, and never stretched or
           cropped on a wristband — regardless of how long the reference is. */
        .barcode svg { width: 64mm; height: 15mm; display: block; }
        .sheet {
          display: flex;
          flex-wrap: wrap;
          gap: 6mm 5mm;
          justify-content: center;
          align-content: flex-start;
          max-width: 220mm;
          margin: 0 auto;
        }
        .bracelet {
          width: 70mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          border: 1px solid #d8d8d8;
          border-radius: 6px;
          padding: 5px 4px 4px;
          background: #fff;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .bracelet .brand {
          font-size: 8px; font-weight: 700; letter-spacing: 2px; color: #0a132a;
          margin-bottom: 3px;
        }
        .bracelet .ref {
          margin-top: 3px; font-size: 9px; font-weight: 700; letter-spacing: 1px;
          font-family: monospace; color: #0a132a;
        }
        .bracelet .idx { font-size: 7px; color: #888; margin-top: 2px; }
        .bracelet .place {
          margin-top: 3px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px;
          color: #0a132a; border: 1px solid #e3bf73; border-radius: 4px;
          padding: 1px 6px; background: #fbf4e4;
        }

        @page { size: auto; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          /* Render bars at full contrast on every printer driver. */
          .barcode svg, .bracelet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* Controls + sheet header — hidden from the printout. */}
      <div className="no-print" style={{ marginBottom: 24, textAlign: 'center' }}>
        <PrintButton label="Print Passes" />
        <p style={{ marginTop: 12, fontSize: 13, color: '#666', lineHeight: 1.6 }}>
          Prints <strong>{passesCount}</strong> bracelet {passesCount === 1 ? 'barcode' : 'barcodes'} —
          one per guest, sized for wristbands ({categoryName} · {serviceName} · {dateValue}).
          <br />
          {guest} · {booking.reference}
          {placesLabel ? (
            <>
              <br />
              <strong>Cabins / places: {placesLabel}</strong>
            </>
          ) : null}
          <br />
          Note: the gate scans the whole booking from any one bracelet.
        </p>
      </div>

      {/* Bracelet sheet — one compact, wristband-sized barcode label per guest. */}
      <div className="sheet">
        {passes.map((passNum) => (
          <div key={passNum} className="bracelet">
            <div className="brand">CROWN ISLAND</div>
            <div
              className="barcode"
              dangerouslySetInnerHTML={{ __html: barcodeSvg }}
              style={{ width: '64mm' }}
            />
            <div className="ref" dir="ltr">
              {booking.reference}
            </div>
            {placesLabel ? <div className="place">{placesLabel}</div> : null}
            <div className="idx">
              {guest} · {passNum} / {passesCount}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
