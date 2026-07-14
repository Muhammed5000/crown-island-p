import 'server-only';
import type { Prisma, NotificationAudience } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { sendPush } from '@/server/push/web-push';
import { log, errFields } from '@/lib/log';

/**
 * Broadcast-notification dispatch.
 *
 * A campaign fans out into two channels:
 *   1. one `CustomerNotification` inbox row per recipient (the bell + page), and
 *   2. a web-push message to each recipient's `PushSubscription`s.
 *
 * Dispatch is **best-effort per push** — one dead/erroring subscription never
 * aborts the broadcast (mirrors the transactional email design). Dead
 * subscriptions (HTTP 404/410) are pruned as we go.
 */

export interface AudienceSpec {
  audience: NotificationAudience;
  /** Set when audience = TAG. */
  tagId?: string | null;
  /** User ids when audience = SPECIFIC. */
  recipientUserIds?: string[];
}

/** Active, non-blocked customers — the only valid recipients. */
function audienceWhere(spec: AudienceSpec): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = { role: 'CUSTOMER', deletedAt: null, blockedAt: null };
  if (spec.audience === 'TAG') {
    where.tagAssignments = { some: { tagId: spec.tagId ?? '__none__' } };
  } else if (spec.audience === 'SPECIFIC') {
    where.id = { in: spec.recipientUserIds ?? [] };
  }
  return where;
}

/** Resolve a campaign's audience to concrete, still-active customer ids. */
export async function resolveAudienceUserIds(spec: AudienceSpec): Promise<string[]> {
  if (spec.audience === 'SPECIFIC' && (spec.recipientUserIds ?? []).length === 0) return [];
  if (spec.audience === 'TAG' && !spec.tagId) return [];
  const rows = await prisma.user.findMany({ where: audienceWhere(spec), select: { id: true } });
  return rows.map((r) => r.id);
}

/** Estimated recipient count for the compose-time preview. */
export async function countAudience(spec: AudienceSpec): Promise<number> {
  if (spec.audience === 'SPECIFIC' && (spec.recipientUserIds ?? []).length === 0) return 0;
  if (spec.audience === 'TAG' && !spec.tagId) return 0;
  return prisma.user.count({ where: audienceWhere(spec) });
}

export interface DispatchResult {
  recipients: number;
  pushSent: number;
  pushFailed: number;
}

const INBOX_CHUNK = 500;
const PUSH_CONCURRENCY = 10;

/**
 * Web push payloads have a ~4 KB ceiling and the OS only renders a few lines, so
 * the PUSH body is capped. The FULL description is always stored on the inbox
 * row and shown in full on the in-app notification detail page — only the push
 * alert (which the user taps to open that full detail) is shortened.
 */
const PUSH_BODY_MAX = 500;
function truncatePushBody(text: string): string {
  return text.length > PUSH_BODY_MAX ? `${text.slice(0, PUSH_BODY_MAX - 1)}…` : text;
}

/**
 * Dispatch a single campaign now. Sets it SENDING → SENT (or FAILED on error).
 * Safe to call on a DRAFT or SCHEDULED campaign; callers guard the status.
 */
export async function dispatchCampaign(
  campaignId: string,
  opts?: { preclaimed?: boolean },
): Promise<DispatchResult> {
  const campaign = await prisma.notificationCampaign.findUnique({
    where: { id: campaignId },
    include: { recipients: { select: { userId: true } } },
  });
  if (!campaign) throw new Error('campaign_not_found');

  // Atomically CLAIM the campaign — UNLESS the caller already claimed it. The
  // scheduler (dispatchDueScheduledCampaigns) pre-claims SCHEDULED → SENDING for
  // its double-trigger guard, so it passes preclaimed:true; re-claiming here
  // would see the row already SENDING, match 0 rows, and silently drop the send.
  // For the direct (manual) callers the row is still DRAFT/SCHEDULED/FAILED, so
  // the claim runs and blocks a concurrent dispatch / stray re-send.
  if (!opts?.preclaimed) {
    const claim = await prisma.notificationCampaign.updateMany({
      where: { id: campaignId, status: { notIn: ['SENT', 'SENDING'] } },
      data: { status: 'SENDING' },
    });
    if (claim.count !== 1) {
      return { recipients: 0, pushSent: 0, pushFailed: 0 };
    }
  }

  let recipients = 0;
  let pushSent = 0;
  let pushFailed = 0;

  try {
    const userIds = await resolveAudienceUserIds({
      audience: campaign.audience,
      tagId: campaign.tagId,
      recipientUserIds: campaign.recipients.map((r) => r.userId),
    });
    recipients = userIds.length;

    // 1) Inbox rows — one per recipient.
    if (userIds.length > 0) {
      // Idempotency: clear any inbox rows left by a prior failed/partial dispatch
      // of THIS campaign so a re-send (a FAILED campaign is re-sendable) can never
      // duplicate them — there is no unique (userId, campaignId) key to dedupe on.
      await prisma.customerNotification.deleteMany({ where: { campaignId: campaign.id } });
      const now = new Date();
      const rows = userIds.map((userId) => ({
        userId,
        campaignId: campaign.id,
        kind: 'announcement',
        titleEn: campaign.titleEn,
        titleAr: campaign.titleAr,
        bodyEn: campaign.bodyEn,
        bodyAr: campaign.bodyAr,
        imageUrl: campaign.iconUrl,
        url: campaign.url,
        createdAt: now,
      }));
      for (let i = 0; i < rows.length; i += INBOX_CHUNK) {
        await prisma.customerNotification.createMany({ data: rows.slice(i, i + INBOX_CHUNK) });
      }
    }

    // 2) Web push — to every recipient's subscriptions, bounded concurrency.
    if (userIds.length > 0) {
      const subs = await prisma.pushSubscription.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, endpoint: true, p256dh: true, auth: true, locale: true },
      });
      const deadIds: string[] = [];
      for (let i = 0; i < subs.length; i += PUSH_CONCURRENCY) {
        const batch = subs.slice(i, i + PUSH_CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (s) => {
            const locale = s.locale === 'en' ? 'en' : 'ar';
            const res = await sendPush(
              { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
              {
                title: locale === 'en' ? campaign.titleEn : campaign.titleAr,
                body: truncatePushBody((locale === 'en' ? campaign.bodyEn : campaign.bodyAr) || ''),
                icon: campaign.iconUrl || undefined,
                // Deep link if set, else the in-app inbox so the push always
                // lands somewhere the customer can read the full notification.
                url: campaign.url || '/notifications',
                lang: locale,
                dir: locale === 'ar' ? 'rtl' : 'ltr',
                tag: `campaign-${campaign.id}`,
              },
            );
            return { id: s.id, res };
          }),
        );
        for (const { id, res } of results) {
          if (res.ok) {
            pushSent += 1;
          } else {
            pushFailed += 1;
            if (res.gone) deadIds.push(id);
          }
        }
      }
      if (deadIds.length > 0) {
        await prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
      }
    }

    await prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        recipientCount: recipients,
        pushSentCount: pushSent,
        pushFailCount: pushFailed,
      },
    });
  } catch (err) {
    log.error('notifications dispatch failed', { campaignId, ...errFields(err) });
    await prisma.notificationCampaign
      .update({ where: { id: campaignId }, data: { status: 'FAILED' } })
      .catch(() => {});
    throw err;
  }

  return { recipients, pushSent, pushFailed };
}

/**
 * Dispatch every campaign whose scheduled time has arrived. Each row is claimed
 * with an atomic `SCHEDULED → SENDING` update so a double cron-trigger (or two
 * workers) can never double-send the same campaign.
 */
export async function dispatchDueScheduledCampaigns(
  now: Date = new Date(),
): Promise<{ dispatched: number }> {
  const due = await prisma.notificationCampaign.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
    select: { id: true },
    orderBy: { scheduledAt: 'asc' },
    take: 50,
  });

  let dispatched = 0;
  for (const { id } of due) {
    const claim = await prisma.notificationCampaign.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: { status: 'SENDING' },
    });
    if (claim.count !== 1) continue; // already claimed by another trigger
    try {
      // We already claimed SCHEDULED → SENDING above; tell dispatchCampaign not
      // to re-claim (it would see SENDING and no-op, dropping the broadcast).
      await dispatchCampaign(id, { preclaimed: true });
      dispatched += 1;
    } catch {
      // dispatchCampaign already marked FAILED + logged.
    }
  }
  return { dispatched };
}
