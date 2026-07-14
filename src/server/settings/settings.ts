import 'server-only';
import { cache } from 'react';
import { prisma } from '@/server/db/prisma';
import { BookingsDisabledError, SyncOfflineError } from '@/server/services/errors';
import { parseRefundTiers, type RefundTier } from '@/lib/refund-policy';
import { assertNotLocalNode } from '@/server/sync/node-guard';
import { isLocal } from '@/server/sync/config';

/**
 * Server-side access to the `Settings` singleton.
 *
 * Always one row, identified by `id = "default"`. The first read creates it
 * if it's missing so the app never crashes on a fresh DB. Updates run through
 * `updateSettings()` which writes an `AuditLog` row alongside the change.
 *
 * Caching strategy — IMPORTANT:
 *   We deliberately do NOT keep a module-level mutable cache. In Next.js's
 *   dev runtime, server actions and page renders can evaluate the same
 *   module in separate module graphs, so a `let cached = …` here would
 *   diverge between the admin "save" path and the booking flow — the admin
 *   would update one copy, the customer flow would read another. That bug
 *   was the symptom users hit when toggles like `bookingsEnabled`,
 *   `bookingLeadTimeHours`, and `cancellationCutoffHours`
 *   "didn't take effect".
 *
 *   Instead, we wrap the read with `React.cache()` which memoises **per
 *   request** (one render, one DB query, regardless of how many call sites
 *   in the same tree). The next request — including the very next call
 *   after `updateSettings()` returns and `revalidatePath` fires — gets a
 *   fresh DB read. The DB is the single source of truth; no in-process
 *   mirror to keep in sync.
 *
 *   Cost: one tiny single-row SQLite query per request. Negligible.
 *
 * Callers that want the *resolved* value (DB override + env fallback) should
 * use the small `resolve*` helpers — e.g. `resolveSiteName()` — to keep the
 * lookup logic in one place.
 */

const SETTINGS_ID = 'default';

export interface SettingsRow {
  id: string;
  siteName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  adminNotifyEmail: string | null;
  defaultCurrency: string;
  defaultLocale: string;
  bookingLeadTimeHours: number;
  cancellationCutoffHours: number;
  holdTtlMinutes: number;
  bookingsEnabled: boolean;
  sandboxMode: boolean;
  heroVideoUrl: string | null;
  heroPosterUrl: string | null;
  supportOpenDay: number;
  supportCloseDay: number;
  supportOpenTime: string;
  supportCloseTime: string;
  termsEn: string | null;
  termsAr: string | null;
  termsUpdatedAt: Date | null;
  refundPolicyEn: string | null;
  refundPolicyAr: string | null;
  refundPolicyUpdatedAt: Date | null;
  /** Raw JSON refund schedule; parse with `parseRefundTiers` / read via `getRefundTiers()`. */
  refundTiers: unknown;
  zkEnabled: boolean;
  zkServerUrl: string | null;
  zkServerPort: number | null;
  zkGuestDeptCode: string | null;
  updatedAt: Date;
  updatedById: string | null;
}

/**
 * Returns the singleton, creating it with defaults on first call.
 * Request-scoped memo via `React.cache()` — see file header for rationale.
 */
export const getSettings = cache(async (): Promise<SettingsRow> => {
  return prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
});

/**
 * Throws `BookingsDisabledError` when the admin maintenance toggle is off.
 * Call this at every server-side chokepoint that creates / advances a
 * booking so a stale browser tab can't sneak past the UI gate.
 */
export async function assertBookingsEnabled(): Promise<void> {
  const s = await getSettings();
  if (!s.bookingsEnabled) {
    throw new BookingsDisabledError();
  }
}

/**
 * The chokepoint for CREATING a booking. Enforces the admin maintenance toggle
 * AND, on the on-prem LOCAL node, connectivity to online — because online is the
 * sole booking writer, a new booking cannot be made while local is offline
 * (`SyncOfflineError`). Every other local feature (gate scan, check-in, ops, …)
 * stays available offline and syncs up when the link returns. On `online` / a
 * single APP_MODE-unset deployment this is exactly `assertBookingsEnabled`.
 */
export async function assertBookingWritesEnabled(): Promise<void> {
  await assertBookingsEnabled();
  if (isLocal()) {
    const state = await prisma.syncState.findUnique({ where: { key: 'online:reachable' } });
    if (state?.cursor !== '1') throw new SyncOfflineError();
  }
}

/**
 * Resolves the enforced refund SCHEDULE. Reads the singleton (request-cached)
 * and normalises the stored JSON through `parseRefundTiers`, which falls back to
 * the canonical `DEFAULT_REFUND_TIERS` when the column is NULL/malformed — so
 * refunds always have a safe schedule, even on a fresh DB.
 */
export async function getRefundTiers(): Promise<RefundTier[]> {
  const s = await getSettings();
  return parseRefundTiers(s.refundTiers);
}

/** Resolves the public site name: DB override wins, env name is fallback. */
export async function resolveSiteName(): Promise<string> {
  const s = await getSettings();
  return s.siteName || process.env.NEXT_PUBLIC_APP_NAME || 'Crown Island';
}

/**
 * Resolves the notification email used for new-booking alerts. Order:
 *   1. Settings.adminNotifyEmail
 *   2. ADMIN_BOOTSTRAP_EMAIL env var
 *   3. undefined (caller should no-op)
 */
export async function resolveAdminNotifyEmail(): Promise<string | undefined> {
  const s = await getSettings();
  return s.adminNotifyEmail || process.env.ADMIN_BOOTSTRAP_EMAIL || undefined;
}

export interface SettingsInput {
  siteName: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  adminNotifyEmail?: string | null;
  defaultCurrency: string;
  defaultLocale: 'ar' | 'en';
  bookingLeadTimeHours: number;
  cancellationCutoffHours: number;
  holdTtlMinutes: number;
  bookingsEnabled: boolean;
  sandboxMode?: boolean;
  heroVideoUrl?: string | null;
  heroPosterUrl?: string | null;
  supportOpenDay?: number;
  supportCloseDay?: number;
  supportOpenTime?: string;
  supportCloseTime?: string;
  zkEnabled?: boolean;
  zkServerUrl?: string | null;
  zkServerPort?: number | null;
  zkGuestDeptCode?: string | null;
}

/**
 * Update the singleton + write an audit row in one transaction. Pass the
 * actor's user id so the audit log knows who flipped which switch.
 */
export async function updateSettings(input: SettingsInput, actorUserId: string) {
  assertNotLocalNode('Site settings');
  const { audit } = await import('@/server/audit/audit');

  return prisma.$transaction(async (tx) => {
    const before = await tx.settings.findUnique({ where: { id: SETTINGS_ID } });
    const after = await tx.settings.upsert({
      where: { id: SETTINGS_ID },
      update: { ...input, updatedById: actorUserId },
      create: { id: SETTINGS_ID, ...input, updatedById: actorUserId },
    });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'Settings',
      entityId: SETTINGS_ID,
      before,
      after,
    });
    return after;
  });
}

/**
 * Updates the global Terms & Conditions. Sets `termsUpdatedAt` to the current
 * moment so all users are forced to re-accept.
 */
export async function updateTerms(
  input: { termsEn: string; termsAr: string },
  actorUserId: string,
) {
  assertNotLocalNode('The Terms & Conditions');
  const { audit } = await import('@/server/audit/audit');

  return prisma.$transaction(async (tx) => {
    const before = await tx.settings.findUnique({ where: { id: SETTINGS_ID } });
    const after = await tx.settings.upsert({
      where: { id: SETTINGS_ID },
      update: {
        termsEn: input.termsEn,
        termsAr: input.termsAr,
        termsUpdatedAt: new Date(),
        updatedById: actorUserId,
      },
      create: {
        id: SETTINGS_ID,
        termsEn: input.termsEn,
        termsAr: input.termsAr,
        termsUpdatedAt: new Date(),
        updatedById: actorUserId,
      },
    });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'Settings',
      entityId: `${SETTINGS_ID}:terms`,
      before: { termsEn: before?.termsEn, termsAr: before?.termsAr },
      after: { termsEn: after.termsEn, termsAr: after.termsAr },
    });
    return after;
  });
}

/**
 * Updates the global Refund Policy. Sets `refundPolicyUpdatedAt` to the current
 * moment so all users are forced to re-accept — mirrors `updateTerms`.
 */
export async function updateRefundPolicy(
  input: { refundPolicyEn: string; refundPolicyAr: string },
  actorUserId: string,
) {
  assertNotLocalNode('The Refund Policy');
  const { audit } = await import('@/server/audit/audit');

  return prisma.$transaction(async (tx) => {
    const before = await tx.settings.findUnique({ where: { id: SETTINGS_ID } });
    const after = await tx.settings.upsert({
      where: { id: SETTINGS_ID },
      update: {
        refundPolicyEn: input.refundPolicyEn,
        refundPolicyAr: input.refundPolicyAr,
        refundPolicyUpdatedAt: new Date(),
        updatedById: actorUserId,
      },
      create: {
        id: SETTINGS_ID,
        refundPolicyEn: input.refundPolicyEn,
        refundPolicyAr: input.refundPolicyAr,
        refundPolicyUpdatedAt: new Date(),
        updatedById: actorUserId,
      },
    });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'Settings',
      entityId: `${SETTINGS_ID}:refundPolicy`,
      before: {
        refundPolicyEn: before?.refundPolicyEn,
        refundPolicyAr: before?.refundPolicyAr,
      },
      after: {
        refundPolicyEn: after.refundPolicyEn,
        refundPolicyAr: after.refundPolicyAr,
      },
    });
    return after;
  });
}

/**
 * Updates the enforced refund tier schedule. Persists the (already validated,
 * sorted) tiers to the JSON column and bumps `refundPolicyUpdatedAt` — changing
 * the numbers is a material policy change, so all users are forced to re-accept,
 * exactly like editing the policy text. Transactional + audited.
 */
export async function updateRefundTiers(tiers: RefundTier[], actorUserId: string) {
  assertNotLocalNode('Refund tiers');
  const { audit } = await import('@/server/audit/audit');

  return prisma.$transaction(async (tx) => {
    const before = await tx.settings.findUnique({ where: { id: SETTINGS_ID } });
    const after = await tx.settings.upsert({
      where: { id: SETTINGS_ID },
      update: {
        refundTiers: tiers,
        refundPolicyUpdatedAt: new Date(),
        updatedById: actorUserId,
      },
      create: {
        id: SETTINGS_ID,
        refundTiers: tiers,
        refundPolicyUpdatedAt: new Date(),
        updatedById: actorUserId,
      },
    });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'Settings',
      entityId: `${SETTINGS_ID}:refundTiers`,
      before: { refundTiers: before?.refundTiers ?? null },
      after: { refundTiers: after.refundTiers },
    });
    return after;
  });
}
