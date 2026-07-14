import { cn } from '@/lib/cn';

interface Props {
  /** Light-mode logo URL (the category's primary `logoUrl`). */
  lightUrl: string;
  /** Dark-mode logo URL (`logoDarkUrl`); falls back to the light one. */
  darkUrl?: string | null;
  /** Classes applied to BOTH variant images (sizing, object-fit, etc). */
  className?: string;
  alt?: string;
}

/**
 * Theme-aware category logo. Renders both the light and dark variants and lets
 * CSS (`.logo-light-variant` / `.logo-dark-variant`, keyed off `data-theme`)
 * show whichever matches the active theme — so it works in Server Components
 * too, with no hydration flash. Plain `<img>` so SVG logos render (and they
 * don't need next/image optimisation). When no dark variant is set, the light
 * one is reused in dark mode as a best-effort fallback.
 */
export function CategoryLogo({ lightUrl, darkUrl, className, alt = '' }: Props) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={lightUrl} alt={alt} className={cn('logo-light-variant', className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={darkUrl || lightUrl} alt={alt} className={cn('logo-dark-variant', className)} />
    </>
  );
}
