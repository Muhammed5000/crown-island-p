import Image from 'next/image';
import { ArrowLeftIcon, ArrowRightIcon, CrownIcon, InfoIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

interface Props {
  slug: string;
  /** Two-word display title; rendered on two Playfair lines. */
  title: string;
  /** Single-line subtitle/tagline below the title. */
  subtitle?: string;
  /** Tailwind gradient classes used when no cover image is provided. */
  toneClass?: string;
  coverUrl?: string | null;
  href?: string;
  locale?: 'ar' | 'en';
  /** Accessible label for the primary book CTA. */
  actionLabel: string;
  /** Accessible label for the secondary "more info" button. */
  infoLabel: string;
  /**
   * Destination for the info button. When provided the corner info chip is
   * rendered as a `<Link>` to this page; otherwise the chip is hidden.
   */
  infoHref?: string;
  /** Visual variant — affects the warm/cool overlay tint. */
  variant?: 'sunset' | 'cabana';
}

/**
 * Full-size experience card matching the design's `ExperienceCard` (Screen 03):
 *
 *  - 200px tall, 16px radius, 1px gold border
 *  - Full-bleed photo with a diagonal warm-amber (or cool-cabana) overlay
 *  - Two-line Playfair serif title in gold (e.g. "CROWN" / "SURGE")
 *  - Round gold back-button pill at bottom-leading corner
 *
 * RTL-aware: the chevron flips so it always points "forward" in reading order.
 */
export function CategoryCard({
  title,
  subtitle,
  toneClass,
  coverUrl,
  href,
  locale = 'ar',
  actionLabel,
  infoLabel,
  infoHref,
  slug,
  variant = 'sunset',
}: Props) {
  const Chevron = locale === 'ar' ? ArrowLeftIcon : ArrowRightIcon;
  const targetHref = href ?? `/booking/${slug}`;

  // Default fallback if absolutely nothing is provided.
  const src =
    coverUrl ||
    'https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=1200&q=75';

  // Split into words for the stacked title — matches the design.
  const words = title.split(/\s+/);
  const word1 = words[0] ?? title;
  const word2 = words.slice(1).join(' ');

  // The card hosts two clickable regions (book + info), so the outer element
  // is a plain <article>. The main click area is an absolutely-positioned
  // Link layered above the decorative chrome but BELOW the info chip + book
  // pill, which sit on a higher z-index and capture their own clicks.
  return (
    <article
      className={cn(
        'group relative block h-[320px] overflow-hidden rounded-3xl border border-border bg-card',
        'shadow-card transition-all duration-700 hover:border-gold-400/50 hover:shadow-glow',
      )}
    >
      {/* Background Image with Parallax-like scale */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <Image
          src={src}
          alt=""
          fill
          priority
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-cover transition-transform duration-[1.5s] cubic-bezier(0.23, 1, 0.32, 1) group-hover:scale-110"
        />
      </div>

      {/* Mood Overlays */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-0 z-[1] opacity-60 transition-opacity duration-700 group-hover:opacity-40',
          variant === 'sunset'
            ? 'bg-gradient-to-br from-orange-900/40 via-transparent to-navy-950/80'
            : 'bg-gradient-to-br from-cyan-900/40 via-transparent to-navy-950/80',
        )}
      />

      {/* Dynamic Tone Layer */}
      {toneClass && (
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 z-[2] bg-gradient-to-br opacity-20 mix-blend-overlay transition-opacity duration-700 group-hover:opacity-30',
            toneClass,
          )}
        />
      )}

      {/* Vignette for legibility */}
      <div className="absolute inset-0 z-[3] bg-[linear-gradient(to_top,rgba(9,19,34,0.95)_0%,rgba(9,19,34,0.4)_40%,transparent_100%)]" />

      {/* Glass Inner Border */}
      <div className="absolute inset-0 z-[4] rounded-3xl ring-1 ring-inset ring-white/10 transition-all duration-700 group-hover:ring-white/20" />

      {/* Full-bleed clickable region → booking flow. Sits below the info chip
          + visible CTA pill so they can intercept their own clicks. */}
      <Link
        href={targetHref}
        aria-label={`${title} — ${actionLabel}`}
        className="absolute inset-0 z-[5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
      />

      {/* Top-end info chip — opens the about page. Only renders when the
          parent wires up `infoHref`, so callers stay opt-in. */}
      {infoHref ? (
        <Link
          href={infoHref}
          aria-label={`${title} — ${infoLabel}`}
          className={cn(
            'absolute top-4 end-4 z-20 inline-flex items-center gap-1.5 rounded-full',
            'border border-white/25 bg-black/45 px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cream',
            'backdrop-blur-md transition-all duration-300',
            'hover:-translate-y-0.5 hover:border-gold-400/60 hover:bg-black/60 hover:text-gold-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70',
          )}
        >
          <InfoIcon className="size-3.5" strokeWidth={2.5} aria-hidden />
          <span>{infoLabel}</span>
        </Link>
      ) : null}

      {/* Content */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end p-8">
        <div className="mb-4 transform transition-transform duration-700 group-hover:-translate-y-2">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-px w-8 bg-gold-400/60" />
            <p className="text-[10px] font-bold uppercase tracking-[0.5em] text-gold-300">
              {variant === 'sunset' ? 'EXPERIENCE' : 'RELAXATION'}
            </p>
          </div>
          <h2 className="font-display text-3xl font-black leading-tight tracking-tight text-white [text-shadow:0_4px_12px_rgba(0,0,0,0.5)]">
            <span className="block text-gold-400">{word1.toUpperCase()}</span>
            {word2 && <span className="block">{word2.toUpperCase()}</span>}
          </h2>
          {subtitle && (
            <p className="mt-3 line-clamp-2 text-sm font-medium leading-relaxed text-cream/80 [text-shadow:0_2px_4px_rgba(0,0,0,0.5)]">
              {subtitle}
            </p>
          )}
        </div>

        {/* Visible Book CTA — always shown, lifts on hover. Wrapper drops
            `pointer-events-none` so the pill itself is clickable; it does
            not need an own <Link> because the full-card overlay above
            already routes to the booking page. */}
        <div className="pointer-events-auto flex items-center gap-3">
          <span
            className={cn(
              'group/btn relative isolate inline-flex h-11 items-center gap-2.5 overflow-hidden rounded-full px-6',
              'text-[11px] font-bold uppercase tracking-[0.2em] text-[#2a1a05]',
              'transition-transform duration-300 ease-out group-hover:-translate-y-0.5',
            )}
            style={{
              background: 'linear-gradient(135deg, #f7e4a8 0%, #d4a557 100%)',
              boxShadow:
                '0 8px 20px -6px rgba(212, 165, 87, 0.6), inset 0 1px 0 0 rgba(255,244,214,0.85), inset 0 -1px 0 0 rgba(94,64,18,0.4)',
              border: '1px solid rgba(120, 82, 26, 0.55)',
            }}
          >
            <CrownIcon className="relative size-3.5" strokeWidth={2.5} aria-hidden />
            <span className="relative">{actionLabel}</span>
            <Chevron
              className="relative size-3.5 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
              strokeWidth={3}
              aria-hidden
            />
            {/* Shimmer sweep */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 opacity-0 transition-all duration-700 ease-out group-hover:left-[120%] group-hover:opacity-100"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
              }}
            />
          </span>
        </div>
      </div>
    </article>
  );
}
