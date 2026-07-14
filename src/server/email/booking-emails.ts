import 'server-only';
import { prisma } from '@/server/db/prisma';
import { buildAbsoluteUrl } from '@/lib/origin';
import { getEmailProvider } from './provider';
import { bookingConfirmationTemplate, refundNoticeTemplate } from './templates';
import { log, errFields } from '@/lib/log';

/**
 * Transactional booking emails (confirmation, refund notice).
 *
 * Design rules:
 *  - **Best-effort, never throwing.** These run AFTER the payment/refund DB
 *    transaction has committed, so a mail failure must never roll back money
 *    state or bubble a 500 back to Paymob (which would trigger a retry storm).
 *    Every path is wrapped so the worst case is "no email sent", logged.
 *  - **Caller guarantees once-only.** The webhook/admin callers invoke these
 *    only on a *fresh* state change (first confirmation, first refund), so we
 *    don't re-send on Paymob's idempotent webhook retries.
 *  - **Online bookings only.** Reception/walk-in bookings have no customer
 *    email on file; if there's no recipient we simply skip.
 */

function localeOf(value: string): 'ar' | 'en' {
  return value === 'en' ? 'en' : 'ar';
}

function intlTag(locale: 'ar' | 'en'): string {
  return locale === 'ar' ? 'ar-EG' : 'en-GB';
}

/** Strip bidirectional control characters. The `currency` number-format injects
 * these (RLM / ALM / isolates); plain-text + some HTML mail clients render them
 * as stray "‏" marks and misplace the amount — the "broken total" symptom. */
function stripBidi(value: string): string {
  return value.replace(/[‎‏؜‪-‮⁦-⁩]/g, '');
}

function formatMoney(cents: number, currency: string, locale: 'ar' | 'en'): string {
  const value = cents / 100;
  // Only show decimals when the amount actually has them (1600 → "1,600", not
  // "1,600.00"). Use the decimal style — NOT the currency style — so no bidi
  // marks are injected, then append a clean, localized currency unit.
  const hasFraction = !Number.isInteger(value);
  let num: string;
  try {
    num = new Intl.NumberFormat(intlTag(locale), {
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    num = value.toFixed(hasFraction ? 2 : 0);
  }
  num = stripBidi(num);
  const unit = currency === 'EGP' ? (locale === 'ar' ? 'ج.م' : 'EGP') : currency;
  // Arabic writes the amount then the unit ("١٬٦٠٠ ج.م"); English leads with it.
  return locale === 'ar' ? `${num} ${unit}` : `${unit} ${num}`;
}

function formatDateRange(start: Date, end: Date | null, locale: 'ar' | 'en'): string {
  const fmt = new Intl.DateTimeFormat(intlTag(locale), { day: 'numeric', month: 'long', year: 'numeric' });
  if (end && end.getTime() > start.getTime()) {
    return `${fmt.format(start)} – ${fmt.format(end)}`;
  }
  return fmt.format(start);
}

function peopleLabel(people: number, locale: 'ar' | 'en'): string {
  if (locale === 'ar') {
    // Arabic-Indic digits so the count matches the date (٢٠ يونيو) instead of
    // mixing Western "12" into the otherwise-Arabic line.
    const n = stripBidi(new Intl.NumberFormat('ar-EG').format(people));
    return `${n} ضيف`;
  }
  return `${people} guest${people === 1 ? '' : 's'}`;
}

/** Locale-aware customer booking-detail URL (`localePrefix: 'as-needed'`, default 'ar'). */
async function bookingUrl(bookingId: string, locale: 'ar' | 'en'): Promise<string> {
  const path = locale === 'en' ? `/en/bookings/${bookingId}` : `/bookings/${bookingId}`;
  return buildAbsoluteUrl(path);
}

/** Send the "booking confirmed + paid" email. Best-effort; no-op when no recipient. */
export async function sendBookingConfirmationEmail(bookingId: string): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        reference: true,
        locale: true,
        bookingDate: true,
        endDate: true,
        people: true,
        guestName: true,
        user: { select: { email: true, name: true } },
        invoice: { select: { totalCents: true, currency: true } },
        service: { select: { nameEn: true, nameAr: true } },
      },
    });

    const to = booking?.user?.email;
    if (!booking || !to) return; // reception/phone-only booking — nothing to send.

    const locale = localeOf(booking.locale);
    const name = booking.user?.name ?? booking.guestName ?? (locale === 'ar' ? 'ضيفنا العزيز' : 'there');
    const serviceName = locale === 'ar' ? booking.service.nameAr : booking.service.nameEn;
    const currency = booking.invoice?.currency ?? 'EGP';
    const totalCents = booking.invoice?.totalCents ?? 0;

    const message = bookingConfirmationTemplate({
      to,
      name,
      locale,
      reference: booking.reference,
      serviceName,
      dateLabel: formatDateRange(booking.bookingDate, booking.endDate, locale),
      peopleLabel: peopleLabel(booking.people, locale),
      totalLabel: formatMoney(totalCents, currency, locale),
      manageUrl: await bookingUrl(bookingId, locale),
    });

    await getEmailProvider().send(message);
  } catch (err) {
    log.error('email booking confirmation send failed', { bookingId, ...errFields(err) });
  }
}

/** Send the "refund processed" email. Best-effort; no-op when no recipient. */
export async function sendRefundNoticeEmail(bookingId: string, amountCents: number): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        reference: true,
        locale: true,
        guestName: true,
        user: { select: { email: true, name: true } },
        invoice: { select: { currency: true } },
      },
    });

    const to = booking?.user?.email;
    if (!booking || !to) return;

    const locale = localeOf(booking.locale);
    const name = booking.user?.name ?? booking.guestName ?? (locale === 'ar' ? 'ضيفنا العزيز' : 'there');
    const currency = booking.invoice?.currency ?? 'EGP';

    const message = refundNoticeTemplate({
      to,
      name,
      locale,
      reference: booking.reference,
      amountLabel: formatMoney(amountCents, currency, locale),
      manageUrl: await bookingUrl(bookingId, locale),
    });

    await getEmailProvider().send(message);
  } catch (err) {
    log.error('email refund notice send failed', { bookingId, ...errFields(err) });
  }
}
