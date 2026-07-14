/**
 * Strict, allow-list based validation for user-supplied external links.
 *
 * Restaurant partners type their own Facebook / Instagram / TikTok / website
 * URLs, and those links are rendered to every guest — so a hostile value here
 * is a phishing / malware vector ("trojan link"). The rules:
 *
 *  - Validation is done by **parsing** (`new URL()`), never by substring
 *    matching, so `facebook.com.evil.com` and `https://evil.com?x=facebook.com`
 *    are correctly rejected.
 *  - Only `http:` / `https:` survive — `javascript:`, `data:`, `file:`,
 *    `blob:`, `ftp:`, `chrome:`, `about:` and friends are all rejected by the
 *    protocol check.
 *  - Social links must land on the platform's real registrable domain (exact
 *    match or a true dot-boundary subdomain such as `www.` / `m.` / `vm.`).
 *  - Embedded credentials (`https://facebook.com@evil.com`) are rejected —
 *    the URL parser puts the real host right, but the rendered string is a
 *    classic lookalike trick, so we refuse to store it at all.
 *  - The normalised `url.toString()` (lower-cased host, https upgrade for
 *    socials) is what gets stored — never the raw input.
 *
 * Pure functions, no imports — usable from server actions, client forms and
 * unit tests alike (`npx tsx --test src/lib/safe-url.test.ts`).
 */

export type SocialPlatform = 'facebook' | 'instagram' | 'tiktok';

/**
 * Registrable domains accepted per platform. A hostname passes when it equals
 * one of these or ends with `.<domain>` (true subdomain on a dot boundary).
 */
const PLATFORM_DOMAINS: Record<SocialPlatform, string[]> = {
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  instagram: ['instagram.com', 'instagr.am'],
  tiktok: ['tiktok.com'],
};

/** Longest URL we are willing to store/render. */
const MAX_URL_LENGTH = 300;

export type SafeUrlResult =
  | { ok: true; url: string }
  | { ok: false; code: 'invalid_url' | 'bad_protocol' | 'wrong_domain' };

/**
 * Parse a user-typed link, tolerating a missing scheme ("facebook.com/page" →
 * "https://facebook.com/page"). Returns null when it cannot parse at all.
 */
function parseLoose(raw: string): URL | null {
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  // A bare "facebook.com/…" is a domain, not a scheme — give it https://.
  // Anything that already has a scheme (incl. javascript:, data:) is parsed
  // as-is so the protocol check below can reject it explicitly.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/** Shared structural checks for any externally-rendered http(s) link. */
function checkParsed(url: URL): SafeUrlResult | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'bad_protocol' };
  }
  // `https://facebook.com@evil.com` — the part before @ is credentials, the
  // real host is evil.com. Legitimate social/website links never carry
  // userinfo, so reject the whole shape instead of trying to be clever.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, code: 'invalid_url' };
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  // A public link must have a dotted hostname ("facebook.com", not "facebook"
  // or an empty host) — also kills schemes like `https://?x=1`.
  if (!host || !host.includes('.')) {
    return { ok: false, code: 'invalid_url' };
  }
  return null; // structurally fine — caller continues with domain policy
}

/** True when `host` IS `domain` or is a real dot-boundary subdomain of it. */
function isHostOnDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Validate + normalise a social profile link for one specific platform.
 * Empty input is the caller's business (optional fields) — pass non-empty.
 */
export function validateSocialUrl(raw: string, platform: SocialPlatform): SafeUrlResult {
  const url = parseLoose(raw);
  if (!url) return { ok: false, code: 'invalid_url' };

  const structural = checkParsed(url);
  if (structural) return structural;

  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  const allowed = PLATFORM_DOMAINS[platform].some((domain) => isHostOnDomain(host, domain));
  if (!allowed) return { ok: false, code: 'wrong_domain' };

  // Social platforms are https-only; upgrade any http:// the user typed.
  url.protocol = 'https:';
  url.hostname = host;
  return { ok: true, url: url.toString() };
}

/**
 * Validate + normalise a general website link: http(s) only, parseable,
 * credential-free, dotted hostname. Any domain is allowed — it's the
 * restaurant's own site — but every dangerous protocol/shape is rejected.
 */
export function validateWebsiteUrl(raw: string): SafeUrlResult {
  const url = parseLoose(raw);
  if (!url) return { ok: false, code: 'invalid_url' };

  const structural = checkParsed(url);
  if (structural) return structural;

  url.hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  return { ok: true, url: url.toString() };
}

/** Human-readable copy for each rejection code, per platform (English). */
export function safeUrlErrorMessage(
  code: Exclude<SafeUrlResult, { ok: true }>['code'],
  platform?: SocialPlatform,
): string {
  if (code === 'wrong_domain' && platform) {
    const domain = PLATFORM_DOMAINS[platform][0];
    return `This link must point to ${domain}.`;
  }
  if (code === 'bad_protocol') return 'Only http:// and https:// links are allowed.';
  return 'This does not look like a valid link.';
}
