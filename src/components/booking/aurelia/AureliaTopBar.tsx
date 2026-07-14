import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/config';
import {
  NotificationCenter,
  type UpcomingBookingForNotification,
} from './NotificationCenter';

/**
 * AURELIA top bar — mirrors the prototype's `TopBar` but keeps the project's
 * own wordmark ("CROWN ISLAND") instead of inventing a new brand.
 *
 * The small mark on the left is a sun-meets-crown glyph that matches the
 * resort feel of the rest of the page without depending on the existing
 * navy/gold logo PNGs.
 */
interface Props {
  brandName: string;
  tagline: string;
  /** Two-letter monogram for the avatar circle (initials, "TU", etc). */
  initials: string;
  /** Profile photo URL — when set, the avatar shows the photo instead of initials. */
  imageUrl?: string | null;
  /** Display name — used as the avatar's accessible label / alt text. */
  userName?: string | null;
  /** User's upcoming bookings — drives the bell's notification panel. */
  notifications: UpcomingBookingForNotification[];
  locale: Locale;
  /** When false the avatar becomes a sign-in affordance pointing at /login. */
  isAuthenticated?: boolean;
}

export function AureliaTopBar({
  brandName,
  initials,
  imageUrl,
  userName,
  notifications,
  locale,
  isAuthenticated = true,
}: Props) {
  return (
    <div className="flex items-center justify-between px-5 pb-1 pt-1.5">
      {/* Full Crown Island wordmark (crown + CROWN ISLAND + EL MONTAZAH). Both
          theme variants render; CSS shows the one matching the active theme
          (.logo-*-variant, see globals.css): the navy logo on the light canvas,
          the cream logo on the dark canvas. */}
      <div className="flex min-w-0 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/crown-island-logo.svg"
          alt={brandName}
          className="logo-light-variant h-[50px] w-auto max-sm:h-[54px]"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/crown-island-logo-light.svg"
          alt={brandName}
          className="logo-dark-variant h-[50px] w-auto max-sm:h-[54px]"
        />
      </div>

      <div className="flex items-center gap-2.5">
        {isAuthenticated ? <NotificationCenter bookings={notifications} locale={locale} /> : null}
        <Link
          href={isAuthenticated ? '/settings' : '/login'}
          aria-label={isAuthenticated ? (userName ?? undefined) : 'Sign in'}
          className="inline-flex size-[34px] items-center justify-center overflow-hidden rounded-full border border-gold-400/60 bg-[linear-gradient(135deg,#1c2b40,#16304f)] font-aurelia-sans text-[12px] font-semibold tracking-[0.04em] text-primary-foreground transition-transform active:scale-95"
        >
          {isAuthenticated ? (
            imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- profile photos (OAuth / uploaded)
              <img
                src={imageUrl}
                alt={userName ?? ''}
                className="size-full rounded-full object-cover"
              />
            ) : (
              initials.toUpperCase().slice(0, 2)
            )
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M5 19.5c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          )}
        </Link>
      </div>
    </div>
  );
}

