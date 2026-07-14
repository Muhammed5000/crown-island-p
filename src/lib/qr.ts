import 'server-only';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

/**
 * Signed QR payload helpers.
 *
 * The QR encodes a compact `payload.signature` token. Two payload shapes exist:
 *
 *   - VISIT token  `{ vc, exp }` — the daily root code: `vc` is the opaque
 *     `VisitCode.code` grouping ALL of a customer's bookings for one day.
 *     Every customer QR and reception print now encodes this shape.
 *   - BOOKING token `{ bid, ref, exp }` — the legacy per-booking shape, still
 *     verified for backward compatibility (previously printed/saved QRs).
 *
 * The signature is an HMAC-SHA256 over the payload using AUTH_SECRET, so an
 * admin scanner can verify authenticity offline. The DB remains the source of
 * truth for status — the scanner re-reads the booking(s) and refuses entry if
 * status ≠ CONFIRMED or the date has passed.
 */

export interface QrBookingPayload {
  bid: string; // booking id
  ref: string; // human reference
  exp: number; // unix seconds
}

export interface QrVisitPayload {
  /** Opaque VisitCode.code — the daily root code. */
  vc: string;
  exp: number; // unix seconds
}

export type QrPayload = QrBookingPayload | QrVisitPayload;

export function isVisitPayload(p: QrPayload): p is QrVisitPayload {
  return typeof (p as QrVisitPayload).vc === 'string';
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set; cannot sign QR tokens');
  return s;
}

export function signQrToken(payload: QrPayload): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest();
  return `${body}.${base64UrlEncode(sig)}`;
}

/**
 * Canonical booking → signed-QR-token recipe.
 *
 * The token expires 24h after the booking date — generous so guests can re-show
 * after entry. Centralised here so the customer QR endpoint, the gate re-sign,
 * and printed invoices all emit a byte-identical, gate-verifiable token with no
 * drift between surfaces.
 */
export function bookingQrToken(booking: { id: string; reference: string; bookingDate: Date }): string {
  const exp = Math.floor(booking.bookingDate.getTime() / 1000) + 24 * 60 * 60;
  return signQrToken({ bid: booking.id, ref: booking.reference, exp });
}

/**
 * Canonical visit (daily root) → signed-QR-token recipe.
 *
 * `lastDay` is the latest day any booking in the group covers (a multi-day
 * booking's end date), so the token stays scannable for the whole visit and
 * expires 24h after it — same grace the per-booking tokens had.
 */
export function visitQrToken(visit: { code: string }, lastDay: Date): string {
  const exp = Math.floor(lastDay.getTime() / 1000) + 24 * 60 * 60;
  return signQrToken({ vc: visit.code, exp });
}

export function verifyQrToken(token: string): QrPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = base64UrlEncode(
    crypto.createHmac('sha256', getSecret()).update(body).digest(),
  );
  // Constant-time comparison: a plain `expected !== sig` leaks, via response
  // timing, how many leading characters of a forged signature are correct,
  // which can be used to forge a valid token byte-by-byte.
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(sig);
  if (expectedBuf.length !== sigBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, sigBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64').toString('utf8')) as QrPayload;
    const isVisit = typeof (payload as QrVisitPayload).vc === 'string';
    const isBooking =
      typeof (payload as QrBookingPayload).bid === 'string' &&
      typeof (payload as QrBookingPayload).ref === 'string';
    if (!isVisit && !isBooking) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function renderQrSvg(token: string): Promise<string> {
  return QRCode.toString(token, {
    type: 'svg',
    color: { dark: '#0a132a', light: '#ffffff' },
    margin: 1,
    width: 256,
    errorCorrectionLevel: 'M',
  });
}

export async function renderQrPng(token: string): Promise<Buffer> {
  return QRCode.toBuffer(token, {
    type: 'png',
    color: { dark: '#0a132a', light: '#ffffff' },
    margin: 1,
    width: 512,
    errorCorrectionLevel: 'M',
  });
}
