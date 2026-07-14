'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { isMediaUrl } from '@/lib/media-url';
import {
  countAudience,
  dispatchCampaign,
  type AudienceSpec,
} from '@/server/services/admin-notifications';

/**
 * Admin Notification Manager server actions. Mirrors the catalog actions: every
 * action re-checks `requireAdmin()`, validates with zod, and returns a
 * discriminated-union error (or redirects on success). A campaign can be saved
 * as a draft, scheduled, or sent immediately (which fans out via
 * `dispatchCampaign`).
 */

export type NotificationActionResult = {
  ok: false;
  code: string;
  fields?: Record<string, string[]>;
};

const AUDIENCE = z.enum(['ALL', 'TAG', 'SPECIFIC']);
const INTENT = z.enum(['draft', 'send', 'schedule']);

const formSchema = z.object({
  titleEn: z.string().trim().min(1, 'Required').max(120),
  titleAr: z.string().trim().min(1, 'Required').max(120),
  bodyEn: z.string().trim().min(1, 'Required').max(2000),
  bodyAr: z.string().trim().min(1, 'Required').max(2000),
  // Flows into the inbox image + web-push icon (fetched client-side and by the
  // image optimizer), so require an uploaded path or a public URL — same SSRF
  // guard as every other media field.
  iconUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => isMediaUrl(v), { message: 'Enter a valid image URL or upload one.' })
    .optional()
    .nullable(),
  url: z.string().trim().max(500).optional().nullable(),
  audience: AUDIENCE,
  tagId: z.string().trim().max(64).optional().nullable(),
  recipientIds: z.array(z.string().max(64)).max(5000).default([]),
  intent: INTENT,
  scheduledAt: z.string().trim().max(40).optional().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

function parseForm(formData: FormData) {
  return formSchema.safeParse({
    titleEn: String(formData.get('titleEn') ?? ''),
    titleAr: String(formData.get('titleAr') ?? ''),
    bodyEn: String(formData.get('bodyEn') ?? ''),
    bodyAr: String(formData.get('bodyAr') ?? ''),
    iconUrl: (formData.get('iconUrl') as string | null)?.trim() || null,
    url: (formData.get('url') as string | null)?.trim() || null,
    audience: String(formData.get('audience') ?? 'ALL'),
    tagId: (formData.get('tagId') as string | null)?.trim() || null,
    recipientIds: formData.getAll('recipientIds').map(String).filter(Boolean),
    intent: String(formData.get('intent') ?? 'draft'),
    scheduledAt: (formData.get('scheduledAt') as string | null)?.trim() || null,
  });
}

/** Cross-field checks zod can't express cleanly. Returns field errors or null. */
function crossFieldErrors(v: FormValues): Record<string, string[]> | null {
  const errs: Record<string, string[]> = {};
  // SEC-001: must be a SAME-ORIGIN path. A single leading slash NOT followed by
  // another "/" or "\" — so protocol-relative "//evil.example/phish" (and the
  // "/\evil" variant some browsers treat as "//") are rejected, not just anything
  // lacking a leading slash. The service worker re-checks this at click time too.
  if (v.url && !/^\/(?![/\\])/.test(v.url)) {
    errs.url = ['Must be an internal path starting with a single "/" (e.g. /booking).'];
  }
  if (v.audience === 'TAG' && !v.tagId) errs.tagId = ['Choose a tag.'];
  if (v.audience === 'SPECIFIC' && v.recipientIds.length === 0) {
    errs.recipientIds = ['Pick at least one customer.'];
  }
  if (v.intent === 'schedule' && !v.scheduledAt) {
    errs.scheduledAt = ['Choose a date and time.'];
  }
  return Object.keys(errs).length ? errs : null;
}

/** Resolve the scheduled instant (server-local = Africa/Cairo in prod). */
function resolveScheduledAt(v: FormValues): Date | { error: string } | null {
  if (v.intent !== 'schedule') return null;
  const d = new Date(v.scheduledAt!);
  if (Number.isNaN(d.getTime())) return { error: 'Invalid date and time.' };
  if (d.getTime() < Date.now() - 60_000) return { error: 'Must be in the future.' };
  return d;
}

function payloadFromForm(v: FormValues, scheduledAt: Date | null) {
  return {
    titleEn: v.titleEn,
    titleAr: v.titleAr,
    bodyEn: v.bodyEn,
    bodyAr: v.bodyAr,
    iconUrl: v.iconUrl || null,
    url: v.url || null,
    audience: v.audience,
    tagId: v.audience === 'TAG' ? v.tagId : null,
    status: v.intent === 'schedule' ? ('SCHEDULED' as const) : ('DRAFT' as const),
    scheduledAt,
  };
}

const EDITABLE_STATUSES = new Set(['DRAFT', 'SCHEDULED', 'FAILED']);

export async function createNotificationAction(
  formData: FormData,
): Promise<NotificationActionResult | void> {
  const admin = await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: parsed.error.flatten().fieldErrors };
  }
  const v = parsed.data;
  const cross = crossFieldErrors(v);
  if (cross) return { ok: false, code: 'invalid_input', fields: cross };

  const sched = resolveScheduledAt(v);
  if (sched && 'error' in sched) {
    return { ok: false, code: 'invalid_input', fields: { scheduledAt: [sched.error] } };
  }

  const uniqueIds = Array.from(new Set(v.recipientIds));
  const campaign = await prisma.notificationCampaign.create({
    data: {
      ...payloadFromForm(v, sched),
      createdById: admin.id,
      recipients:
        v.audience === 'SPECIFIC'
          ? { create: uniqueIds.map((userId) => ({ userId })) }
          : undefined,
    },
  });

  if (v.intent === 'send') {
    try {
      await dispatchCampaign(campaign.id);
    } catch {
      // The campaign is saved and marked FAILED inside dispatchCampaign — surface
      // it so the admin knows customers were NOT notified, instead of redirecting
      // as if the broadcast had gone out.
      revalidatePath('/admin/notifications');
      return { ok: false, code: 'send_failed' };
    }
  }

  revalidatePath('/admin/notifications');
  redirect('/admin/notifications');
}

export async function updateNotificationAction(
  formData: FormData,
): Promise<NotificationActionResult | void> {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (!id) return { ok: false, code: 'not_found' };

  const existing = await prisma.notificationCampaign.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) return { ok: false, code: 'not_found' };
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return { ok: false, code: 'not_editable' };
  }

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: parsed.error.flatten().fieldErrors };
  }
  const v = parsed.data;
  const cross = crossFieldErrors(v);
  if (cross) return { ok: false, code: 'invalid_input', fields: cross };

  const sched = resolveScheduledAt(v);
  if (sched && 'error' in sched) {
    return { ok: false, code: 'invalid_input', fields: { scheduledAt: [sched.error] } };
  }

  const uniqueIds = Array.from(new Set(v.recipientIds));
  await prisma.$transaction([
    prisma.notificationCampaignRecipient.deleteMany({ where: { campaignId: id } }),
    prisma.notificationCampaign.update({
      where: { id },
      data: {
        ...payloadFromForm(v, sched),
        recipients:
          v.audience === 'SPECIFIC'
            ? { create: uniqueIds.map((userId) => ({ userId })) }
            : undefined,
      },
    }),
  ]);

  if (v.intent === 'send') {
    try {
      await dispatchCampaign(id);
    } catch {
      // Saved + marked FAILED inside dispatchCampaign; surface it instead of
      // redirecting as a false success so the admin can retry.
      revalidatePath('/admin/notifications');
      return { ok: false, code: 'send_failed' };
    }
  }

  revalidatePath('/admin/notifications');
  redirect('/admin/notifications');
}

export async function deleteNotificationAction(input: {
  id: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  await requireAdmin();
  const id = String(input?.id ?? '');
  if (!id) return { ok: false, code: 'not_found' };
  try {
    await prisma.notificationCampaign.delete({ where: { id } });
  } catch {
    return { ok: false, code: 'not_found' };
  }
  revalidatePath('/admin/notifications');
  return { ok: true };
}

export async function sendNotificationNowAction(input: {
  id: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  await requireAdmin();
  const id = String(input?.id ?? '');
  const existing = await prisma.notificationCampaign.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) return { ok: false, code: 'not_found' };
  if (existing.status === 'SENT' || existing.status === 'SENDING') {
    return { ok: false, code: 'already_sent' };
  }
  try {
    await dispatchCampaign(id);
  } catch {
    return { ok: false, code: 'send_failed' };
  }
  revalidatePath('/admin/notifications');
  return { ok: true };
}

export async function previewAudienceCountAction(
  spec: AudienceSpec,
): Promise<{ ok: true; count: number } | { ok: false; code: string }> {
  await requireAdmin();
  try {
    const count = await countAudience({
      audience: spec.audience,
      tagId: spec.tagId ?? null,
      recipientUserIds: spec.recipientUserIds ?? [],
    });
    return { ok: true, count };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

export type PickerCustomer = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};

export async function searchCustomersForPickerAction(
  q: string,
): Promise<{ ok: true; customers: PickerCustomer[] } | { ok: false; code: string }> {
  await requireAdmin();
  const term = (q ?? '').trim();
  try {
    const customers = await prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        deletedAt: null,
        blockedAt: null,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
                { profile: { is: { fullName: { contains: term, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { ok: true, customers };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}
