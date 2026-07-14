import { cn } from '@/lib/cn';

interface Props {
  /** Rendered width in px (the mark keeps its own aspect ratio). */
  size?: number;
  className?: string;
}

/**
 * Crown Island icon mark — crown + waves, no text. Theme-aware: the navy
 * variant shows in light theme, the cream variant in dark theme (CSS keyed off
 * `data-theme`, the same `.logo-light-variant`/`.logo-dark-variant` mechanism
 * used by {@link CategoryLogo}). Plain <img> keeps the SVG crisp.
 */
export function CrownIcon({ size = 30, className }: Props) {
  const style = { width: size, height: 'auto' as const };
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-icon.svg"
        alt=""
        style={style}
        className={cn('logo-light-variant', className)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-icon-light.svg"
        alt=""
        style={style}
        className={cn('logo-dark-variant', className)}
      />
    </>
  );
}
