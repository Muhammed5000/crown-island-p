import 'server-only';
import { prisma } from '@/server/db/prisma';
import { renderQrPng } from '@/lib/qr';
import { log, errFields } from '@/lib/log';
import { getPersonQrCode } from './api';
import { isZkConfigured } from './client';

/**
 * Customer-facing ZK pass: the guest's cabin card number + a scannable door QR.
 * Read on demand (the ZK QR is dynamic) by the owner-scoped `/zk-pass` route.
 * Never exposes the pin or any ZK connection detail — only the card number and a
 * ready-to-render QR image.
 */
export interface BookingZkPass {
  /** Lower-cased Booking.zkProvisionStatus, or 'none' for non-ZK bookings. */
  status: 'none' | 'pending' | 'provisioned' | 'failed' | 'revoked';
  cardNo: string | null;
  /** A data: URL of the door QR (PNG), or null if unavailable right now. */
  qr: string | null;
}

/** PNG / JPEG magic-byte sniff so we don't double-encode an image the server
 * already returned as a picture (vs a QR *content* string we must render). */
function imageKind(b64: string): 'png' | 'jpeg' | null {
  try {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
    return null;
  } catch {
    return null;
  }
}

export async function getBookingZkPass(bookingId: string): Promise<BookingZkPass> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      zkProvisionStatus: true,
      zkPin: true,
      zkCardNo: true,
      service: { select: { requiresAccessControl: true } },
    },
  });

  if (!booking || !booking.service?.requiresAccessControl) {
    return { status: 'none', cardNo: null, qr: null };
  }

  const status = booking.zkProvisionStatus.toLowerCase() as BookingZkPass['status'];

  let qr: string | null = null;
  // Only worth a ZK round-trip when a person exists and access is (or is becoming)
  // active. Failures fall back to the card number — never surface to the guest.
  if (
    booking.zkPin &&
    (booking.zkProvisionStatus === 'PROVISIONED' || booking.zkProvisionStatus === 'PENDING')
  ) {
    try {
      if (await isZkConfigured()) {
        const code = await getPersonQrCode(booking.zkPin);
        if (code) {
          const kind = imageKind(code);
          qr = kind
            ? `data:image/${kind};base64,${code}`
            : `data:image/png;base64,${Buffer.from(await renderQrPng(code)).toString('base64')}`;
        }
      }
    } catch (err) {
      log.warn('zk QR fetch failed for booking', { bookingId, ...errFields(err) });
    }
  }

  return { status, cardNo: booking.zkCardNo, qr };
}
