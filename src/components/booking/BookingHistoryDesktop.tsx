'use client';

import { useMemo, useState } from 'react';
import { Link } from '@/i18n/navigation';

/**
 * Desktop (≥ xl) redesign of the booking-history section, built from the
 * Claude Design handoff "Crown Booking History Desktop.html". HeroUI-style
 * primitives (Card / Chip / Tabs / Input / Button) rendered in the Crown /
 * AURELIA design language.
 *
 * Scope: this is the *inner section* only. The left rail, top header and
 * breadcrumb are already provided by the authenticated `AppShell`
 * (`DesktopRail` + `AppHeader` + `PageNav`), so they are intentionally not
 * re-implemented here.
 *
 * The prototype's "TOTAL SPEND" summary card is deliberately omitted per the
 * implementation brief.
 *
 * Tabs and search filter client-side over the full booking set (fetched once
 * server-side with `filter: 'all'`), mirroring the prototype's live counts.
 */

export type HistoryStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED';

export interface DesktopBooking {
  id: string;
  reference: string;
  status: HistoryStatus;
  /** Localised category name — shown as the gold tier eyebrow. */
  tier: string;
  /** Localised service name — the serif card title. */
  title: string;
  /** Pre-formatted booking date (server-rendered to avoid hydration drift). */
  date: string;
  /** Pre-formatted total, or `null` when there is no invoice. */
  total: string | null;
  people: number;
  cars: number;
  when: 'upcoming' | 'past';
}

export interface DesktopCopy {
  title: string;
  subtitle: string;
  newBooking: string;
  statTotalLabel: string;
  statTotalSub: string;
  statUpcomingLabel: string;
  statUpcomingSub: string;
  statConfirmedLabel: string;
  statConfirmedSub: string;
  tabAll: string;
  tabUpcoming: string;
  tabPast: string;
  searchPlaceholder: string;
  sortNewest: string;
  metaDate: string;
  metaGuests: string;
  totalLabel: string;
  referenceLabel: string;
  viewDetails: string;
  rebook: string;
  noMatch: string;
  emptyTitle: string;
  payNow: string;
  carWord: string;
  carsWord: string;
  statusLabels: Record<HistoryStatus, string>;
}

const STATUS_COLOR: Record<HistoryStatus, string> = {
  CONFIRMED: '#1f8a4c',
  PENDING_PAYMENT: '#b8860b',
  EXPIRED: '#6b7280',
  CANCELLED: '#d1503a',
  FAILED: '#d1503a',
};

const isInactiveStatus = (s: HistoryStatus) =>
  s === 'CANCELLED' || s === 'FAILED' || s === 'EXPIRED';

type Tab = 'all' | 'upcoming' | 'past';

export function BookingHistoryDesktop({
  bookings,
  copy,
}: {
  bookings: DesktopBooking[];
  copy: DesktopCopy;
}) {
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');

  const counts = useMemo(
    () => ({
      all: bookings.length,
      upcoming: bookings.filter((b) => b.when === 'upcoming' && !isInactiveStatus(b.status)).length,
      past: bookings.filter((b) => b.when === 'past').length,
    }),
    [bookings],
  );

  const confirmedCount = useMemo(
    () => bookings.filter((b) => b.status === 'CONFIRMED').length,
    [bookings],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return bookings.filter((b) => {
      const byTab =
        tab === 'all'
          ? true
          : tab === 'upcoming'
            ? b.when === 'upcoming' && !isInactiveStatus(b.status)
            : b.when === 'past';
      const byQ = !needle || `${b.title} ${b.reference} ${b.tier}`.toLowerCase().includes(needle);
      return byTab && byQ;
    });
  }, [bookings, tab, q]);

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: 'all', label: copy.tabAll, count: counts.all },
    { id: 'upcoming', label: copy.tabUpcoming, count: counts.upcoming },
    { id: 'past', label: copy.tabPast, count: counts.past },
  ];

  return (
    <div
      className="relative min-h-dvh w-full bg-background font-aurelia-sans text-foreground"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 60% 45% at 70% 0%, rgba(194,161,78,0.06), transparent 60%)',
      }}
    >
      <div className="mx-auto max-w-[1180px] px-11 pb-12 pt-3.5">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="mb-7 flex items-end justify-between gap-8">
          <div>
            <h1 className="m-0 font-aurelia-display text-[46px] font-semibold leading-none tracking-[-0.01em] text-gold-700">
              {copy.title}
            </h1>
            <p className="mt-3 text-sm tracking-[0.01em] text-muted-foreground">{copy.subtitle}</p>
          </div>
          <Link
            href="/booking"
            className="inline-flex h-12 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-[13px] bg-primary px-6 text-sm font-bold tracking-[0.02em] text-primary-foreground shadow-navy transition-transform hover:-translate-y-0.5"
          >
            <span className="text-lg leading-none">+</span> {copy.newBooking}
          </Link>
        </div>

        {/* ── Summary stats (TOTAL SPEND card intentionally omitted) ─ */}
        <div className="mb-7 flex gap-3.5">
          <StatCard label={copy.statTotalLabel} value={String(counts.all)} sub={copy.statTotalSub} />
          <StatCard
            label={copy.statUpcomingLabel}
            value={String(counts.upcoming)}
            sub={copy.statUpcomingSub}
            accent="#1f8a4c"
          />
          <StatCard
            label={copy.statConfirmedLabel}
            value={String(confirmedCount)}
            sub={copy.statConfirmedSub}
          />
        </div>

        {/* ── Toolbar ────────────────────────────────────────────── */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="inline-flex gap-0.5 rounded-[14px] border border-border bg-muted p-1">
            {tabs.map((it) => {
              const active = it.id === tab;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setTab(it.id)}
                  aria-pressed={active}
                  className={[
                    'inline-flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13px] tracking-[0.02em] transition-all',
                    active
                      ? 'bg-accent font-bold text-accent-foreground'
                      : 'font-medium text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  {it.label}
                  <span
                    className={[
                      'rounded-full px-[7px] py-px text-[11px] font-bold',
                      active ? 'bg-black/15 text-accent-foreground' : 'bg-muted-foreground/15 text-muted-foreground',
                    ].join(' ')}
                  >
                    {it.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex gap-2.5">
            <SearchInput value={q} onChange={setQ} placeholder={copy.searchPlaceholder} />
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-xl border border-border bg-card px-[18px] text-[13px] font-medium text-muted-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18M6 12h12M10 18h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              {copy.sortNewest}
            </button>
          </div>
        </div>

        {/* ── Grid / empty states ────────────────────────────────── */}
        {bookings.length === 0 ? (
          <EmptyState title={copy.emptyTitle} cta={copy.payNow} />
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-2 gap-[18px]">
            {filtered.map((b) => (
              <BookingCard key={b.id} b={b} copy={copy} />
            ))}
          </div>
        ) : (
          <div className="py-[60px] text-center font-aurelia-display text-lg text-muted-foreground">
            {copy.noMatch}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="flex-1 rounded-2xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div
        className="font-aurelia-sans text-[32px] font-bold leading-none tabular-nums"
        style={{ color: accent ?? '#1c2b40' }}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div
      className={[
        'flex h-11 w-[280px] items-center gap-2.5 rounded-xl border bg-card px-3.5 transition-colors',
        focus ? 'border-accent' : 'border-border',
      ].join(' ')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0">
        <circle cx="10.5" cy="10.5" r="6.5" stroke={focus ? '#2a9da8' : 'rgba(28,43,64,0.4)'} strokeWidth="1.6" />
        <path d="M20 20l-4.5-4.5" stroke={focus ? '#2a9da8' : 'rgba(28,43,64,0.4)'} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder={placeholder}
        className="min-w-0 flex-1 border-none bg-transparent text-[13px] tracking-[0.01em] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

function BookingCard({ b, copy }: { b: DesktopBooking; copy: DesktopCopy }) {
  const inactive = isInactiveStatus(b.status);
  const statusColor = STATUS_COLOR[b.status];
  const carLabel = b.cars === 1 ? copy.carWord : copy.carsWord;

  return (
    <div
      className={[
        'group relative flex flex-col overflow-hidden rounded-[18px] border bg-card transition-[transform,border-color,box-shadow] duration-200',
        inactive
          ? 'border-border opacity-70'
          : 'border-border hover:-translate-y-[3px] hover:border-gold-400/40 hover:shadow-lift',
      ].join(' ')}
    >
      {/* status accent edge */}
      <div
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{
          background:
            b.status === 'EXPIRED'
              ? '#a3a3a3'
              : b.status === 'CANCELLED' || b.status === 'FAILED'
                ? '#e8836a'
                : 'linear-gradient(180deg, #c2a14e, rgba(194,161,78,0.25))',
        }}
      />

      <div className="px-6 pb-[18px] pt-[22px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-[7px] text-[10.5px] font-bold uppercase tracking-[0.22em] text-gold-600">
              {b.tier}
            </div>
            <h3
              className={[
                'm-0 font-aurelia-display text-[28px] font-semibold leading-none tracking-[-0.005em] text-foreground',
                inactive ? 'line-through decoration-foreground/20' : '',
              ].join(' ')}
            >
              {b.title}
            </h3>
          </div>
          <StatusChip color={statusColor} label={copy.statusLabels[b.status]} />
        </div>

        {/* meta row */}
        <div className="mt-[22px] flex gap-7">
          <Meta icon="cal" label={copy.metaDate} value={b.date} />
          <Meta icon="people" label={copy.metaGuests} value={`${b.people} · ${b.cars} ${carLabel}`} />
          <div className="ms-auto text-end">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.totalLabel}
            </div>
            <div className="font-aurelia-display text-2xl font-semibold leading-none tabular-nums text-gold-700">
              {b.total ?? '—'}
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="mt-auto flex items-center justify-between border-t border-border bg-muted/40 px-6 py-3.5">
        <div>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {copy.referenceLabel}&nbsp;&nbsp;
          </span>
          <span dir="ltr" className="text-[12.5px] font-semibold tracking-[0.05em] text-foreground/70">
            {b.reference}
          </span>
        </div>
        {inactive ? (
          <Link
            href="/booking"
            className="inline-flex h-9 items-center rounded-[10px] border border-border px-4 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            {copy.rebook}
          </Link>
        ) : (
          <Link
            href={`/bookings/${b.id}`}
            className="inline-flex h-9 items-center gap-[7px] rounded-[10px] border border-border px-4 text-[12.5px] font-semibold text-foreground transition-colors group-hover:border-accent group-hover:bg-accent group-hover:text-accent-foreground"
          >
            {copy.viewDetails} <span className="text-sm leading-none">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}

function StatusChip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-[11px] py-[5px] text-[11.5px] font-semibold tracking-[0.02em]"
      style={{ color, background: `${color}1c`, border: `1px solid ${color}44` }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Meta({ icon, label, value }: { icon: 'cal' | 'people'; label: string; value: string }) {
  return (
    <div>
      <div className="mb-[7px] text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-gold-400/15">
          {icon === 'cal' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="#c2a14e" strokeWidth="1.6" />
              <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="#c2a14e" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="9" cy="8" r="2.6" stroke="#c2a14e" strokeWidth="1.5" />
              <path d="M3.8 18c.5-2.9 2.6-4.4 5.2-4.4S13.7 15.1 14.2 18" stroke="#c2a14e" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <span className="text-sm font-semibold text-foreground">{value}</span>
      </div>
    </div>
  );
}

function EmptyState({ title, cta }: { title: string; cta: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[18px] border border-border bg-card px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <Link
        href="/booking"
        className="text-xs text-gold-600 underline underline-offset-4 hover:text-foreground"
      >
        {cta}
      </Link>
    </div>
  );
}
