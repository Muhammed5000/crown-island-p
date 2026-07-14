'use server';

import { z } from 'zod';
import { hash as bcryptHash } from 'bcryptjs';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { signIn, signOut } from '@/server/auth';
import { prisma } from '@/server/db/prisma';
import { requireUser, getSessionUser } from '@/server/auth/guards';
import { consumeEmailAndIp, extractIp, formatRetryAfter } from '@/server/auth/rate-limit';
import {
  buildLink,
  EMAIL_VERIFICATION_TTL_MINUTES,
  PASSWORD_RESET_TTL_MINUTES,
  generateToken,
  hashToken,
  tokenExpiresAt,
} from '@/server/auth/tokens';
import { getEmailProvider } from '@/server/email/provider';
import {
  passwordResetTemplate,
  verifyEmailTemplate,
} from '@/server/email/templates';
import { AuthorizationError } from '@/server/services/errors';
import { isAnyIdentityBlocked } from '@/server/services/blocklist';
import { registerCustomer } from '@/server/auth/register';
import { closeWorkSessions } from '@/server/services/work-session';
import { isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';
import { isValidRegion } from '@/lib/regions';
import { toE164 } from '@/lib/phone';
import { safeRedirectPath } from '@/lib/auth/safe-redirect';
import { idColumns, isValidIdNumber } from '@/lib/national-id';
import { log, errFields } from '@/lib/log';


/**
 * Server actions exposed to the auth screens.
 *
 * Everything is validated with Zod, rate-limited per email + IP, and emits a
 * discriminated-union return so the UI can render localized error states
 * without sniffing strings.
 *
 * Privacy note: requests for "send link" always return `{ ok: true }` whether
 * the email exists or not. This prevents enumerating accounts via the response
 * shape. The rate limiter still applies in both branches, so abuse is bounded.
 */

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((s) => s.toLowerCase());

/** Reasonable password rule: 8+ chars, at least one letter + one digit. */
const passwordSchema = z
  .string()
  .min(8, { message: 'too_short' })
  .max(200, { message: 'too_long' })
  .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), { message: 'too_weak' });

async function getIp(): Promise<string | null> {
  const hs = await headers();
  return extractIp(hs);
}

/**
 * Resolve the request locale for transactional email bodies. Falls back to
 * English if the locale can't be resolved (e.g. a non-locale context such as the
 * mobile API), so the email always sends.
 */
async function getEmailLocale(): Promise<'ar' | 'en'> {
  try {
    return (await getLocale()) === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. OAuth sign-in (unchanged from prior version, kept here for one import site)
// ─────────────────────────────────────────────────────────────────────────

export async function signInWithProvider(
  provider: 'google' | 'facebook' | 'apple',
  next?: string,
) {
  // Sanitise `next` so a crafted ?next=//evil can't turn login into an open redirect.
  await signIn(provider, { redirectTo: safeRedirectPath(next) || '/booking' });
}

export async function signOutAction() {
  await signOut({ redirectTo: '/' });
}

/**
 * Sign-out for gate operators (STAFF / SECURITY). Returns them to the
 * email + password sign-in screen (`/admin/login`) rather than the public
 * home page, since the gate is staff-only and they must re-authenticate to
 * scan again. The locale is preserved so the login page renders in the same
 * language the operator was using.
 */
export async function signOutGateAction(locale?: string) {
  const loc = locale === 'ar' ? 'ar' : 'en';
  // End the operator's open shift before the JWT is dropped. Best-effort — a
  // failure here must never block sign-out.
  const user = await getSessionUser();
  if (user) await closeWorkSessions(user.id);
  await signOut({ redirectTo: `/${loc}/admin/login` });
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Email magic-link verification (new account creation)
// ─────────────────────────────────────────────────────────────────────────

const requestSchema = z.object({ email: emailSchema });

export type RequestEmailResult =
  | {
      ok: true;
      cooldownSeconds: number;
      /** Dev-only: the raw verification URL, so the page can offer a one-click
       *  jump without the user having to dig through the terminal log or rely on
       *  real inbox delivery. ALWAYS provided in development (so local testing
       *  never gets stuck when the configured provider — e.g. Resend's sandbox
       *  sender — accepts the request but doesn't actually deliver), and NEVER
       *  present in production. */
      devLink?: string;
      /** True when the email provider failed to send (network / API error) but
       *  we're in dev, so the action degraded into the link-on-page fallback
       *  instead of erroring. UI uses this to nudge the developer to check
       *  their RESEND_API_KEY. */
      providerDegraded?: boolean;
    }
  | {
      ok: false;
      code: 'invalid_email' | 'rate_limited' | 'email_send_failed';
      retryAfter?: string;
    };

/**
 * Step 1 of registration: visitor enters an email, we send them a magic link.
 *
 * If the email already belongs to an existing account, we still send the link
 * — but it routes to the sign-in completion screen on click (handled when the
 * token is consumed). This keeps the response uniform so attackers can't
 * enumerate accounts.
 */
export async function requestEmailVerification(
  input: unknown,
): Promise<RequestEmailResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_email' };

  const email = parsed.data.email;
  const ip = await getIp();

  const limit = await consumeEmailAndIp(email, ip);
  if (!limit.ok) {
    return {
      ok: false,
      code: 'rate_limited',
      retryAfter: formatRetryAfter(limit.retryAfterSeconds),
    };
  }

  // A banned email cannot begin sign-up. Return a normal-looking "sent" response
  // (no token created, no mail sent) so we don't reveal the address is blocked;
  // the completeRegistration gate below is the authoritative block anyway.
  if (await isAnyIdentityBlocked([{ kind: 'EMAIL', value: email }])) {
    return { ok: true, cooldownSeconds: limit.nextRetryAfterSeconds };
  }

  // Generate a single-use token and persist its hash.
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = tokenExpiresAt(EMAIL_VERIFICATION_TTL_MINUTES);

  await prisma.emailVerificationToken.create({
    data: {
      tokenHash,
      email,
      expiresAt,
      ipAddress: ip ?? null,
    },
  });

  const link = await buildLink('/auth/verify-email', { token: rawToken });

  // Send through the configured provider. Network / API failures from Resend
  // (or any other real provider) bubble up as a thrown error — we catch them
  // here so the entire login route doesn't crash with a server-rendered
  // ResendError. Behaviour by environment:
  //   - prod: a failed send is a hard failure; UI gets `email_send_failed`.
  //   - dev:  we degrade to the link-on-page fallback so the developer can
  //           still continue without a working email backend.
  let sendError: unknown = null;
  try {
    await getEmailProvider().send(
      verifyEmailTemplate({
        to: email,
        link,
        expiresInMinutes: EMAIL_VERIFICATION_TTL_MINUTES,
        locale: await getEmailLocale(),
      }),
    );
  } catch (err) {
    sendError = err;
    log.error('verify-email send failed', errFields(err));
  }

  const isDev = process.env.NODE_ENV !== 'production';
  if (sendError && !isDev) {
    return { ok: false, code: 'email_send_failed' };
  }

  return {
    ok: true,
    cooldownSeconds: limit.nextRetryAfterSeconds,
    // Always surface the link in development so local testing can complete the
    // flow regardless of the provider's behaviour — the mock prints to the
    // terminal, and a real provider (Resend's sandbox sender) may accept the
    // request yet never deliver to a non-owner address. Never exposed in prod.
    devLink: isDev ? link : undefined,
    providerDegraded: !!sendError,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Token consumption — used by the /auth/verify-email page
// ─────────────────────────────────────────────────────────────────────────

export type VerifyTokenResult =
  | { ok: true; email: string; status: 'new_user' | 'existing_user' }
  | { ok: false; code: 'invalid_or_expired' };

/**
 * Step 2 of registration: the user clicks the link. We validate the token and
 * tell the caller whether to send them to the registration form (new user) or
 * to the sign-in screen (account already exists).
 *
 * SECURITY (AUTH-001): this is a READ-ONLY routing check — it does NOT consume
 * the token. Consumption is a single-use atomic CLAIM performed in
 * `registerCustomer` when the completion form is POSTed with the raw token.
 * That matters because mail clients (Gmail, Outlook Safe Links, corporate
 * proxies) routinely *prefetch* links with a GET: if this GET consumed the
 * token, a prefetch could create "verified" state that an attacker who knows
 * only the victim's email could then redeem. By moving the single-use claim to
 * the POST and binding it to possession of the raw token, a prefetch authorizes
 * nothing, and knowing the email alone is no longer sufficient to register.
 */
export async function verifyEmailToken(rawToken: string): Promise<VerifyTokenResult> {
  if (typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 200) {
    return { ok: false, code: 'invalid_or_expired' };
  }

  const tokenHash = hashToken(rawToken);
  const now = Date.now();

  // Read-only: validate the token exists and is unexpired. We accept it whether
  // or not `usedAt` is set — the authoritative single-use gate is the atomic
  // claim at registration time, so re-rendering this page (or a prefetch) is
  // harmless and never blocks the real user.
  const result = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!result || result.expiresAt.getTime() < now) {
    return { ok: false, code: 'invalid_or_expired' };
  }

  // A banned email can never verify through (kept uniform with the expired path).
  if (await isAnyIdentityBlocked([{ kind: 'EMAIL', value: result.email }])) {
    return { ok: false, code: 'invalid_or_expired' };
  }

  // Route to registration unless a *password* account already owns this email.
  // OAuth-only accounts (and registrations that were never finished) have no
  // passwordHash, so we let the now-email-verified visitor establish password
  // login via the registration form instead of dead-ending them on a sign-in
  // screen they can't use. Only a fully-established password account is sent to
  // sign in.
  //
  // `deletedAt: null` matters: an archived (soft-deleted) account can't actually
  // authenticate — the credentials provider rejects `deletedAt` — so sending it
  // to the sign-in screen would dead-end the user. We treat it as a new
  // registration instead, which reactivates the account in place
  // (`registerCustomer`). Blocked accounts were already rejected above.
  const existing = await prisma.user.findFirst({
    where: { email: result.email, deletedAt: null },
    select: { passwordHash: true },
  });
  return {
    ok: true,
    email: result.email,
    status: existing?.passwordHash ? 'existing_user' : 'new_user',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Complete registration — set name + phone + password, then sign in
// ─────────────────────────────────────────────────────────────────────────

const registrationSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(20),
  password: passwordSchema,
  // Raw verification token carried from the magic-link click. Required — it is
  // the possession proof claimed atomically in `registerCustomer` (AUTH-001).
  token: z.string().min(16).max(200),
});

export type CompleteRegistrationResult =
  | { ok: true }
  | { ok: false; code: 'invalid_input' | 'email_taken' | 'phone_taken' | 'weak_password' };

/**
 * Step 3 of registration: visitor sets their profile + password. The `email`
 * and `token` are carried from the magic-link click; the server proves inbox
 * possession by ATOMICALLY CLAIMING the raw token for that email inside
 * `registerCustomer` (AUTH-001). Submitting only an email — with no valid,
 * unused, unexpired token — can no longer complete registration.
 */
export async function completeRegistration(
  input: unknown,
): Promise<CompleteRegistrationResult> {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    // Bubble up password-weakness specifically so the UI can show the rule.
    const flat = parsed.error.flatten();
    if (
      flat.fieldErrors.password?.some((m) => m === 'too_short' || m === 'too_weak' || m === 'too_long')
    ) {
      return { ok: false, code: 'weak_password' };
    }
    return { ok: false, code: 'invalid_input' };
  }

  const { email, fullName, phone, password, token } = parsed.data;

  // Shared registration core (also used by the mobile API). Handles the atomic
  // single-use token claim (possession proof), blocklist, duplicate checks and
  // the user/profile writes.
  const result = await registerCustomer({ email, fullName, phone, password, token });
  if (!result.ok) return { ok: false, code: result.code };

  // Sign them in immediately via the customer-password credentials provider.
  await signIn('customer-password', {
    email,
    password,
    redirectTo: '/booking',
  });

  // signIn throws NEXT_REDIRECT on success, but TS doesn't know that.
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Sign in with email + password (existing user)
// ─────────────────────────────────────────────────────────────────────────

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

export type SignInResult =
  | { ok: true }
  | { ok: false; code: 'invalid_credentials' | 'invalid_input' };

export async function signInWithEmail(input: unknown): Promise<SignInResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await signIn('customer-password', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeRedirectPath(parsed.data.next) || '/booking',
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    return { ok: false, code: 'invalid_credentials' };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Forgot password — send reset link
// ─────────────────────────────────────────────────────────────────────────

const forgotSchema = z.object({ email: emailSchema });

export type ForgotPasswordResult =
  | {
      ok: true;
      cooldownSeconds: number;
      /** Dev-only: see `RequestEmailResult.devLink`. Always undefined in prod. */
      devLink?: string;
      /** True when the configured provider failed but we degraded in dev. */
      providerDegraded?: boolean;
    }
  | {
      ok: false;
      code: 'invalid_email' | 'rate_limited' | 'email_send_failed';
      retryAfter?: string;
    };

/**
 * Always returns `ok: true` if the email format is valid, regardless of
 * whether a matching account exists. This is intentional — we don't want to
 * confirm to attackers which emails are registered.
 */
export async function requestPasswordReset(
  input: unknown,
): Promise<ForgotPasswordResult> {
  const parsed = forgotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_email' };

  const email = parsed.data.email;
  const ip = await getIp();

  const limit = await consumeEmailAndIp(email, ip);
  if (!limit.ok) {
    return {
      ok: false,
      code: 'rate_limited',
      retryAfter: formatRetryAfter(limit.retryAfterSeconds),
    };
  }

  // A banned identity must never receive a reset link — this mirrors every other
  // identity entry point (requestEmailVerification, verifyEmailToken,
  // registerCustomer, completeProfile), which all consult the authoritative
  // BlockedIdentity blocklist. Return a normal-looking "sent" response (no token,
  // no mail) so the block isn't enumerable.
  if (await isAnyIdentityBlocked([{ kind: 'EMAIL', value: email }])) {
    return { ok: true, cooldownSeconds: limit.nextRetryAfterSeconds };
  }

  let devLink: string | undefined;
  let sendError: unknown = null;
  // Archived (soft-deleted) OR blocked accounts are inert — never issue reset tokens for them.
  const user = await prisma.user.findFirst({ where: { email, deletedAt: null, blockedAt: null } });
  if (user) {
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = tokenExpiresAt(PASSWORD_RESET_TTL_MINUTES);

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        email,
        expiresAt,
        ipAddress: ip ?? null,
      },
    });

    const link = await buildLink('/auth/reset-password', { token: rawToken });
    try {
      await getEmailProvider().send(
        passwordResetTemplate({
          to: email,
          link,
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
          locale: await getEmailLocale(),
        }),
      );
    } catch (err) {
      sendError = err;
      log.error('reset-password send failed', errFields(err));
    }

    const isDev = process.env.NODE_ENV !== 'production';
    if (sendError && !isDev) {
      // Hard fail in prod — UI handles the email_send_failed code.
      return { ok: false, code: 'email_send_failed' };
    }
    // Always provide the link in development (mirrors requestEmailVerification)
    // so a reset can be completed locally even when real delivery doesn't happen.
    if (isDev) {
      devLink = link;
    }
  }
  // (If no user, we deliberately do nothing — but we still consumed an
  //  attempt above so brute force enumeration is bounded.)

  return {
    ok: true,
    cooldownSeconds: limit.nextRetryAfterSeconds,
    devLink,
    providerDegraded: !!sendError,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Reset password — consume reset token and update the hash
// ─────────────────────────────────────────────────────────────────────────

const resetSchema = z.object({
  token: z.string().min(16).max(200),
  password: passwordSchema,
});

export type ResetPasswordResult =
  | { ok: true }
  | {
      ok: false;
      code: 'invalid_or_expired' | 'weak_password' | 'invalid_input';
    };

/** Internal sentinel: abort (roll back) the reset transaction for a blocked/deleted account. */
class ResetAbort extends Error {}

export async function resetPassword(input: unknown): Promise<ResetPasswordResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    if (flat.fieldErrors.password?.length) return { ok: false, code: 'weak_password' };
    return { ok: false, code: 'invalid_input' };
  }

  const tokenHash = hashToken(parsed.data.token);
  const passwordHash = await bcryptHash(parsed.data.password, 12);

  const ok = await prisma.$transaction(async (tx) => {
    // AUTH-004: CLAIM the token atomically FIRST — a conditional single-use update
    // that flips `usedAt` from null only for the one caller that wins. Two
    // simultaneous submissions of the same link can no longer both succeed (the
    // loser matches 0 rows). Doing it before the password write also means a P2002
    // or a blocked-account abort below rolls the claim back with the transaction.
    const claim = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claim.count !== 1) return false;

    const token = await tx.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true },
    });
    if (!token) return false;

    // Re-validate the account at consumption time: the issuance filter
    // (`requestPasswordReset`) was only a snapshot, so a user blocked or
    // soft-deleted in the window between issuing and clicking the link must not
    // be able to set a working password. Throwing rolls back the claim.
    const account = await tx.user.findUnique({
      where: { id: token.userId },
      select: { blockedAt: true, deletedAt: true },
    });
    if (!account || account.blockedAt || account.deletedAt) {
      throw new ResetAbort();
    }

    await tx.user.update({
      where: { id: token.userId },
      // Bump the session epoch so every JWT minted before this reset fails
      // re-hydration — the canonical "my account was compromised" recovery flow
      // must evict any stolen/older sessions, not just set a new password.
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    return true;
  }).catch((err) => {
    // A blocked/deleted account aborts the claim (rolls back) and reports the same
    // generic invalid_or_expired as a bad token — never leak account state.
    if (err instanceof ResetAbort) return false;
    throw err;
  });

  if (!ok) return { ok: false, code: 'invalid_or_expired' };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Complete-profile (kept for backwards-compat with the legacy OAuth path)
//
// Some users may still arrive via OAuth without a phone. This action is
// unchanged from before.
// ─────────────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().min(6).max(20),
  countryCode: z.string().min(2).max(3),
  age: z.coerce.number().min(16).max(120).optional(),
  isHandicapped: z.coerce.boolean().optional().default(false),
  email: emailSchema,
  // Identity document — exactly one of national ID / passport, by type.
  idType: z.enum(['national', 'passport']),
  idNumber: z.string().trim().min(1).max(30),
  // Required user region (Egyptian governorate).
  region: z.string().trim().min(1).max(60),
}).superRefine((data, ctx) => {
  try {
    if (!isValidPhoneNumber(data.phone, data.countryCode as CountryCode)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' });
    }
  } catch {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' });
  }
  if (!isValidIdNumber(data.idType, data.idNumber)) {
    ctx.addIssue({ code: 'custom', path: ['idNumber'], message: 'invalid_id' });
  }
  if (!isValidRegion(data.region)) {
    ctx.addIssue({ code: 'custom', path: ['region'], message: 'invalid_region' });
  }
});

export async function completeProfile(formData: FormData) {
  const user = await requireUser();
  const parsed = profileSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
    countryCode: formData.get('countryCode') ?? 'EG',
    age: formData.get('age'),
    isHandicapped: formData.get('isHandicapped') === 'on',
    email: formData.get('email') ?? '',
    idType: formData.get('idType') ?? '',
    idNumber: formData.get('idNumber') ?? '',
    region: formData.get('region') ?? '',
  });
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    if (flat.fieldErrors.phone?.includes('invalid_phone')) {
      return { ok: false, error: 'invalid_phone' as const };
    }
    if (flat.fieldErrors.idNumber?.length) {
      return { ok: false, error: 'invalid_id' as const };
    }
    if (flat.fieldErrors.region?.length) {
      return { ok: false, error: 'invalid_region' as const };
    }
    // Email is mandatory to complete a profile. An empty or malformed value
    // fails `emailSchema` (min length + .email()), and is surfaced as a
    // dedicated code so the UI can tell the user exactly what's missing.
    if (flat.fieldErrors.email?.length) {
      return { ok: false, error: 'invalid_email' as const };
    }
    return { ok: false, error: 'invalid_input' as const };
  }
  const ids = idColumns(parsed.data.idType, parsed.data.idNumber);
  // Canonicalise to E.164 so the stored value + the phone @unique key + the ban
  // check all share one form (formatting can't bypass either).
  const phone = toE164(parsed.data.phone, parsed.data.countryCode as CountryCode);

  // A banned identity (email / phone / national-id / passport) cannot complete a
  // profile — this is the gate that stops a blocked person re-entering with a
  // new account that reuses any blocked identifier.
  if (
    await isAnyIdentityBlocked([
      { kind: 'EMAIL', value: parsed.data.email },
      { kind: 'PHONE', value: phone },
      { kind: 'NATIONAL_ID', value: ids.nationalId },
      { kind: 'PASSPORT', value: ids.passportId },
    ])
  ) {
    return { ok: false, error: 'invalid_input' as const };
  }

  // `parsed.data.email` is guaranteed to be a non-empty, valid, lowercased
  // address here — the schema rejects anything else above — so we write it
  // unconditionally. No `|| null` / `|| user.email` fallback: a profile can
  // never be completed without a real email on both the User and the
  // CustomerProfile.
  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          name: parsed.data.fullName,
          phone,
          email: parsed.data.email,
        },
      }),
      prisma.customerProfile.upsert({
        where: { userId: user.id },
        update: {
          fullName: parsed.data.fullName,
          phone,
          countryCode: parsed.data.countryCode,
          age: parsed.data.age,
          isHandicapped: parsed.data.isHandicapped,
          email: parsed.data.email,
          nationalId: ids.nationalId,
          passportId: ids.passportId,
          region: parsed.data.region,
        },
        create: {
          userId: user.id,
          fullName: parsed.data.fullName,
          phone,
          countryCode: parsed.data.countryCode,
          age: parsed.data.age,
          isHandicapped: parsed.data.isHandicapped,
          email: parsed.data.email,
          nationalId: ids.nationalId,
          passportId: ids.passportId,
          region: parsed.data.region,
        },
      }),
    ]);
  } catch (err) {
    // `User.email` and `User.phone` are both unique. Now that email is always
    // written, a value already owned by another account would raise P2002 —
    // surface a friendly field error instead of crashing the page.
    const target = (err as { code?: string; meta?: { target?: string[] | string } });
    if (target.code === 'P2002') {
      const fields = Array.isArray(target.meta?.target)
        ? target.meta?.target.join(',')
        : String(target.meta?.target ?? '');
      if (fields.includes('email')) return { ok: false, error: 'email_taken' as const };
      if (fields.includes('phone')) return { ok: false, error: 'phone_taken' as const };
    }
    return { ok: false, error: 'invalid_input' as const };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Update Profile (User Settings)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Settings-screen profile update. Unlike `completeProfile`, the identity
 * document + region are OPTIONAL here: when the form omits them we preserve the
 * existing values (they're enforced at onboarding via `completeProfile` + the
 * app-layout gate); when provided they're validated and updated.
 */
const settingsProfileSchema = z.object({
  fullName: z.string().min(2).max(120),
  phone: z.string().min(6).max(20),
  countryCode: z.string().min(2).max(3),
  age: z.coerce.number().min(16).max(120).optional(),
  isHandicapped: z.coerce.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  try {
    if (!isValidPhoneNumber(data.phone, data.countryCode as CountryCode)) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' });
    }
  } catch {
    ctx.addIssue({ code: 'custom', path: ['phone'], message: 'invalid_phone' });
  }
});

export async function updateProfileAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) throw new AuthorizationError();

  const parsed = settingsProfileSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
    countryCode: formData.get('countryCode') ?? 'EG',
    age: formData.get('age'),
    isHandicapped: formData.get('isHandicapped') === 'on',
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten();
    if (flat.fieldErrors.phone?.includes('invalid_phone')) {
      return { ok: false, error: 'invalid_phone' as const };
    }
    return { ok: false, error: 'invalid_input' as const };
  }

  // Identity document + region are optional on this screen — only validate and
  // update when the form actually sends them, so existing values are preserved.
  const idTypeRaw = String(formData.get('idType') ?? '');
  const idNumberRaw = String(formData.get('idNumber') ?? '').trim();
  const regionRaw = String(formData.get('region') ?? '').trim();

  const idRegionData: { nationalId?: string | null; passportId?: string | null; region?: string } = {};
  if (idNumberRaw) {
    const idType = idTypeRaw === 'passport' ? 'passport' : 'national';
    if (!isValidIdNumber(idType, idNumberRaw)) return { ok: false, error: 'invalid_id' as const };
    Object.assign(idRegionData, idColumns(idType, idNumberRaw));
  }
  if (regionRaw) {
    if (!isValidRegion(regionRaw)) return { ok: false, error: 'invalid_region' as const };
    idRegionData.region = regionRaw;
  }

  // Canonicalise to E.164 so the stored value, the phone @unique key, and the ban
  // check all use one form (formatting can't bypass either) — same as registration.
  const phone = toE164(parsed.data.phone, parsed.data.countryCode as CountryCode);

  // Don't let anyone set a banned phone / national-id / passport on a profile.
  if (
    await isAnyIdentityBlocked([
      { kind: 'PHONE', value: phone },
      { kind: 'NATIONAL_ID', value: idRegionData.nationalId },
      { kind: 'PASSPORT', value: idRegionData.passportId },
    ])
  ) {
    return { ok: false, error: 'invalid_input' as const };
  }

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          name: parsed.data.fullName,
          phone,
        },
      }),
      prisma.customerProfile.upsert({
        where: { userId: user.id },
        update: {
          fullName: parsed.data.fullName,
          phone,
          countryCode: parsed.data.countryCode,
          age: parsed.data.age,
          isHandicapped: parsed.data.isHandicapped,
          ...idRegionData,
        },
        create: {
          userId: user.id,
          fullName: parsed.data.fullName,
          phone,
          countryCode: parsed.data.countryCode,
          age: parsed.data.age,
          isHandicapped: parsed.data.isHandicapped,
          email: user.email,
          ...idRegionData,
        },
      }),
    ]);
    return { ok: true };
  } catch (err) {
    // Check if phone is taken by another user
    const dbErr = err as { code?: string };
    if (dbErr.code === 'P2002') return { ok: false, error: 'phone_taken' as const };
    return { ok: false, error: 'update_failed' as const };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 10. Update Password (User Settings)
// ─────────────────────────────────────────────────────────────────────────

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export async function updatePasswordAction(formData: FormData) {
  const user = await requireUser();
  
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten();
    if (flat.fieldErrors.newPassword?.length) return { ok: false, error: 'weak_password' as const };
    return { ok: false, error: 'invalid_input' as const };
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (!dbUser?.passwordHash) return { ok: false, error: 'password_not_set' as const };

  const { compare, hash } = await import('bcryptjs');
  const valid = await compare(parsed.data.currentPassword, dbUser.passwordHash);
  if (!valid) return { ok: false, error: 'incorrect_password' as const };

  const newHash = await hash(parsed.data.newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    // Bump the session epoch so other devices' sessions are evicted. This also
    // invalidates the current session, so the user is signed out and must sign in
    // again after changing their password (standard "password changed" behaviour).
    data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
  });

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// 11. Notification preferences (User Settings)
// ─────────────────────────────────────────────────────────────────────────

const notificationPrefsSchema = z.object({
  bookingUpdates: z.boolean(),
  reminders: z.boolean(),
  promotions: z.boolean(),
});

/**
 * Persist the customer's notification preferences. Booking updates + reminders
 * are stored on the profile; promotions reuses the existing `marketingOpt` flag.
 * The form sends each toggle as `on`/absent (standard checkbox semantics).
 */
export async function updateNotificationPrefsAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) throw new AuthorizationError();

  const parsed = notificationPrefsSchema.safeParse({
    bookingUpdates: formData.get('bookingUpdates') === 'on',
    reminders: formData.get('reminders') === 'on',
    promotions: formData.get('promotions') === 'on',
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' as const };

  try {
    await prisma.customerProfile.update({
      where: { userId: user.id },
      data: {
        notifyBookingUpdates: parsed.data.bookingUpdates,
        notifyReminders: parsed.data.reminders,
        marketingOpt: parsed.data.promotions,
      },
    });
    return { ok: true as const };
  } catch {
    return { ok: false, error: 'update_failed' as const };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 12. Account actions (sign out everywhere, close account)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sign out of all devices: bump the user's session epoch (`tokenVersion`) so
 * every existing JWT — including this one — is evicted on its next request (see
 * the jwt re-hydration `tokenVersion` guard in src/server/auth/index.ts). The
 * client follows up with a local `signOut()` so the current tab clears at once.
 */
export async function signOutEverywhereAction() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { tokenVersion: { increment: 1 } },
  });
  return { ok: true as const };
}

/**
 * Close (deactivate) the current account. Soft-deletes via `deletedAt` — the row
 * and all booking/payment history are preserved, but the account can no longer
 * authenticate (the auth provider + jwt guards reject a `deletedAt` row) and it
 * drops out of active listings. `tokenVersion` is bumped so the session is killed
 * everywhere. Signing back in with a social/magic-link provider un-archives it
 * (see the signIn callback). The client must call `signOut()` afterwards.
 *
 * Re-entry is NOT a silent passthrough, but NO important data is destroyed.
 * Clearing `termsAcceptedAt` forces the terms gate again, and clearing ONLY the
 * profile's `region` re-triggers the profile-completion review on return. The
 * identity documents (nationalId / passportId), the User row, and its bookings,
 * sanctions and blocklist linkage are all PRESERVED — so any sanction still
 * applies and history stays intact when the user signs back in (which only
 * clears `deletedAt`). We deliberately do NOT clear the identity, because that
 * is exactly what sanctions / the blocklist / gate history are keyed on; wiping
 * it would let a sanctioned user re-onboard with a clean profile.
 *
 * Customer-only: privileged accounts must be managed from /admin to avoid an
 * admin accidentally locking themselves out from the customer settings screen.
 */
export async function closeAccountAction() {
  const user = await requireUser();
  if (user.role !== 'CUSTOMER') return { ok: false, error: 'forbidden' as const };
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        deletedAt: new Date(),
        tokenVersion: { increment: 1 },
        // Re-accept the latest terms on next sign-in (consent only — not data).
        termsAcceptedAt: null,
      },
    }),
    // Re-trigger /profile/complete on return by clearing ONLY `region` (a benign
    // field the user re-confirms there). Identity docs stay so sanctions, the
    // blocklist and gate/booking history keep their linkage. updateMany is a
    // safe no-op if the profile row is somehow missing.
    prisma.customerProfile.updateMany({
      where: { userId: user.id },
      data: { region: null },
    }),
  ]);
  return { ok: true as const };
}
