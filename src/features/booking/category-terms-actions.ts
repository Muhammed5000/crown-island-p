'use server';

import { prisma } from '@/server/db/prisma';
import { getSessionUser } from '@/server/auth/guards';
import { categoryHasTerms } from '@/server/catalog/category-terms';

/**
 * Records that the current signed-in customer accepted a category's Terms &
 * Conditions, unlocking that category's services for booking.
 *
 * The acceptance row is keyed on (user, category) and upserted so a re-accept
 * after the terms changed just refreshes `acceptedAt`. The gate (the category /
 * service pages) re-reads this on the next request — the client refreshes the
 * route after a successful call — so no cache revalidation is required here.
 */
export async function acceptCategoryTermsAction(
  categoryId: string,
): Promise<{ ok: true } | { ok: false; code: 'unauthenticated' | 'invalid' | 'not_found' }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, code: 'unauthenticated' };
  if (typeof categoryId !== 'string' || categoryId.length === 0) {
    return { ok: false, code: 'invalid' };
  }

  // Only accept for a real, active category that actually carries terms — this
  // keeps the table free of acceptances for categories that can't be gated and
  // stops a crafted id from writing junk rows.
  const category = await prisma.category.findFirst({
    where: { id: categoryId, isActive: true },
    select: { id: true, termsEn: true, termsAr: true },
  });
  if (!category || !categoryHasTerms(category.termsEn, category.termsAr)) {
    return { ok: false, code: 'not_found' };
  }

  await prisma.categoryTermsAcceptance.upsert({
    where: { userId_categoryId: { userId: user.id, categoryId } },
    create: { userId: user.id, categoryId },
    update: { acceptedAt: new Date() },
  });

  return { ok: true };
}
