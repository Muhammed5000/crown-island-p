'use client';

import { useMemo, useState } from 'react';
import type { Locale } from '@/i18n/config';
import { FilterChips } from './FilterChips';
import { MobileStackedCarousel } from './MobileStackedCarousel';
import { ListCard } from './ListCard';
import { SectionHeader } from './SectionHeader';
import { DetailSheet, type DetailSheetCopy } from './DetailSheet';
import {
  deriveImage,
  deriveKicker,
  deriveSlotLabel,
  deriveStatus,
  filterByKind,
  type CategoryWithExtras,
} from './derive';

/**
 * The interactive heart of the AURELIA booking screen. Owns:
 *  - the filter-chip state (drives which cards render),
 *  - the selected-category state (drives the bottom DetailSheet).
 *
 * Cards no longer carry their own click destination — they just call
 * `setSelected(category)`. The sheet's CTA is the single point that
 * navigates the user into `/booking/[slug]`, so the booking flow's entry
 * point lives in one place.
 */

interface CopyBundle extends DetailSheetCopy {
  filterAll: string;
  filterKind: Record<'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER', string>;
  sectionTitle: string;
  sectionAction: string;
  endOfList: string;
  featuredBadge: string;
  reserveCta: string;
  nextSlotNow: string;
  nextSlotOpens: string;
  nextSlotClosed: string;
  emptyTitle: string;
  emptyBody: string;
}

interface Props {
  categories: CategoryWithExtras[];
  locale: Locale;
  copy: CopyBundle;
}

export function BookingGrid({ categories, locale, copy }: Props) {
  const [filterId, setFilterId] = useState<string>('all');
  const [selected, setSelected] = useState<CategoryWithExtras | null>(null);

  const availableKinds = useMemo(() => {
    const set = new Set<string>();
    for (const c of categories) for (const s of c.services) set.add(s.kind);
    return Array.from(set) as Array<keyof CopyBundle['filterKind']>;
  }, [categories]);

  const filters = useMemo(
    () => [
      { id: 'all', label: copy.filterAll },
      ...availableKinds.map((k) => ({ id: k, label: copy.filterKind[k] })),
    ],
    [availableKinds, copy.filterAll, copy.filterKind],
  );

  const visible = useMemo(
    () => filterByKind(categories, filterId),
    [categories, filterId],
  );

  if (categories.length === 0) {
    return <EmptyState title={copy.emptyTitle} body={copy.emptyBody} />;
  }

  // "Today's offerings" lists every category/activity (the carousel above
  // already cycles through all of them; this is the full browsable list).
  const offerings = visible;

  const statusLabel = (status: ReturnType<typeof deriveStatus>): string => {
    if (status === 'filling') return copy.statusFilling;
    if (status === 'closed') return copy.statusClosed;
    if (status === 'soon') return copy.statusSoon;
    return copy.statusOpen;
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <FilterChips filters={filters} value={filterId} onChange={setFilterId} />

        <div className="mt-2 flex flex-col gap-[22px] px-4">
          <MobileStackedCarousel items={visible} locale={locale} copy={copy} onTap={setSelected} />

          {offerings.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeader title={copy.sectionTitle} />
              <div className="flex flex-col gap-2.5">
                {offerings.map((c) => (
                  <ListCard
                    key={c.id}
                    image={deriveImage(c)}
                    kicker={deriveKicker(c, locale)}
                    name={locale === 'ar' ? c.nameAr : c.nameEn}
                    tagline={locale === 'ar' ? c.descAr : c.descEn}
                    status={deriveStatus(c)}
                    statusLabel={statusLabel(deriveStatus(c))}
                    slotLabel={deriveSlotLabel(c, {
                      now: copy.nextSlotNow,
                      opens: copy.nextSlotOpens,
                      closed: copy.nextSlotClosed,
                    })}
                    onTap={() => setSelected(c)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <p
            className="py-3 text-center font-aurelia-display text-[13px] text-muted-foreground"
            aria-hidden
          >
            ~ {copy.endOfList} ~
          </p>
        </div>
      </div>

      <DetailSheet
        category={selected}
        locale={locale}
        copy={copy}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-4 rounded-3xl border border-border bg-card p-8 text-center">
      <h3 className="m-0 font-aurelia-display text-[22px] font-medium text-foreground">
        {title}
      </h3>
      <p className="mt-2 font-aurelia-sans text-[13px] leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
