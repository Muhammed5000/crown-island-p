import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { createReceptionBooking, type CreateReceptionBookingInput } from './reception';
import { visitTokenForBooking } from './visit-code';
import { renderQrSvg } from '@/lib/qr';

/**
 * Commit a reception booking and render its daily-visit QR — the shared core of
 * the reception desk that runs wherever the booking is WRITTEN:
 *  - single / online deployments: called directly by the desk action;
 *  - local ↔ online: called by POST /api/sync/reception-booking on the ONLINE
 *    node, so online stays the sole writer of bookings AND of capacity (the
 *    local desk proxies here instead of writing the booking locally, which would
 *    otherwise strand it — Booking is not a pushable entity).
 *
 * Retries the Serializable write conflict (Postgres 40001 → Prisma P2034) and
 * renders the QR best-effort, exactly as the desk action used to inline.
 */
export interface ReceptionCommitResult {
  bookingId: string;
  reference: string;
  totalCents: number;
  qrSvg: string | null;
}

export async function commitReceptionBooking(
  input: CreateReceptionBookingInput,
): Promise<ReceptionCommitResult> {
  let res: Awaited<ReturnType<typeof createReceptionBooking>> | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await createReceptionBooking(input);
      break;
    } catch (err) {
      if (
        attempt < 4 &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        continue;
      }
      throw err;
    }
  }

  let qrSvg: string | null = null;
  try {
    const { token } = await visitTokenForBooking(prisma, res.bookingId);
    qrSvg = await renderQrSvg(token);
  } catch {
    qrSvg = null;
  }

  return { ...res, qrSvg };
}
