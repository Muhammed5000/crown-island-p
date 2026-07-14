import { Tajawal, Playfair_Display, Cormorant_Garamond, Manrope } from 'next/font/google';

/**
 * Typography from the Claude Design handoff.
 *  - Tajawal — the design's single typeface. The "Crown Island Home (Arabic)"
 *    handoff loads `Tajawal:wght@300;400;500;700;800;900` and sets
 *    `font-family:"Tajawal",system-ui,sans-serif` on everything, including the
 *    "CROWN ISLAND" / "EL MONTAZAH" wordmark (800 / 500). We match that weight
 *    set exactly so headings, cards, and the brand all render in Tajawal.
 *  - Playfair Display — Latin luxury serif kept for the bilingual app's English
 *    display headings only (the Arabic design itself is Tajawal-only).
 *
 * `next/font` self-hosts the files so we don't ship a render-blocking
 * `fonts.googleapis.com` request and so the document keeps the same fonts
 * even when offline (PWA).
 */
export const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '700', '800', '900'],
  variable: '--font-arabic',
  display: 'swap',
  preload: true,
});

export const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
  preload: true,
});

/**
 * AURELIA-design typography (used by the redesigned `/booking` page):
 *  - Cormorant Garamond — luxury serif display, replaces Playfair on the
 *    redesigned screens for its more delicate, hospitality-magazine feel.
 *  - Manrope — geometric sans for body copy, eyebrows, and chips.
 *
 * Both are self-hosted via next/font; they live alongside the existing
 * Playfair + Tajawal so unrelated pages don't restyle.
 */
export const cormorantGaramond = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal'],
  variable: '--font-aurelia-display',
  display: 'swap',
});

export const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-aurelia-sans',
  display: 'swap',
});

export const fontVariables = `${tajawal.variable} ${playfair.variable} ${cormorantGaramond.variable} ${manrope.variable}`;
