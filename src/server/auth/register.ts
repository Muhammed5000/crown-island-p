import 'server-only';
import type { Prisma } from '@prisma/client';
import { hash as bcryptHash } from 'bcryptjs';
import { prisma } from '@/server/db/prisma';
import { isAnyIdentityBlocked } from '@/server/services/blocklist';
import { toE164 } from '@/lib/phone';
import { hashToken } from '@/server/auth/tokens';
import { isPrivilegedRole } from '@/server/auth/roles';

/**
 * Core of "complete registration" — shared by the web server action
 * (`src/features/auth/actions.ts#completeRegistration`, which signs the user
 * in with the cookie session afterwards) and the mobile API
 * (`/api/mobile/auth/register/complete`, which issues a bearer token instead).
 *
 * Inputs are expected to be ALREADY validated/normalised by the caller's Zod
 * schema (lowercased email, trimmed name/phone, password policy). The
 * security boundary lives here: the caller must present the RAW verification
 * token, which is claimed atomically (single-use, bound to the email) as the
 * proof of inbox possession, and banned identities can never register.
 */

export interface RegisterCustomerInput {
  email: string;
  fullName: string;
  phone: string;
  password: string;
  /**
   * Raw email-verification token from the magic link. It proves possession of
   * the inbox and is CLAIMED ATOMICALLY here (single-use, bound to this email)
   * as the authorization boundary — see the security note on the claim below.
   */
  token: string;
}

export type RegisterCustomerResult =
  | { ok: true; userId: string }
  | { ok: false; code: 'invalid_input' | 'email_taken' | 'phone_taken' };

/**
 * Map a Prisma unique-constraint violation (P2002) on the user write back to a
 * friendly result code. The email/phone pre-checks below are non-transactional,
 * so two concurrent registrations for the same not-yet-existing identity can
 * both pass the `findUnique` checks and then race to write — the DB `@unique`
 * constraint lets exactly one win and rejects the other with P2002. Without this
 * the loser would surface an opaque 500 instead of `email_taken`/`phone_taken`.
 * Returns null for any other error so the caller rethrows it unchanged.
 */
function mapUniqueViolation(err: unknown): RegisterCustomerResult | null {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  ) {
    const target = (err as { meta?: { target?: unknown } }).meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    if (fields.some((f) => f.toLowerCase().includes('phone'))) {
      return { ok: false, code: 'phone_taken' };
    }
    return { ok: false, code: 'email_taken' };
  }
  return null;
}

export async function registerCustomer(
  input: RegisterCustomerInput,
): Promise<RegisterCustomerResult> {
  const { email, fullName, password, token } = input;
  // Canonicalise the phone to E.164 ONCE here so the stored value, the phone
  // `@unique` key, and the blocklist check all use the same form — formatting
  // ("+20 100…", "0100…", "00201…") can no longer bypass the ban or uniqueness.
  // Shared by the web action and the mobile register route.
  const phone = toE164(input.phone);

  // The verification token is CLAIMED atomically inside the write transaction
  // below (not here) so that (a) an early duplicate/ban rejection doesn't burn a
  // valid link, and (b) the claim + account write commit or roll back together.

  // A banned email or phone cannot create an account (kept uniform with the
  // generic invalid_input so the ban isn't enumerable).
  if (
    await isAnyIdentityBlocked([
      { kind: 'EMAIL', value: email },
      { kind: 'PHONE', value: phone },
    ])
  ) {
    return { ok: false, code: 'invalid_input' };
  }

  const passwordHash = await bcryptHash(password, 12);

  // Look up any existing account for this address.
  // A password-less account — OAuth-only, or a registration that never
  // finished — is completed in place: we set the password + profile rather
  // than rejecting, because the token claim below proves ownership of the
  // inbox. An ARCHIVED (soft-deleted) account is reactivated in place for
  // the same reason. Only a LIVE account that ALREADY has a password is a true
  // duplicate.
  const existingByEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, deletedAt: true, blockedAt: true, role: true },
  });
  // A blocked (banned) account can NEVER be reactivated via re-registration —
  // the blocklist check above already rejects banned emails, but this is
  // defence in depth in case the BlockedIdentity row is somehow missing.
  if (existingByEmail?.blockedAt) return { ok: false, code: 'email_taken' };
  // AUTH-001: a PRIVILEGED (staff/admin) account must never be created or
  // reactivated through the customer registration path — not even when it is
  // archived (soft-deleted) or password-less. Controlling the inbox must not
  // grant staff access, and it must not clear `deletedAt`/reset the password of
  // a privileged account; privileged recovery is a separate audited flow. We
  // return the generic `email_taken` so the surface isn't enumerable.
  if (existingByEmail && isPrivilegedRole(existingByEmail.role)) {
    return { ok: false, code: 'email_taken' };
  }
  // A live password account is the only true duplicate. An archived one
  // (`deletedAt` set) falls through to the reactivation update below.
  if (existingByEmail?.passwordHash && !existingByEmail.deletedAt) {
    return { ok: false, code: 'email_taken' };
  }

  // Phone must be free — unless it already belongs to this same account.
  const existingByPhone = await prisma.user.findUnique({
    where: { phone },
    select: { id: true },
  });
  if (existingByPhone && existingByPhone.id !== existingByEmail?.id) {
    return { ok: false, code: 'phone_taken' };
  }

  // Claim the token + write the account atomically. The claim is a conditional
  // single-use update: it succeeds for EXACTLY ONE caller holding the raw token
  // for this email while it is unused and unexpired. Because it runs inside the
  // same transaction as the account write, a P2002 (concurrent duplicate) rolls
  // the claim back so a losing race doesn't burn the user's link. (AUTH-001)
  const claimToken = async (tx: Prisma.TransactionClient): Promise<boolean> => {
    const claim = await tx.emailVerificationToken.updateMany({
      where: {
        tokenHash: hashToken(token),
        email,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    return claim.count === 1;
  };

  try {
    if (existingByEmail) {
      // Complete (or reactivate) the existing account in place:
      //   - password-less OAuth / unfinished account → establish password login.
      //   - ARCHIVED (soft-deleted) account whose owner re-verified the inbox →
      //     clear `deletedAt` to restore it. (Banned + privileged accounts are
      //     excluded above.) Role is intentionally left untouched.
      const done = await prisma.$transaction(async (tx) => {
        if (!(await claimToken(tx))) return false;
        await tx.user.update({
          where: { id: existingByEmail.id },
          data: {
            deletedAt: null,
            emailVerified: new Date(),
            phone,
            name: fullName,
            passwordHash,
            profile: {
              upsert: {
                create: { fullName, phone, email },
                update: { fullName, phone, email },
              },
            },
          },
        });
        return true;
      });
      if (!done) return { ok: false, code: 'invalid_input' };
      return { ok: true, userId: existingByEmail.id };
    }

    const created = await prisma.$transaction(async (tx) => {
      if (!(await claimToken(tx))) return null;
      return tx.user.create({
        data: {
          email,
          emailVerified: new Date(),
          phone,
          name: fullName,
          passwordHash,
          role: 'CUSTOMER',
          profile: {
            create: {
              fullName,
              phone,
              email,
            },
          },
        },
        select: { id: true },
      });
    });
    if (!created) return { ok: false, code: 'invalid_input' };
    return { ok: true, userId: created.id };
  } catch (err) {
    const mapped = mapUniqueViolation(err);
    if (mapped) return mapped;
    throw err;
  }
}
