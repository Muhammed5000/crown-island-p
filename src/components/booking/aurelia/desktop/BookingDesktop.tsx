'use client';

import { useMemo, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/config';
import { ActivitySpotlight } from '../ActivitySpotlight';
import { HeroVideo } from '../HeroVideo';
import { DetailSheet } from '../DetailSheet';
import { deriveStatus, filterByKind, type CategoryWithExtras } from '../derive';
import { DeskHeader, DeskFilterRow } from './DesktopChrome';
import { DeskCard } from './DesktopCards';
import { StackedActivityCarousel } from './StackedActivityCarousel';
import { DeskBrief } from './DesktopBrief';
import type { CopyBundle, DeskCopy, DeskDate, DeskReservation } from './types';

/**
 * AURELIA — desktop booking surface (≥ xl). Wide-canvas adaptation of the
 * mobile `/booking` screen from the "Aurelia Desktop" design handoff:
 * slim left rail, top bar, editorial hero + at-a-glance stats, date scrubber +
 * filter chips, a featured split card with a 3-column grid, and a right-side
 * concierge brief.
 *
 * It deliberately reuses the SAME data, derive helpers and `DetailSheet` as the
 * mobile `BookingGrid` — only the layout changes. The mobile/tablet tree is
 * untouched; the booking page renders this component only at `xl` and up.
 */
interface Props {
  categories: CategoryWithExtras[];
  locale: Locale;
  copy: CopyBundle;
  desk: DeskCopy;
  /** Server-computed eyebrow ribbon, e.g. "SAT · 24 MAY · 27° HAZY SUN". */
  eyebrow: string;
  /** `t('heading')` — may contain a `\n` for the two-line break. */
  headline: string;
  dates: DeskDate[];
  reservations: DeskReservation[];
  initialNowM?: number;
  /** Admin-set hero video — replaces the rotating spotlight when present. */
  heroVideoUrl?: string | null;
  heroPosterUrl?: string | null;
}

export function BookingDesktop({
  categories,
  locale,
  copy,
  desk,
  eyebrow,
  headline,
  dates,
  reservations,
  initialNowM,
  heroVideoUrl,
  heroPosterUrl,
}: Props) {
  const [filterId, setFilterId] = useState<string>('all');
  const [selected, setSelected] = useState<CategoryWithExtras | null>(null);
  const router = useRouter();

  const filters = useMemo(() => {
    const kinds = new Set<string>();
    for (const c of categories) for (const s of c.services) kinds.add(s.kind);
    return [
      { id: 'all', label: copy.filterAll },
      ...(Array.from(kinds) as Array<keyof typeof copy.filterKind>).map((k) => ({
        id: k,
        label: copy.filterKind[k],
      })),
    ];
  }, [categories, copy]);

  const visible = useMemo(() => filterByKind(categories, filterId), [categories, filterId]);
  const openNow = useMemo(
    // "Open now" counts only genuinely-available experiences — a coming-soon
    // (service-less) category is neither open nor closed.
    () => categories.filter((c) => {
      const s = deriveStatus(c);
      return s !== 'closed' && s !== 'soon';
    }).length,
    [categories],
  );

  // "Today's offerings" lists every category/activity. (The carousel above
  // already cycles through all of them; this is the full browsable grid.)
  const offerings = visible;

  return (
    // Fixed-height desktop shell. The rail + main column fill the viewport
    // (minus AppShell's headerless top-pad 1.25rem + main bottom-pad 1.5rem =
    // 2.75rem) and the content area scrolls INTERNALLY — so the left rail,
    // including the profile icon at its foot, stays fixed while the user
    // scrolls. Done this way (rather than sticky/fixed) because an ancestor
    // `overflow-hidden` (AppShell) and `transform` (PageTransition) would
    // otherwise break those. Desktop-only; mobile/tablet are unaffected.
    <div className="relative -mt-5 flex h-[calc(100dvh_-_1.5rem)] w-full overflow-hidden bg-background text-foreground">
      {/* Atmospheric tint — gold haze top-start, cool wash bottom-end. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 70% 50% at 30% 0%, rgba(194,161,78,0.08) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 90% 100%, rgba(42,157,168,0.10) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="min-w-0 flex-1">
            {/* Full-bleed hero, flush to the top of the canvas — an admin-set
                video when configured, else the rotating photo spotlight. */}
            {heroVideoUrl ? (
              <HeroVideo videoUrl={heroVideoUrl} posterUrl={heroPosterUrl} locale={locale} padClassName="" />
            ) : (
              <ActivitySpotlight categories={categories} locale={locale} padClassName="" />
            )}
            <DeskHeader
              eyebrow={eyebrow}
              headline={headline}
              desk={desk}
              stats={{
                openNow,
                reservations: reservations.length,
                experiences: categories.length,
              }}
            />
            <DeskFilterRow
              dates={dates}
              filters={filters}
              filterId={filterId}
              onFilter={setFilterId}
              desk={desk}
            />

            <div className="px-10 pb-16 pt-8">
              {categories.length === 0 ? (
                <EmptyState title={copy.emptyTitle} body={copy.emptyBody} />
              ) : (
                <div className="flex flex-col gap-9">
                  <StackedActivityCarousel
                    items={visible}
                    locale={locale}
                    copy={copy}
                    desk={desk}
                    onTap={setSelected}
                    onReserve={(c) => router.push(`/booking/${c.slug}`)}
                  />

                  {offerings.length > 0 ? (
                    <div>
                      <div className="mb-[18px] flex items-baseline justify-between">
                        <h2 className="m-0 font-aurelia-display text-[30px] font-extrabold tracking-[-0.01em] text-foreground">
                          {desk.offeringsTitle}
                        </h2>
                        <span className="font-aurelia-sans text-[11px] font-semibold tracking-[0.12em] text-gold-600">
                          {desk.offeringsCount.replace('{count}', String(offerings.length))}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-[18px]">
                        {offerings.map((c) => (
                          <DeskCard
                            key={c.id}
                            category={c}
                            locale={locale}
                            copy={copy}
                            desk={desk}
                            onTap={setSelected}
                            onReserve={(c) => router.push(`/booking/${c.slug}`)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <DeskBrief desk={desk} reservations={reservations} initialNowM={initialNowM} />
        </div>
      </div>

      <DetailSheet
        category={selected}
        locale={locale}
        copy={copy}
        centered
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-8 text-center">
      <h3 className="m-0 font-aurelia-display text-[22px] font-medium text-foreground">
        {title}
      </h3>
      <p className="mt-2 font-aurelia-sans text-[13px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
