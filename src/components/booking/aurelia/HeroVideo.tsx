'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';
import type { Locale } from '@/i18n/config';
import { ExperienceVideo } from '@/components/brand/ExperienceVideo';
import { isDirectVideoFile } from './derive';

interface Props {
  /** Admin-set video — an uploaded /uploads/… file or a YouTube/Vimeo embed. */
  videoUrl: string;
  /** Optional still shown first, then crossfaded out once the video plays. */
  posterUrl?: string | null;
  locale: Locale;
  /** Optional extra classes on the outer <section> (call sites pass ""). */
  padClassName?: string;
}

// Same fixed, full-bleed stage as ActivitySpotlight so swapping the slider for
// the video causes ZERO layout shift on any breakpoint.
const STAGE = 'relative h-[180px] overflow-hidden bg-black sm:h-[240px] xl:h-[336px]';

/**
 * AURELIA homepage hero — an admin-controlled "video slot" pinned full-bleed to
 * the top of the booking page, in place of the rotating ActivitySpotlight.
 *
 * Behaviour:
 *  - The poster image paints IMMEDIATELY (above the video), so the slot is never
 *    blank while the clip buffers. Once the video fires `canplay`, the poster
 *    crossfades out to reveal the live, autoplaying video underneath.
 *  - Autoplay is muted + looping + `playsInline` so every browser (incl. iOS
 *    Safari) honours it without a tap.
 *  - prefers-reduced-motion: the video does NOT autoplay. If a poster exists we
 *    show that still; otherwise the video renders with native controls so the
 *    visitor can start it themselves.
 *  - Direct video files (`.mp4`/`.webm`/…) get the native <video> + poster swap.
 *    YouTube/Vimeo embeds can't be a swappable background, so they fall back to
 *    the shared <ExperienceVideo> iframe (no poster swap).
 */
export function HeroVideo({ videoUrl, posterUrl, locale, padClassName }: Props) {
  const ar = locale === 'ar';
  const label = ar ? 'الفيديو المميز' : 'Featured video';

  // SSR-safe: null on the server + first client render → coerce to false (the
  // same "animate by default" stance as ActivitySpotlight), then the real value.
  const reduced = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);

  const direct = isDirectVideoFile(videoUrl);
  // Play the video unless the visitor prefers reduced motion AND we have a
  // poster still to show them instead.
  const showVideo = !reduced || !posterUrl;
  // The poster only fades away once a *playing* video has frames to reveal.
  const posterHidden = ready && showVideo && !reduced;

  return (
    <section aria-label={label} className={cn(padClassName)}>
      <div className={STAGE}>
        {showVideo ? (
          direct ? (
            <video
              key={videoUrl}
              src={videoUrl}
              poster={posterUrl ?? undefined}
              autoPlay={!reduced}
              muted
              loop
              playsInline
              controls={reduced}
              preload="auto"
              aria-label={label}
              onCanPlay={() => setReady(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0">
              <ExperienceVideo url={videoUrl} poster={posterUrl ?? undefined} title={label} />
            </div>
          )
        ) : null}

        {/* Poster layer — sits ON TOP of the video and fades out on `canplay`. */}
        {posterUrl ? (
          <Image
            src={posterUrl}
            alt=""
            fill
            priority
            sizes="(max-width: 1280px) 100vw, 75vw"
            className={cn(
              'z-[1] object-cover transition-opacity duration-700 ease-out',
              posterHidden ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
          />
        ) : null}
      </div>
    </section>
  );
}
