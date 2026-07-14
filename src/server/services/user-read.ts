import 'server-only';
import { prisma } from '@/server/db/prisma';

/**
 * User read helpers (server-only).
 *
 * Keeps direct Prisma access in the service layer instead of in components/pages,
 * matching the convention used by bookings-read.ts and the rest of the app.
 */

/**
 * Current profile photo for a user, or null.
 *
 * Read fresh from the DB rather than the session so the UI reflects a
 * just-changed avatar (the session image can be stale after a profile update).
 */
export async function getUserProfileImage(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { image: true },
  });
  return row?.image ?? null;
}
