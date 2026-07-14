/**
 * Resolve the Terms & Conditions to print on a booking's invoice.
 *
 * Category-specific terms win: `Category.termsEn` / `termsAr` are a JSON
 * `string[]` of bullet points authored per category in the admin panel. Only
 * when the booking's category has NO terms configured do we fall back to the
 * GLOBAL `Settings.termsEn` / `termsAr` (a single newline-delimited block, the
 * same text the /terms-gate shows). Returns `[]` when neither is configured so
 * the caller can omit the section entirely.
 *
 * Intentionally PURE — no DB access, no `server-only` — so it stays unit-testable
 * and reusable by any invoice surface (reception now, gate/scan via the same
 * invoice page).
 */

/** Coerce a stored JSON column (`Category.termsEn/termsAr`) into a clean string[]. */
function jsonToBullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
}

/** Split a global newline-delimited terms block into trimmed, bullet-free lines. */
function textToBullets(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*[••‣◦\-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

export interface InvoiceTermsCategory {
  termsEn: unknown;
  termsAr: unknown;
}

export interface InvoiceTermsSettings {
  termsEn: string | null;
  termsAr: string | null;
}

/**
 * Category-first, global-fallback terms for an invoice, localized.
 * @returns a normalized `string[]` of bullet points (possibly empty).
 */
export function resolveInvoiceTerms(
  category: InvoiceTermsCategory,
  settings: InvoiceTermsSettings,
  locale: 'ar' | 'en',
): string[] {
  const categoryTerms = jsonToBullets(locale === 'ar' ? category.termsAr : category.termsEn);
  if (categoryTerms.length > 0) return categoryTerms;
  return textToBullets(locale === 'ar' ? settings.termsAr : settings.termsEn);
}
