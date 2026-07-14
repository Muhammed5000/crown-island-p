/**
 * Locale-aware "2h ago" / "3 days ago" formatter built on Intl.RelativeTimeFormat.
 * Pure + client-safe; shared by the customer notification bell and inbox page.
 */
export function relativeTime(date: Date | string, locale: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(0, 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return rtf.format(Math.round(diffMs / 86_400_000), 'day');
  return rtf.format(Math.round(diffMs / 2_592_000_000), 'month');
}
