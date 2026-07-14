import 'server-only';
import { prisma } from '@/server/db/prisma';
import { getSessionUser } from '@/server/auth/guards';

export interface AgeGateResult {
  /** Whether the category's age requirement is satisfied. */
  allowed: boolean;
  /** Minimum age required (0 when the category has no restriction). */
  minAge: number;
  /** The signed-in customer's recorded age, or null when unknown / guest. */
  userAge: number | null;
  /** Whether anyone is signed in at all. */
  signedIn: boolean;
}

/**
 * Decide whether the current visitor may enter an age-restricted category.
 *
 * A category with no `minAge` (null or 0) is open to everyone. Otherwise the
 * visitor must be signed in AND have a recorded age ≥ minAge. Guests and users
 * with no age on file are blocked, since their age can't be verified — the gate
 * fails closed.
 */
export async function evaluateCategoryAgeGate(
  minAge: number | null | undefined,
): Promise<AgeGateResult> {
  const required = typeof minAge === 'number' && minAge > 0 ? minAge : 0;
  if (required === 0) {
    return { allowed: true, minAge: 0, userAge: null, signedIn: false };
  }

  const user = await getSessionUser();
  if (!user) {
    return { allowed: false, minAge: required, userAge: null, signedIn: false };
  }

  let userAge: number | null = null;
  try {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId: user.id },
      select: { age: true },
    });
    userAge = profile?.age ?? null;
  } catch {
    // Database unreachable — fail closed on a restricted category.
    return { allowed: false, minAge: required, userAge: null, signedIn: true };
  }

  return {
    allowed: userAge != null && userAge >= required,
    minAge: required,
    userAge,
    signedIn: true,
  };
}
