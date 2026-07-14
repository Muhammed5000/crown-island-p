import 'server-only';
import { prisma } from '@/server/db/prisma';

/**
 * Per-category Terms & Conditions gate.
 *
 * A category may carry its own Terms & Policy bullet points (`Category.termsEn`
 * / `termsAr`). When it does, a SIGNED-IN customer must accept them before the
 * category's services unlock for booking. Guests are never gated here — they
 * can browse the catalog freely, and booking/payment already requires sign-in,
 * so terms are still enforced before any actual booking is made.
 *
 * Acceptance is recorded once per (user, category) in `CategoryTermsAcceptance`.
 * Editing the terms bumps `Category.termsUpdatedAt` (see admin-catalog), which
 * invalidates older acceptances and forces a re-accept of the new version.
 */

/** Coerce a stored JSON terms column into a clean `string[]` of bullet points. */
function bullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * The terms bullets to display for a category, in the visitor's locale. Falls
 * back to the other language when only one is filled so a single-language
 * terms list still gates and renders.
 */
export function categoryTermsBullets(
  termsEn: unknown,
  termsAr: unknown,
  locale: string,
): string[] {
  const ar = locale === 'ar';
  const primary = bullets(ar ? termsAr : termsEn);
  if (primary.length) return primary;
  return bullets(ar ? termsEn : termsAr);
}

/** Whether a category has any non-empty terms in either language. */
export function categoryHasTerms(termsEn: unknown, termsAr: unknown): boolean {
  return bullets(termsEn).length > 0 || bullets(termsAr).length > 0;
}

/**
 * Whether the signed-in user must (re-)accept this category's terms before its
 * services unlock.
 *
 * Returns `false` for guests and for categories with no terms. For a signed-in
 * user it returns `true` when there is no acceptance row yet, or when the terms
 * were updated after the user's last acceptance.
 *
 * NOTE: `termsUpdatedAt` is accepted as `Date | string` because the category is
 * usually read through the cached catalog layer, which JSON-serialises Dates to
 * ISO strings on cache hits (see src/server/repositories/catalog.ts).
 */
export async function needsCategoryTermsAcceptance(args: {
  userId: string | null | undefined;
  categoryId: string;
  hasTerms: boolean;
  termsUpdatedAt: Date | string | null;
}): Promise<boolean> {
  if (!args.userId || !args.hasTerms) return false;

  const acceptance = await prisma.categoryTermsAcceptance.findUnique({
    where: { userId_categoryId: { userId: args.userId, categoryId: args.categoryId } },
    select: { acceptedAt: true },
  });
  if (!acceptance) return true;

  if (args.termsUpdatedAt) {
    const updatedAt = new Date(args.termsUpdatedAt);
    if (!Number.isNaN(updatedAt.getTime()) && acceptance.acceptedAt < updatedAt) {
      return true;
    }
  }
  return false;
}
