/**
 * Small, pure string-formatting helpers.
 */

/**
 * Turn an i18n label key (e.g. `services.dayUse`, `booking.maxPeople`) into a
 * human-readable Title Case phrase: strips the known `services.` / `booking.`
 * namespace prefixes, then splits on separators + camelCase boundaries. Used as
 * a fallback label (e.g. at the reception desk) when no localized copy exists.
 */
export function humanizeLine(labelKey: string): string {
  const base = labelKey.replace(/^services\./, '').replace(/^booking\./, '');
  return base
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
