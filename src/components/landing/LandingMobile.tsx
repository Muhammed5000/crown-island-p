import Image from 'next/image';
import { Link } from '@/i18n/navigation';

/**
 * Mobile / tablet landing — "Crown Welcome (Arabic Mobile)" design handoff.
 *
 * A full-bleed hero photograph that washes down into a cream sheet, a
 * crown-and-waves crest over the photo ("CROWN ISLAND / EL MONTAZAH"), then a
 * centred sheet with the headline, lead, a gold gradient "Book now" CTA, a
 * sign-in link and a footer caption. Shown below `xl` only — the desktop
 * landing (`LandingDesktop`) is a separate, cinematic layout left untouched.
 *
 * Server component: the only interactivity is locale/route Links. The design's
 * phone-mockup chrome (status bar, home indicator, JS `scale()` fit) is dropped;
 * this version is genuinely responsive to the real viewport.
 */

// Crown Welcome palette (from the handoff's :root tokens).
const CREAM = '#f6f1e7';
const INK = '#16294b';
const GOLD = '#c2a25c';
const GOLD_D = '#a8863f';
const GOLD_L = '#e7cd8e';
const LEAD = '#6f7480';
const FOOT = '#9a9ea8';
const LINE = 'rgba(22,41,75,.10)';

interface Props {
  locale: 'ar' | 'en';
  /** Headline (landing.heroTitle). */
  title: string;
  /** Sub-headline (landing.heroSubtitle). */
  tagline: string;
  /** Primary CTA label (landing.bookNow). */
  bookNow: string;
  /** Secondary link target — /login for guests, /bookings for signed-in users. */
  secondaryHref: string;
  /** Secondary link label. */
  secondaryLabel: string;
  /** Footer caption (auth.signInSubtitle). */
  caption: string;
}

export function LandingMobile({
  locale,
  title,
  tagline,
  bookNow,
  secondaryHref,
  secondaryLabel,
  caption,
}: Props) {
  const langs: ReadonlyArray<readonly ['ar' | 'en', string]> = [
    ['en', 'English'],
    ['ar', 'العربية'],
  ];

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden font-arabic"
      style={{ background: CREAM, color: INK }}
    >
      {/* ── Hero photograph, full-bleed, washing into the cream sheet ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[62dvh] min-h-[460px]">
        <Image
          src="/brand/welcome-hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg,rgba(16,30,52,.18) 0%,rgba(16,30,52,0) 26%,rgba(246,241,231,0) 58%,rgba(246,241,231,.72) 84%,#f6f1e7 100%)',
          }}
        />
      </div>

      {/* ── Foreground ── */}
      <div className="relative z-10 flex min-h-[100dvh] flex-col px-7 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
        {/* language toggle — glass pills over the photo */}
        <div className="flex justify-center">
          <div
            className="flex items-center gap-1 rounded-full p-[5px]"
            style={{
              background: 'rgba(255,255,255,.22)',
              border: '1px solid rgba(255,255,255,.45)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
            }}
          >
            {langs.map(([lc, label]) => {
              const active = locale === lc;
              return (
                <Link
                  key={lc}
                  href="/"
                  locale={lc}
                  className="rounded-full px-4 py-[7px] text-[13.5px] font-bold transition-colors"
                  style={active ? { background: '#fff', color: INK } : { color: '#fff' }}
                >
                  {label}
                </Link>
              );
            })}
            <span
              aria-hidden
              className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-white"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.6" />
                <path
                  d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"
                  stroke="#fff"
                  strokeWidth="1.6"
                />
              </svg>
            </span>
          </div>
        </div>

        {/* crest */}
        <div className="mt-9 flex flex-col items-center text-white">
          <svg width="150" height="63" viewBox="0 0 709.72 296.06" fill="none" aria-hidden>
            <path
              fill="#f3e7c8"
              d="M517.08,80.52c-9.13,0-16.54,7.4-16.54,16.54,0,4.61,1.89,8.77,4.93,11.77-20.75,31.51-42.18,48.07-54.27,43.12-9.32-3.81-11.9-19.89-12.56-31.75,5.84-.61,10.39-5.54,10.39-11.54,0-6.41-5.2-11.61-11.61-11.61s-11.61,5.2-11.61,11.61c0,3.88,1.91,7.3,4.83,9.41-10.19,19.24-19.78,28.62-28.77,28.07-16.58-1-31.14-35.65-43.67-103.91,7.78-1.55,13.65-8.41,13.65-16.64,0-9.37-7.6-16.97-16.97-16.97s-16.97,7.6-16.97,16.97c0,8.24,5.87,15.1,13.65,16.64-12.53,68.26-27.09,102.91-43.67,103.91-8.99.54-18.59-8.83-28.77-28.07,2.92-2.11,4.83-5.53,4.83-9.41,0-6.41-5.2-11.61-11.61-11.61s-11.61,5.2-11.61,11.61c0,6,4.55,10.93,10.39,11.54-.65,11.85-3.24,27.94-12.56,31.75-12.09,4.94-33.52-11.61-54.27-43.12,3.04-3,4.93-7.16,4.93-11.77,0-9.13-7.4-16.54-16.54-16.54s-16.54,7.4-16.54,16.54,7.4,16.54,16.54,16.54c.74,0,1.46-.06,2.17-.16,9.24,29.28,18.48,58.56,27.72,87.85,20.34-13.28,66.15-40.14,132.31-39.26,66.16-.88,111.98,25.98,132.31,39.26,9.24-29.28,18.48-58.56,27.72-87.85.71.09,1.43.16,2.17.16,9.13,0,16.54-7.4,16.54-16.54s-7.4-16.54-16.54-16.54Z"
            />
            <path
              fill="#5cb6b3"
              d="M470.96,232.59c-60.76-39.11-140.66-38.94-205.77-10.64-9.44,3.95-18.53,8.51-27.65,13.27-54.63,28.21-119.54,41.67-179.64,24.26-19.77-5.83-38.96-14.27-55.39-26.92,0,0,.94-1.13.94-1.13,70.99,39.48,157.69,27.54,227.39-9.33,9.33-4.79,19.04-9.59,28.74-13.53,49.48-20.39,106.35-25.25,157.38-7.72,19.85,7.04,39.09,16.52,54.87,30.55,0,0-.88,1.19-.88,1.19h0Z"
            />
            <path
              fill="#5cb6b3"
              d="M706.33,243.51c-40.33-19.55-86.77-26.01-131-19.84-34.14,4.37-66.8,16.82-97.06,32.96-47.33,24.32-102.6,37.27-155.63,27.59-31.06-5.92-61.87-18.54-84.76-40.73,0,0,.94-1.13.94-1.13,16.27,12.23,35.5,20.44,55.04,25.94,59.58,16.95,123.72,3.38,177.71-24.78,18.17-9.59,37.24-17.87,57.05-23.56,49.38-14.61,104.01-13.22,151.44,7.56,9.44,4.15,18.63,8.85,27.14,14.81l-.87,1.19h0Z"
            />
          </svg>
          <div
            className="mt-1.5 whitespace-nowrap text-[30px] font-extrabold leading-none [text-shadow:0_2px_20px_rgba(12,22,40,.35)]"
            style={{ letterSpacing: '.10em' }}
          >
            CROWN ISLAND
          </div>
          <div
            className="mt-2 text-[11px] font-medium [text-shadow:0_1px_10px_rgba(12,22,40,.4)]"
            style={{ letterSpacing: '.42em', color: 'rgba(255,255,255,.9)' }}
          >
            EL MONTAZAH
          </div>
        </div>

        {/* push the sheet to the bottom */}
        <div className="flex-1" />

        {/* content sheet */}
        <div className="flex flex-col items-center text-center">
          <h1
            className="m-0 text-[40px] font-extrabold leading-[1.05]"
            style={{ color: INK, letterSpacing: '-.01em' }}
          >
            {title}
          </h1>
          <p
            className="mx-auto mt-3.5 max-w-[300px] text-[15.5px] font-medium leading-[1.7]"
            style={{ color: LEAD }}
          >
            {tagline}
          </p>

          <Link
            href="/booking"
            className="mt-7 flex h-16 w-full items-center justify-center gap-3 rounded-[20px] text-[17px] font-extrabold text-white"
            style={{
              background: `linear-gradient(135deg, ${GOLD_L}, ${GOLD} 55%, ${GOLD_D})`,
              boxShadow: '0 16px 34px rgba(168,134,63,.34), inset 0 1px 0 rgba(255,255,255,.4)',
              letterSpacing: '.01em',
            }}
          >
            {bookNow}
            <span aria-hidden className="text-[20px] rtl:rotate-180">
              →
            </span>
          </Link>

          <Link href={secondaryHref} className="mt-[18px] text-[15px] font-bold" style={{ color: INK }}>
            <span style={{ borderBottom: `1.5px solid ${GOLD}`, paddingBottom: '2px' }}>
              {secondaryLabel}
            </span>
          </Link>

          <div
            className="mt-5 flex items-center gap-2.5 text-[12.5px] font-medium"
            style={{ color: FOOT }}
          >
            <span className="h-px w-[26px]" style={{ background: LINE }} />
            {caption}
            <span className="h-px w-[26px]" style={{ background: LINE }} />
          </div>
        </div>
      </div>
    </div>
  );
}
