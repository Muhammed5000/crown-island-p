import { z } from 'zod';

/**
 * Media reference validation.
 *
 * The admin media uploader (`POST /api/admin/upload`) writes files under
 * `public/uploads/YYYY/MM/` and returns a **domain-agnostic, app-relative**
 * path like `/uploads/2026/06/ab12….jpg`. Relative paths are intentional — they
 * keep resolving across every environment (localhost, ngrok tunnel, prod) and
 * are served straight from `public/`.
 *
 * Form fields therefore accept either:
 *  - a relative upload path (`/uploads/...`) produced by our uploader, or
 *  - a fully-qualified `http(s)://` URL — an externally hosted image/video, or
 *    a YouTube/Vimeo embed link pasted into the field.
 *
 * Using a bare `z.string().url()` rejected freshly-uploaded files (their
 * relative path isn't an absolute URL), which is the bug this fixes.
 */
export function isMediaUrl(value: string): boolean {
  if (value.startsWith('/uploads/')) return true;
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      // SSRF guard: these URLs can be fetched server-side (e.g. by the next/image
      // optimizer), so reject loopback / IP-literal hosts that point at internal
      // or cloud-metadata services. Public DNS-named hosts are allowed.
      const host = u.hostname.toLowerCase();
      if (host === 'localhost' || host.endsWith('.localhost')) return false;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
      if (host.includes(':') || host.startsWith('[')) return false; // IPv6 literal
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

const DEFAULT_MESSAGE = 'Enter a full URL (https://…) or upload a file.';

/** Zod schema for a single uploaded-or-linked media reference. */
export function mediaUrl(message: string = DEFAULT_MESSAGE) {
  return z.string().refine(isMediaUrl, { message });
}
