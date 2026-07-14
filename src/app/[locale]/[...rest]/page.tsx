import { notFound } from 'next/navigation';

/**
 * Catch-all route for any path that doesn't match a real page under `[locale]`.
 *
 * With next-intl's `localePrefix: 'as-needed'`, an unknown URL (e.g. `/totally-wrong`)
 * is rewritten into the `[locale]` segment but matches no concrete route. Without this
 * catch-all, Next.js falls back to a bare root 404 instead of the styled, locale-aware
 * page in `app/[locale]/not-found.tsx`. Calling `notFound()` here hands rendering to that
 * boundary so every invalid URL under the site shows the proper Not Found page.
 */
export default function CatchAllNotFound() {
  notFound();
}
