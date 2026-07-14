import 'server-only';
import { unstable_cache } from 'next/cache';
import type { Prisma, ReviewStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { assertNotLocalNode } from '@/server/sync/node-guard';
import { DomainError } from './errors';
import { notifyCustomer } from './customer-notifications';
import {
  isValidRating,
  isValidComment,
  cleanComment,
  isBookingReviewable,
  publicReviewerName,
  buildDistribution,
} from './review-core';
import { resortDayKey } from '@/lib/date';
import { log, errFields } from '@/lib/log';

/**
 * Guest-review service — DB-aware orchestration over the pure rules in
 * `review-core.ts`. Customers submit one review per booking after their visit;
 * admins moderate; approved reviews (plus a per-service average) surface publicly
 * when `Settings.publicReviewsEnabled` is on. Public reads are cached under the
 * `reviews` tag; moderation + the master toggle revalidate it.
 */

export const REVIEWS_TAG = 'reviews';

// ── Customer: submit + read own ──────────────────────────────────────────────

/** Alert managers/admins to a low rating so they can follow up (best-effort). */
async function alertStaffLowRating(input: {
  rating: number;
  reference: string;
  guestName: string | null;
}): Promise<void> {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN', 'MANAGER', 'DIRECTOR'] }, deletedAt: null },
      select: { id: true },
    });
    if (staff.length === 0) return;
    await prisma.staffNotification.createMany({
      data: staff.map((s) => ({
        userId: s.id,
        kind: 'review_low_rating',
        title: `Low rating (${input.rating}★) — booking ${input.reference}`,
        body: input.guestName ? `From ${input.guestName}` : null,
      })),
    });
  } catch (err) {
    log.error('review low-rating staff alert failed', { ...errFields(err) });
  }
}

export async function createReview(input: {
  bookingId: string;
  userId: string;
  rating: number;
  comment: string;
}): Promise<{ id: string }> {
  if (!isValidRating(input.rating)) throw new DomainError('Invalid rating', 'invalid_rating', 400);
  if (!isValidComment(input.comment)) throw new DomainError('Invalid comment', 'invalid_comment', 400);

  const { review, reference, guestName } = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      select: {
        id: true,
        reference: true,
        userId: true,
        serviceId: true,
        status: true,
        user: { select: { role: true, name: true } },
        review: { select: { id: true } },
      },
    });
    if (!booking) throw new DomainError('Booking not found', 'not_found', 404);
    // Ownership: a customer may only review THEIR OWN booking.
    if (booking.userId !== input.userId) throw new DomainError('Not authorized', 'forbidden', 403);
    if (booking.review) throw new DomainError('Review already exists', 'review_exists', 409);
    const reviewable = isBookingReviewable({
      status: booking.status,
      userRole: booking.user.role,
      hasReview: false,
    });
    if (!reviewable) throw new DomainError('Booking not reviewable', 'not_reviewable', 400);

    const created = await tx.review.create({
      data: {
        bookingId: booking.id,
        userId: input.userId,
        serviceId: booking.serviceId,
        rating: input.rating,
        comment: cleanComment(input.comment),
        status: 'PENDING',
      },
      select: { id: true, rating: true, status: true },
    });
    await audit(tx, {
      actorUserId: input.userId,
      action: 'CREATE',
      entityType: 'Review',
      entityId: created.id,
      after: { rating: created.rating, status: created.status },
    });
    return { review: created, reference: booking.reference, guestName: booking.user.name };
  });

  // Post-commit best-effort: alert staff to a poor rating so they can act.
  if (input.rating <= 2) await alertStaffLowRating({ rating: input.rating, reference, guestName });

  return { id: review.id };
}

/** The customer's own review for a booking (null if none), for the detail page. */
export function getMyReview(bookingId: string, userId: string) {
  return prisma.review.findFirst({
    where: { bookingId, userId },
    select: { id: true, rating: true, comment: true, status: true, adminNote: true, createdAt: true },
  });
}

/**
 * Fire the "rate your visit" nudge for a booking the moment it is CONFIRMED —
 * an in-app inbox row + web push, deep-linked straight to the review form. Called
 * from the confirmation paths (online payment confirm, reception booking). It is:
 *  - best-effort — never throws into the confirmation flow;
 *  - idempotent — the atomic `reviewPromptedAt` claim runs it exactly once
 *    (also stops the daily post-visit sweep from re-nudging);
 *  - CUSTOMER-only — a walk-in reception booking is owned by staff, so there is
 *    no app account to notify; it is skipped without error.
 */
export async function promptBookingReview(bookingId: string): Promise<void> {
  try {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        reviewPromptedAt: true,
        user: { select: { role: true } },
        review: { select: { id: true } },
      },
    });
    if (!b || b.reviewPromptedAt || b.review || b.user.role !== 'CUSTOMER') return;
    // Claim atomically so a retry / concurrent confirm can never double-notify.
    const claim = await prisma.booking.updateMany({
      where: { id: b.id, reviewPromptedAt: null },
      data: { reviewPromptedAt: new Date() },
    });
    if (claim.count === 0) return;
    await notifyCustomer({
      userId: b.userId,
      kind: 'review_nudge',
      titleEn: 'How was your visit? Rate it',
      titleAr: 'كيف كانت زيارتك؟ قيّمها',
      bodyEn: 'Your booking is confirmed — tap to rate your visit and leave a comment.',
      bodyAr: 'تم تأكيد حجزك — اضغط لتقييم زيارتك وترك تعليق.',
      url: `/bookings/${b.id}`,
    });
  } catch (err) {
    log.error('review confirmation prompt failed', { bookingId, ...errFields(err) });
  }
}

// ── Admin: moderate + list + report ──────────────────────────────────────────

export async function moderateReview(input: {
  reviewId: string;
  adminUserId: string;
  status: Extract<ReviewStatus, 'APPROVED' | 'REJECTED'>;
  adminNote?: string | null;
}): Promise<{ userId: string; bookingId: string; status: ReviewStatus }> {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.review.findUnique({
      where: { id: input.reviewId },
      select: { id: true, status: true, userId: true, bookingId: true },
    });
    if (!existing) throw new DomainError('Review not found', 'not_found', 404);
    const updated = await tx.review.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        adminNote: input.adminNote?.trim() || null,
        reviewedById: input.adminUserId,
        reviewedAt: new Date(),
      },
      select: { status: true },
    });
    await audit(tx, {
      actorUserId: input.adminUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Review',
      entityId: existing.id,
      before: { status: existing.status },
      after: { status: updated.status, adminNote: input.adminNote?.trim() || null },
    });
    return { userId: existing.userId, bookingId: existing.bookingId, status: updated.status };
  });

  // Best-effort, post-commit: tell the customer the outcome.
  if (result.status === 'APPROVED') {
    await notifyCustomer({
      userId: result.userId,
      kind: 'review_approved',
      titleEn: 'Your review is live',
      titleAr: 'تم نشر تقييمك',
      bodyEn: 'Thank you! Your review is now visible to other guests.',
      bodyAr: 'شكراً لك! أصبح تقييمك مرئياً للضيوف الآخرين.',
      url: `/bookings/${result.bookingId}`,
    });
  } else {
    await notifyCustomer({
      userId: result.userId,
      kind: 'review_rejected',
      titleEn: 'Review not published',
      titleAr: 'لم يُنشر تقييمك',
      bodyEn: input.adminNote?.trim()
        ? `Your review wasn't published: ${input.adminNote.trim()}`
        : "Your review wasn't published.",
      bodyAr: input.adminNote?.trim()
        ? `لم يتم نشر تقييمك: ${input.adminNote.trim()}`
        : 'لم يتم نشر تقييمك.',
      url: `/bookings/${result.bookingId}`,
    });
  }
  return result;
}

export interface AdminReviewFilters {
  q?: string;
  status?: ReviewStatus;
  rating?: number;
  serviceId?: string;
  sort?: 'recent' | 'lowest' | 'highest';
  page?: number;
  pageSize?: number;
}

export async function listAdminReviews(input: AdminReviewFilters) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = input.pageSize ?? 20;
  const where: Prisma.ReviewWhereInput = {};
  if (input.status) where.status = input.status;
  if (input.rating) where.rating = input.rating;
  if (input.serviceId) where.serviceId = input.serviceId;
  const q = input.q?.trim();
  if (q) {
    where.OR = [
      { comment: { contains: q, mode: 'insensitive' } },
      { user: { name: { contains: q, mode: 'insensitive' } } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { booking: { reference: { contains: q, mode: 'insensitive' } } },
    ];
  }
  const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
    input.sort === 'lowest'
      ? [{ rating: 'asc' }, { createdAt: 'desc' }]
      : input.sort === 'highest'
        ? [{ rating: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        rating: true,
        comment: true,
        status: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        service: {
          select: {
            nameEn: true,
            nameAr: true,
            category: { select: { nameEn: true, nameAr: true } },
          },
        },
        booking: { select: { reference: true } },
      },
    }),
    prisma.review.count({ where }),
  ]);
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Full review + booking/guest context for the admin detail page. */
export function getAdminReview(id: string) {
  return prisma.review.findUnique({
    where: { id },
    select: {
      id: true,
      rating: true,
      comment: true,
      status: true,
      adminNote: true,
      createdAt: true,
      reviewedAt: true,
      user: { select: { name: true, email: true } },
      service: {
        select: {
          nameEn: true,
          nameAr: true,
          category: { select: { nameEn: true, nameAr: true } },
        },
      },
      booking: { select: { id: true, reference: true, bookingDate: true } },
    },
  });
}

/**
 * Ratings dashboard + reports data. All metrics derive from ONE in-range query
 * and are aggregated in JS (mirrors `getRevenueReport` in admin-reports.ts) so
 * that an optional `categoryId` filter scopes EVERY metric uniformly — average,
 * distribution, trend, and the per-service / per-category breakdowns. Reviews
 * are low-volume, so the full-range fetch is cheap.
 */
export async function getReviewsReport(range: { from: Date; toExclusive: Date; categoryId?: string }) {
  const where: Prisma.ReviewWhereInput = {
    createdAt: { gte: range.from, lt: range.toExclusive },
    ...(range.categoryId ? { service: { categoryId: range.categoryId } } : {}),
  };

  const reviews = await prisma.review.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      rating: true,
      status: true,
      comment: true,
      createdAt: true,
      user: { select: { name: true } },
      service: {
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          category: { select: { id: true, nameEn: true, nameAr: true } },
        },
      },
      booking: { select: { reference: true } },
    },
  });

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const total = reviews.length;
  let sum = 0;
  let approved = 0;
  const ratingCounts = new Map<number, number>();
  const dayMap = new Map<string, { sum: number; count: number }>();
  const svcMap = new Map<
    string,
    { serviceId: string; nameEn: string; nameAr: string; categoryNameEn: string; categoryNameAr: string; sum: number; count: number }
  >();
  const catMap = new Map<string, { categoryId: string; nameEn: string; nameAr: string; sum: number; count: number }>();

  for (const r of reviews) {
    sum += r.rating;
    if (r.status === 'APPROVED') approved += 1;
    ratingCounts.set(r.rating, (ratingCounts.get(r.rating) ?? 0) + 1);

    const day = resortDayKey(r.createdAt); // TIME-001: Cairo civil day, matching revenue reports
    const d = dayMap.get(day) ?? { sum: 0, count: 0 };
    d.sum += r.rating;
    d.count += 1;
    dayMap.set(day, d);

    const svc = r.service;
    const cat = r.service.category;
    const s =
      svcMap.get(svc.id) ??
      {
        serviceId: svc.id,
        nameEn: svc.nameEn,
        nameAr: svc.nameAr,
        categoryNameEn: cat.nameEn,
        categoryNameAr: cat.nameAr,
        sum: 0,
        count: 0,
      };
    s.sum += r.rating;
    s.count += 1;
    svcMap.set(svc.id, s);

    const c = catMap.get(cat.id) ?? { categoryId: cat.id, nameEn: cat.nameEn, nameAr: cat.nameAr, sum: 0, count: 0 };
    c.sum += r.rating;
    c.count += 1;
    catMap.set(cat.id, c);
  }

  const recentLow = reviews
    .filter((r) => r.rating <= 2)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      status: r.status,
      user: { name: r.user.name },
      service: {
        nameEn: r.service.nameEn,
        nameAr: r.service.nameAr,
        category: { nameEn: r.service.category.nameEn, nameAr: r.service.category.nameAr },
      },
      booking: { reference: r.booking.reference },
    }));

  return {
    average: total ? round1(sum / total) : 0,
    total,
    approved,
    approvalRate: total ? Math.round((approved / total) * 100) : 0,
    distribution: buildDistribution([...ratingCounts.entries()].map(([rating, count]) => ({ rating, count }))),
    trend: [...dayMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({ date, avg: round1(v.sum / v.count), count: v.count })),
    byService: [...svcMap.values()]
      .map((s) => ({
        serviceId: s.serviceId,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        categoryNameEn: s.categoryNameEn,
        categoryNameAr: s.categoryNameAr,
        avg: round1(s.sum / s.count),
        count: s.count,
      }))
      .sort((a, b) => b.count - a.count),
    byCategory: [...catMap.values()]
      .map((c) => ({
        categoryId: c.categoryId,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        avg: round1(c.sum / c.count),
        count: c.count,
      }))
      .sort((a, b) => b.count - a.count),
    recentLow,
  };
}

// ── Public: per-service summary + list (cached, gated by the master toggle) ───

async function publicEnabled(): Promise<boolean> {
  const s = await prisma.settings.findUnique({
    where: { id: 'default' },
    select: { publicReviewsEnabled: true },
  });
  return s?.publicReviewsEnabled ?? true;
}

/** Current state of the public-review master switch (fresh; for the admin toggle). */
export function getPublicReviewsEnabled(): Promise<boolean> {
  return publicEnabled();
}

/** Flip the public-review master switch (admin). Audited; caller revalidates the tag. */
export async function setPublicReviewsEnabled(enabled: boolean, adminUserId: string): Promise<void> {
  assertNotLocalNode('The public-reviews switch');
  await prisma.$transaction(async (tx) => {
    const before = await tx.settings.findUnique({
      where: { id: 'default' },
      select: { publicReviewsEnabled: true },
    });
    await tx.settings.upsert({
      where: { id: 'default' },
      update: { publicReviewsEnabled: enabled },
      create: { publicReviewsEnabled: enabled },
    });
    await audit(tx, {
      actorUserId: adminUserId,
      action: 'UPDATE',
      entityType: 'Settings',
      entityId: 'default',
      before: { publicReviewsEnabled: before?.publicReviewsEnabled ?? null },
      after: { publicReviewsEnabled: enabled },
    });
  });
}

async function fetchServiceRatingSummary(serviceId: string) {
  if (!(await publicEnabled())) {
    return { enabled: false, average: 0, count: 0, distribution: buildDistribution([]) };
  }
  const rows = await prisma.review.groupBy({
    by: ['rating'],
    where: { serviceId, status: 'APPROVED' },
    _count: { _all: true },
  });
  const count = rows.reduce((s, r) => s + r._count._all, 0);
  const sum = rows.reduce((s, r) => s + r.rating * r._count._all, 0);
  return {
    enabled: true,
    average: count ? Math.round((sum / count) * 10) / 10 : 0,
    count,
    distribution: buildDistribution(rows.map((r) => ({ rating: r.rating, count: r._count._all }))),
  };
}

/** Cached public rating summary for a service (avg + count + distribution). */
export function getServiceRatingSummary(serviceId: string) {
  return unstable_cache(() => fetchServiceRatingSummary(serviceId), ['reviews:summary', serviceId], {
    tags: [REVIEWS_TAG],
    revalidate: 300,
  })();
}

async function fetchPublicReviews(serviceId: string, page: number) {
  if (!(await publicEnabled())) {
    return { enabled: false, items: [], total: 0, page, totalPages: 0 };
  }
  const pageSize = 8;
  const where: Prisma.ReviewWhereInput = { serviceId, status: 'APPROVED' };
  const [rows, total] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, rating: true, comment: true, createdAt: true, user: { select: { name: true } } },
    }),
    prisma.review.count({ where }),
  ]);
  return {
    enabled: true,
    items: rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      reviewer: publicReviewerName(r.user?.name),
    })),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Cached public review list for a service (APPROVED only, paginated). */
export function listPublicReviews(serviceId: string, page = 1) {
  return unstable_cache(() => fetchPublicReviews(serviceId, page), ['reviews:list', serviceId, String(page)], {
    tags: [REVIEWS_TAG],
    revalidate: 300,
  })();
}
