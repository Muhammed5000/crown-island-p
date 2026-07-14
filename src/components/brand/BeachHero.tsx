import Image from 'next/image';
import { cn } from '@/lib/cn';

interface Props {
  height?: number;
  /** Variant maps to a different curated image + overlay tone. */
  variant?: 'sunset' | 'cabana';
  className?: string;
}

/**
 * Wide beach/sunset hero image with a gradient fade to the page background.
 * Used as the top-of-page hero on the landing screen.
 *
 * The two URLs are stable Unsplash photo IDs from the design source, which
 * has already been whitelisted in next.config.mjs (`images.unsplash.com`).
 */
export function BeachHero({ height = 360, variant = 'sunset', className }: Props) {
  const src =
    variant === 'cabana'
      ? 'https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=900&q=70'
      : 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=70';

  return (
    <div
      style={{ height }}
      className={cn('relative w-full overflow-hidden bg-muted', className)}
    >
      <Image
        src={src}
        alt=""
        fill
        priority
        sizes="(max-width: 768px) 100vw, 50vw"
        className="object-cover transition-transform duration-[20s] ease-linear [animation:hero-zoom_20s_infinite_alternate] [filter:saturate(1.05)_brightness(0.9)]"
      />
      {/* `hero-zoom` keyframes live in `src/app/globals.css` so this file
          stays a server component (styled-jsx requires "use client"). */}
      {/* Gradient fade from transparent to the page navy at the bottom. */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-0',
          variant === 'cabana'
            ? 'bg-[linear-gradient(180deg,rgba(244,246,247,0.0)_0%,rgba(244,246,247,0.2)_40%,rgba(244,246,247,1)_100%)]'
            : 'bg-[linear-gradient(180deg,rgba(244,246,247,0.0)_0%,rgba(244,246,247,0.2)_40%,rgba(244,246,247,1)_100%)]',
        )}
      />
    </div>
  );
}
