'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Privacy policy — table-of-contents nav card (desktop only), recreated from the
 * "Crown Privacy (Arabic Desktop)" design. Anchors smooth-scroll to each section
 * card and an IntersectionObserver scroll-spy highlights the section in view.
 * It's rendered inside the page's sticky sidebar (alongside the Contact card),
 * so the sticky/fixed behaviour lives on the parent, not here. Kept compact so
 * the TOC + Contact fit the viewport height without an inner scrollbar. Colours
 * use the app's theme tokens so it tracks light ↔ dark; strings are pre-translated.
 */
interface TocItem {
  id: string;
  num: string;
  label: string;
}

interface Props {
  items: TocItem[];
  tocHeading: string;
}

export function PrivacyToc({ items, tocHeading }: Props) {
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el != null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0.1, 0.5, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  function go(e: React.MouseEvent, id: string) {
    e.preventDefault();
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav className="rounded-[20px] border border-border bg-card p-2.5 shadow-[0_14px_36px_rgba(22,41,75,0.06)]">
      <div className="px-3 pb-2 pt-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
        {tocHeading}
      </div>
      {items.map((it) => {
        const on = it.id === active;
        return (
          <a
            key={it.id}
            href={`#${it.id}`}
            onClick={(e) => go(e, it.id)}
            className={cn(
              'flex items-center gap-2.5 rounded-[11px] px-3 py-[7px] text-[13.5px] font-bold leading-snug transition-colors',
              on ? 'bg-gold-400/[0.12] text-gold-700' : 'text-foreground/75 hover:bg-muted',
            )}
          >
            <span
              className={cn(
                'grid size-[23px] shrink-0 place-items-center rounded-full text-[11.5px] font-extrabold transition-colors',
                on ? 'bg-gold-400 text-white' : 'bg-muted text-muted-foreground',
              )}
            >
              {it.num}
            </span>
            <span className="min-w-0 flex-1">{it.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
