'use client';

import { useEffect, useId, useState } from 'react';
import { CornerDownLeftIcon, HeadsetIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { DeskCopy, DeskReservation } from './types';

/**
 * Right-side concierge brief — the wide-canvas rail from the AURELIA desktop
 * design. The "your reservations" block is fed by the user's real upcoming
 * bookings; the sun arc + weather + concierge note are the design's
 * atmospheric framing. Concierge / quick-arrangement actions route to the
 * existing in-app support surface rather than inventing a new one.
 */
interface Props {
  desk: DeskCopy;
  reservations: DeskReservation[];
  initialNowM?: number;
}

export function DeskBrief({ desk, reservations, initialNowM }: Props) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col gap-7 border-s border-border px-6 py-8">
      {/* Sun + weather */}
      <div>
        <div className="mb-3.5 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {desk.briefWeatherLabel}
        </div>
        <SunArc
          detail={desk.briefWeatherDetail}
          temp={desk.temperature !== undefined ? `${desk.temperature}°` : undefined}
          sunriseM={desk.sunriseMinutes ?? SUNRISE_M}
          sunsetM={desk.sunsetMinutes ?? SUNSET_M}
          initialNowM={initialNowM}
        />
      </div>

      {/* Today's reservations */}
      <div>
        <div className="mb-3.5 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {desk.briefReservationsLabel}
        </div>
        {reservations.length > 0 ? (
          <>
            <div className="flex flex-col gap-2">
              {reservations.map((r) => (
                <BriefReservation key={r.id} reservation={r} />
              ))}
            </div>
            <Link
              href="/bookings/history"
              className="mt-2.5 block w-full rounded-[10px] border border-border bg-card px-3.5 py-2.5 text-start font-aurelia-sans text-[11.5px] tracking-[0.02em] text-muted-foreground transition hover:bg-muted"
            >
              {desk.briefViewAll}
            </Link>
          </>
        ) : (
          <p className="m-0 rounded-[12px] border border-border bg-card px-3.5 py-3.5 font-aurelia-sans text-[12px] leading-[1.5] text-muted-foreground">
            {desk.briefNoReservations}
          </p>
        )}
      </div>

      {/* Concierge */}
      <div>
        <div className="mb-3.5 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {desk.briefConciergeLabel}
        </div>
        <div className="rounded-[14px] border border-border bg-card p-[18px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-full bg-[linear-gradient(135deg,#c2a14e,rgba(194,161,78,0.6))] text-white">
              <HeadsetIcon className="size-4" strokeWidth={1.6} aria-hidden />
            </span>
            <div>
              <div className="font-aurelia-sans text-[12.5px] font-semibold text-foreground">
                {desk.briefConciergeName}
              </div>
              <div className="font-aurelia-sans text-[10.5px] text-muted-foreground">
                {desk.briefConciergeShift}
              </div>
            </div>
          </div>
          <p className="m-0 font-aurelia-display text-[14px] leading-[1.45] text-muted-foreground">
            {desk.briefConciergeMessage}
          </p>
          <Link
            href="/support"
            className="mt-3.5 flex items-center justify-between rounded-[10px] border border-border bg-card px-3.5 py-2.5 font-aurelia-sans text-[11.5px] text-muted-foreground transition hover:bg-muted"
          >
            <span>{desk.briefConciergeReply}</span>
            <CornerDownLeftIcon className="size-3.5 opacity-70" strokeWidth={1.6} aria-hidden />
          </Link>
        </div>
      </div>
    </aside>
  );
}

// Sunrise / sunset for the bay. Without a live ephemeris feed these stay fixed,
// but the marker that rides the arc tracks the real wall clock.
const SUNRISE_M = 5 * 60 + 56;
const SUNSET_M = 18 * 60 + 42;

const fmtClock = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Sun/moon-position arc. The arc itself is decorative framing; the marker rides
 * it using the real current time — a gold sun between sunrise and sunset, a
 * silver crescent moon overnight. Time is read on the client (after mount, then
 * once a minute) so server and first client render stay in sync.
 */
function SunArc({
  detail,
  temp,
  sunriseM,
  sunsetM,
  initialNowM,
}: {
  detail: string;
  temp?: string;
  sunriseM: number;
  sunsetM: number;
  initialNowM?: number;
}) {
  const maskId = useId();
  const [nowM, setNowM] = useState<number | null>(initialNowM ?? null);

  useEffect(() => {
    const update = () => {
      const d = new Date();
      setNowM(d.getHours() * 60 + d.getMinutes());
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  const isDay = nowM !== null && nowM >= sunriseM && nowM <= sunsetM;

  // Fraction travelled across the relevant arc (day: sunrise→sunset; night:
  // sunset→next sunrise), clamped to the arc ends.
  let progress = 0;
  if (nowM !== null) {
    if (isDay) {
      progress = (nowM - sunriseM) / (sunsetM - sunriseM);
    } else {
      const nightLen = 1440 - (sunsetM - sunriseM);
      const elapsed = nowM > sunsetM ? nowM - sunsetM : nowM + (1440 - sunsetM);
      progress = elapsed / nightLen;
    }
  }
  progress = Math.min(1, Math.max(0, progress));

  // Perfect semicircle centred at (130,95), radius 100 (progress 0 → left,
  // 1 → right). Coordinates are rounded to 2dp so the server- and client-
  // rendered SVG markup match exactly (no float-precision hydration mismatch).
  const angle = Math.PI * (1 - progress);
  const sx = Math.round((130 + 100 * Math.cos(angle)) * 100) / 100;
  const sy = Math.round((95 - 100 * Math.sin(angle)) * 100) / 100;

  return (
    <div>
      {/* viewBox extends above y=0 (top = -30) so the full r=100 semicircle's
          peak (y=-5) plus the sun/moon marker and its glow render uncropped. */}
      <svg
        width="100%"
        height="140"
        viewBox="0 -30 260 140"
        className="block"
        aria-hidden
      >
        <path
          d="M 30 95 A 100 100 0 0 1 230 95"
          fill="none"
          stroke="rgba(28,43,64,0.15)"
          strokeWidth="1.5"
          strokeDasharray="2 4"
        />
        {nowM !== null &&
          (isDay ? (
            <circle
              cx={sx}
              cy={sy}
              r="9"
              fill="#c2a14e"
              style={{ filter: 'drop-shadow(0 0 12px rgba(194,161,78,0.55))' }}
            />
          ) : (
            <>
              <mask id={maskId}>
                <circle cx={sx} cy={sy} r="9" fill="white" />
                <circle cx={sx + 4.5} cy={sy - 3} r="8" fill="black" />
              </mask>
              <circle
                cx={sx}
                cy={sy}
                r="9"
                fill="#5c6b7a"
                mask={`url(#${maskId})`}
                style={{ filter: 'drop-shadow(0 0 10px rgba(92,107,122,0.4))' }}
              />
            </>
          ))}
        <text
          x="22"
          y="108"
          fill="rgba(92,107,122,0.7)"
          style={{ fontFamily: 'var(--font-arabic), system-ui', fontSize: 9, letterSpacing: 0.8 }}
        >
          {isDay ? fmtClock(sunriseM) : fmtClock(sunsetM)}
        </text>
        <text
          x="208"
          y="108"
          fill="rgba(92,107,122,0.7)"
          style={{ fontFamily: 'var(--font-arabic), system-ui', fontSize: 9, letterSpacing: 0.8 }}
        >
          {isDay ? fmtClock(sunsetM) : fmtClock(sunriseM)}
        </text>
      </svg>
      <div className="mt-2 text-center">
        <div className="font-aurelia-display text-[28px] font-medium leading-none text-foreground">
          {temp ?? '27°'}
        </div>
        <div className="mt-1 font-aurelia-sans text-[11px] tracking-[0.02em] text-muted-foreground">
          {detail}
        </div>
      </div>
    </div>
  );
}

function BriefReservation({ reservation }: { reservation: DeskReservation }) {
  // Accent rail mirrors the design's `.sched-card` cue — teal = active,
  // gold = awaiting payment, navy = closed out (cancelled/expired/failed).
  const accentClass =
    reservation.status === 'PENDING_PAYMENT'
      ? 'bg-gold-400'
      : reservation.status === 'CANCELLED' ||
          reservation.status === 'EXPIRED' ||
          reservation.status === 'FAILED'
        ? 'bg-foreground/70'
        : 'bg-accent';

  return (
    <div className="relative overflow-hidden rounded-[16px] border border-border bg-card px-4 py-3.5 shadow-soft">
      <span
        aria-hidden
        className={`absolute inset-y-3 start-0 w-1 rounded-full ${accentClass}`}
      />
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[14px] font-bold leading-[1.4] text-foreground">
          {reservation.title}
        </div>
        <div dir="ltr" className="shrink-0 text-[12px] font-bold text-muted-foreground">
          {reservation.time}
        </div>
      </div>
      <div dir="ltr" className="mt-1.5 text-end text-[11px] tracking-[0.02em] text-muted-foreground/80">
        {reservation.sub}
      </div>
    </div>
  );
}
