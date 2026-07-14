import 'server-only';
import { prisma } from '@/server/db/prisma';
import { resortCivilDayUTC } from '@/lib/date';
import { notifyCustomer } from './customer-notifications';

/**
 * Post-visit "rate your visit" nudge sweep.
 *
 * Finds account-customer bookings whose visit is OVER (the last covered day is
 * behind us — same civil-day predicate as booking expiry), that were confirmed
 * or attended, have NO review yet, and haven't already been nudged; then sends an
 * in-app inbox + web-push nudge and stamps `reviewPromptedAt` so each booking is
 * nudged exactly once. The atomic `reviewPromptedAt` claim makes it idempotent
 * and safe to run concurrently (in-process scheduler + external cron overlap).
 */
const BATCH = 100;

export async function sweepReviewNudges(): Promise<{ scanned: number; nudged: number }> {
  const today = new Date(resortCivilDayUTC(new Date()));

  const candidates = await prisma.booking.findMany({
    where: {
      reviewPromptedAt: null,
      review: { is: null },
      status: { in: ['CONFIRMED', 'EXPIRED'] },
      user: { role: 'CUSTOMER', deletedAt: null },
      // Visit fully past: multi-day runs to endDate, single-day to bookingDate.
      OR: [{ endDate: { lt: today } }, { endDate: null, bookingDate: { lt: today } }],
    },
    orderBy: { bookingDate: 'desc' },
    take: BATCH,
    select: { id: true, userId: true },
  });

  let nudged = 0;
  for (const b of candidates) {
    // Claim atomically — a concurrent sweep / restart can never double-nudge.
    const claim = await prisma.booking.updateMany({
      where: { id: b.id, reviewPromptedAt: null },
      data: { reviewPromptedAt: new Date() },
    });
    if (claim.count === 0) continue;

    await notifyCustomer({
      userId: b.userId,
      kind: 'review_nudge',
      titleEn: 'How was your visit?',
      titleAr: 'كيف كانت زيارتك؟',
      bodyEn: 'Tap to rate your visit and leave a comment — it only takes a minute.',
      bodyAr: 'اضغط لتقييم زيارتك وترك تعليق — لن يستغرق سوى دقيقة.',
      url: `/bookings/${b.id}`,
    });
    nudged += 1;
  }

  return { scanned: candidates.length, nudged };
}
