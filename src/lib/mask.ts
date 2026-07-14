/**
 * Mask a sensitive identifier (national ID / passport number) for display,
 * export and audit — keeps only the last 4 characters visible, e.g.
 * "29801011234567" → "**********4567". Returns an em dash for empty input.
 *
 * Shared by the admin export, the reporting sheets, and the guest-ID audit
 * writes so a raw government-ID number never lands anywhere readable offline.
 */
export function maskId(value: string | null | undefined): string {
  if (!value) return '—';
  const t = String(value).trim();
  if (!t) return '—';
  if (t.length <= 4) return '*'.repeat(t.length);
  return '*'.repeat(t.length - 4) + t.slice(-4);
}
