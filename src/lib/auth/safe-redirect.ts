/**
 * Validate a post-auth redirect target is a safe, SAME-ORIGIN path.
 *
 * A naive `value.startsWith('/')` check is NOT enough: a protocol-relative URL
 * like `//evil.example` also starts with `/` yet sends the browser off-origin,
 * and browsers normalise backslashes (`/\evil.example`) to `/`. Either is an
 * open redirect when used as a post-login destination.
 *
 * Returns the path unchanged when it is safe, otherwise `undefined` (the caller
 * supplies its own default). The host is never touched, so dev/tunnel origins
 * are unaffected — only the *path* shape is validated.
 */
export function safeRedirectPath(path?: string | null): string | undefined {
  if (!path) return undefined;
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  // Must be a single-slash root-relative path…
  if (!trimmed.startsWith('/')) return undefined;
  // …not protocol-relative (`//host`) and not backslash-smuggled (`/\host`,
  // `\\host`), both of which browsers can resolve to a different origin.
  if (trimmed.startsWith('//') || trimmed.includes('\\')) return undefined;
  // Defence-in-depth: reject any leading scheme (`javascript:`, `data:`…).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
  return trimmed;
}
