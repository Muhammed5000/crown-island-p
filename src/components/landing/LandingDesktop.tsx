import type { CSSProperties, ReactNode } from 'react';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { CrownLogo } from '@/components/brand/CrownLogo';

/**
 * Desktop landing hero — "Midnight Ocean" cinematic restraint.
 *
 * A single full-bleed photograph folded into deep obsidian with a clean
 * bottom-up wash, a confident serif headline, two refined CTAs, and a frosted
 * hairline tier strip. Everything arrives in one orchestrated, spring-eased
 * load (staggered `reveal` delays). Stays a server component — motion is
 * pure CSS. Reads correctly under LTR and RTL.
 */

const HERO_IMG =
  'https://images.unsplash.com/photo-1505228395891-9a51e7e86bf6?w=1700&q=80&auto=format&fit=crop';

interface Props {
  title: string;
  tagline: string;
  bookNow: string;
  signIn: string;
  caption: string;
  nav: { experiences: string; dining: string; contact: string };
  localeSwitcher?: ReactNode;
}

/** Small helper for the staggered entrance. */
const r = (delay: number): CSSProperties => ({ animationDelay: `${delay}ms` });

export function LandingDesktop({
  title,
  tagline,
  bookNow,
  signIn,
  caption,
  nav,
  localeSwitcher,
}: Props) {
  const navLinks = [nav.experiences, nav.dining, nav.contact];

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Full-bleed cinematic backdrop with a slow, near-imperceptible drift */}
      <div className="absolute inset-0 animate-[hero-zoom_28s_ease-out_forwards] motion-reduce:animate-none">
        <Image src={HERO_IMG} alt="" fill priority sizes="100vw" className="object-cover" />
      </div>

      {/* Folds: a clean bottom-up wash into obsidian + a soft top vignette.
          Calmer and more cinematic than stacked radials. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,15,22,0.72)_0%,rgba(10,15,22,0.28)_26%,rgba(10,15,22,0.5)_66%,rgba(244,246,247,0.92)_88%,rgba(244,246,247,1)_100%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(110%_70%_at_50%_-10%,rgba(227,191,115,0.07)_0%,transparent_50%)]"
      />

      {/* ── Top nav ── */}
      <header className="absolute inset-x-0 top-0 z-10 flex h-[80px] items-center gap-9 px-12">
        <div className="reveal" style={r(40)}>
          <CrownLogo size="sm" />
        </div>
        <div className="flex-1" />
        <nav className="reveal hidden items-center gap-9 2xl:flex" style={r(120)}>
          {navLinks.map((label) => (
            <span
              key={label}
              className="cursor-default whitespace-nowrap font-aurelia-sans text-[13px] font-medium tracking-[0.04em] text-aurelia-cream/65 transition-colors hover:text-aurelia-cream"
            >
              {label}
            </span>
          ))}
        </nav>
        <div className="reveal" style={r(160)}>
          {localeSwitcher}
        </div>
      </header>

      {/* Thin top hairline for structure */}
      <div aria-hidden className="absolute inset-x-12 top-[80px] z-10 h-px bg-white/[0.06]" />

      {/* ── Hero content ── */}
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-[56%] flex-col items-center px-10 text-center">
        <h1
          className="reveal max-w-[14ch] whitespace-nowrap font-aurelia-display text-[76px] font-medium leading-[0.9] tracking-[-0.025em] text-aurelia-cream [text-shadow:0_10px_60px_rgba(0,0,0,0.45)] 2xl:text-[104px]"
          style={r(300)}
        >
          {title}
        </h1>

        <p
          className="reveal mt-6 max-w-[44ch] font-aurelia-display text-[23px] font-light leading-relaxed tracking-[0.01em] text-aurelia-cream/80"
          style={r(400)}
        >
          {tagline}
        </p>

        <div className="reveal mt-11 flex items-center gap-4" style={r(500)}>
          <Link
            href="/booking"
            className="group flex items-center gap-2.5 whitespace-nowrap rounded-full bg-[linear-gradient(135deg,#ecd293_0%,#e3bf73_55%,#cba662_100%)] px-11 py-[18px] font-aurelia-sans text-[15px] font-semibold tracking-[0.01em] text-[#100b04] shadow-[0_14px_44px_-12px_rgba(227,191,115,0.5)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[3px] hover:shadow-[0_22px_56px_-14px_rgba(227,191,115,0.6)]"
          >
            {bookNow}
            <span aria-hidden className="text-[16px] transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 rtl:rotate-180">
              →
            </span>
          </Link>
          <Link
            href="/login"
            className="whitespace-nowrap rounded-full border border-white/15 bg-white/[0.04] px-9 py-[18px] font-aurelia-sans text-[15px] font-medium tracking-[0.01em] text-aurelia-cream backdrop-blur-xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[2px] hover:border-white/25 hover:bg-white/[0.08]"
          >
            {signIn}
          </Link>
        </div>
      </div>

      {/* ── Bottom caption ── */}
      <div className="absolute inset-x-0 bottom-0 px-12 pb-10">
        <div className="reveal text-center font-aurelia-sans text-[12px] tracking-[0.04em] text-muted-foreground" style={r(620)}>
          {caption}
        </div>
      </div>
    </div>
  );
}
