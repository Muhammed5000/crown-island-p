import 'server-only';
import { prisma } from '@/server/db/prisma';
import { pushToUser } from '@/server/push/web-push';
import { log, errFields } from '@/lib/log';

/**
 * Customer in-app notification inbox — the bell dropdown + /notifications page.
 * Every query is scoped to the passed `userId` (the caller resolves it from the
 * session), so a customer can only ever see or mutate their own rows.
 */

/**
 * Send ONE transactional notification to a customer: write the in-app inbox row
 * AND fire a best-effort web push to their devices. Use this OUTSIDE / AFTER a
 * transaction (the push is an external HTTP call) — it never throws, so a
 * notification hiccup can't roll back or fail the action that triggered it.
 */
export async function notifyCustomer(input: {
  userId: string;
  /** Machine kind, e.g. 'review_nudge' | 'review_approved' | 'review_rejected'. */
  kind: string;
  titleEn: string;
  titleAr: string;
  bodyEn?: string | null;
  bodyAr?: string | null;
  /** Deep-link path opened from the bell / push, e.g. `/bookings/{id}`. */
  url?: string | null;
  imageUrl?: string | null;
}): Promise<void> {
  try {
    await prisma.customerNotification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        bodyEn: input.bodyEn ?? null,
        bodyAr: input.bodyAr ?? null,
        url: input.url ?? null,
        imageUrl: input.imageUrl ?? null,
      },
    });
  } catch (err) {
    log.error('notify inbox row failed', { userId: input.userId, ...errFields(err) });
  }
  await pushToUser(input.userId, {
    titleEn: input.titleEn,
    titleAr: input.titleAr,
    bodyEn: input.bodyEn,
    bodyAr: input.bodyAr,
    url: input.url ?? undefined,
    iconUrl: input.imageUrl,
    tag: input.kind,
  }).catch(() => {});
}

export interface CustomerNotificationRow {
  id: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string | null;
  bodyAr: string | null;
  imageUrl: string | null;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
}

const LIST_LIMIT = 30;

const ROW_SELECT = {
  id: true,
  titleEn: true,
  titleAr: true,
  bodyEn: true,
  bodyAr: true,
  imageUrl: true,
  url: true,
  readAt: true,
  createdAt: true,
} as const;

export async function listForUser(
  userId: string,
): Promise<{ rows: CustomerNotificationRow[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.customerNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: ROW_SELECT,
    }),
    prisma.customerNotification.count({ where: { userId, readAt: null } }),
  ]);
  return { rows, unread };
}

/** Fetch a single notification, scoped to its owner (null if not theirs). */
export async function getForUser(
  userId: string,
  id: string,
): Promise<CustomerNotificationRow | null> {
  return prisma.customerNotification.findFirst({
    where: { id, userId },
    select: ROW_SELECT,
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.customerNotification.count({ where: { userId, readAt: null } });
}

/** Mark the given ids (or all) read for this user. No-op on already-read rows. */
export async function markRead(userId: string, ids: string[] | 'all'): Promise<void> {
  await prisma.customerNotification.updateMany({
    where: { userId, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}
