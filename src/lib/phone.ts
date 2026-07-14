import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Default region for parsing bare national numbers (Egypt). A number typed
 * without a country code (e.g. "01001234567") is interpreted in this region.
 */
export const DEFAULT_PHONE_REGION: CountryCode = 'EG';

/**
 * Canonicalise a phone number to E.164 (e.g. "+201001234567").
 *
 * This is the ONE place phone numbers are normalised, used at BOTH write time
 * (persisting `User.phone` / `CustomerProfile.phone`) and check time
 * (`normIdentity('PHONE')` for the blocklist). Storing and comparing the same
 * canonical form is what stops equivalent formats ("+20 100…", "0100…",
 * "00201 00…") from defeating the ban list or the `phone @unique` constraint.
 *
 * Falls back to a digits-and-leading-plus form when the value can't be parsed,
 * so callers always get a stable comparable string. Returns '' for empty input.
 */
export function toE164(
  value: string | null | undefined,
  region: CountryCode = DEFAULT_PHONE_REGION,
): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const parsed = parsePhoneNumberFromString(raw, region);
  if (parsed && parsed.isValid()) return parsed.number; // E.164, e.g. +201001234567
  // Unparseable: strip everything except digits and a single leading '+', so at
  // least "+20 100 …" and "+20100…" still collapse to the same string.
  const plus = raw.startsWith('+') ? '+' : '';
  return plus + raw.replace(/\D/g, '');
}
