'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/money';
import { toIsoDate } from '@/lib/date';
import { CROWN } from './tokens';
import {
  listSanctionedGuestsAction,
  getCapacitySnapshotAction,
  searchCustomersAction,
  getCustomerProfileAction,
  getReceptionStatusAction,
} from '@/features/reception/actions';
import type { SanctionedGuest } from '@/server/services/sanctions';
import type {
  CapacitySnapshot,
  CapacityCellStatus,
  ReceptionStatusOverview,
  CapacityLevel,
} from '@/server/services/capacity-view';
import type { CustomerCandidate, CustomerProfile, CustomerBookingRow } from '@/server/services/customer-360';
import type { ReceptionCategory } from './ReceptionDesk';

/**
 * Reception quick-view tools — two read-only pop-up panels reachable from the
 * desk top bar without leaving the booking flow:
 *   • SanctionsModal       — every customer who owes an ACTIVE sanction, searchable.
 *   • CapacityPreviewModal — per-service / per-day occupancy map (same picture as
 *     the admin Capacity Preview), with quick switching between services.
 *
 * Styled with the shared CROWN tokens so they sit natively inside the desk.
 */

const { cream, dim, faint, gold, panel, panel2, line, serif, sans, ok, warn, bad } = CROWN;

// ── Shared overlay ─────────────────────────────────────────────────────────--

function Overlay({
  title,
  subtitle,
  onClose,
  width = 720,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const t = useTranslations('reception.desk');
  // Escape to close + lock the body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 20px 40px',
        background: 'rgba(15,23,35,0.55)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        dir="ltr"
        style={{
          width: '100%',
          maxWidth: width,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: panel,
          border: `1px solid ${line}`,
          borderRadius: 22,
          boxShadow: '0 30px 80px rgba(15,23,35,0.35)',
          overflow: 'hidden',
          fontFamily: sans,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '22px 26px', borderBottom: `1px solid ${line}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: serif, fontSize: 24, fontWeight: 600, color: cream }}>{title}</h2>
            {subtitle ? <p style={{ margin: '6px 0 0', fontSize: 13, color: dim, lineHeight: 1.4 }}>{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('tools.close')}
            style={{
              width: 38,
              height: 38,
              flexShrink: 0,
              borderRadius: 10,
              cursor: 'pointer',
              background: panel2,
              border: `1px solid ${line}`,
              color: dim,
              fontSize: 16,
              lineHeight: 1,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            ✕
          </button>
        </div>
        <div className="rc-scroll" style={{ flex: 1, overflowY: 'auto', padding: '20px 26px 26px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 48,
        borderRadius: 13,
        padding: '0 14px',
        background: panel2,
        border: `1px solid ${focus ? gold : line}`,
        transition: 'border-color 0.18s',
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="7" stroke={focus ? gold : faint} strokeWidth="1.8" />
        <path d="M20 20l-3.2-3.2" stroke={focus ? gold : faint} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder={placeholder}
        style={{ flex: 1, height: '100%', border: 'none', outline: 'none', background: 'none', color: cream, fontFamily: sans, fontSize: 14.5 }}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear"
          style={{ border: 'none', background: 'none', color: faint, cursor: 'pointer', fontSize: 15, lineHeight: 1 }}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '46px 16px', textAlign: 'center', color: faint, fontSize: 13.5, fontFamily: sans }}>{children}</div>
  );
}

// ── Sanctions quick-view ───────────────────────────────────────────────────--

export function SanctionsModal({ locale, onClose }: { locale: 'ar' | 'en'; onClose: () => void }) {
  const t = useTranslations('reception.desk');
  const [search, setSearch] = useState('');
  const [guests, setGuests] = useState<SanctionedGuest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const h = setTimeout(async () => {
      setLoading(true);
      const res = await listSanctionedGuestsAction({ search: search.trim() || undefined });
      if (cancelled) return;
      setGuests(res.ok ? res.guests : []);
      setLoading(false);
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [search]);

  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const totalOwed = (guests ?? []).reduce((s, g) => s + g.totalCents, 0);

  return (
    <Overlay title={t('tools.sanctions.title')} subtitle={t('tools.sanctions.subtitle')} onClose={onClose} width={680}>
      <SearchInput value={search} onChange={setSearch} placeholder={t('tools.sanctions.searchPlaceholder')} />

      {guests && guests.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '14px 0 2px' }}>
          <span style={chipStyle(faint)}>{t('tools.sanctions.customersCount', { count: guests.length })}</span>
          <span style={chipStyle(bad)}>{t('tools.sanctions.totalOwed', { amount: money(totalOwed) })}</span>
        </div>
      ) : null}

      {loading ? (
        <EmptyState>{t('tools.loading')}</EmptyState>
      ) : !guests || guests.length === 0 ? (
        <EmptyState>{search.trim() ? t('tools.sanctions.emptySearch') : t('tools.sanctions.empty')}</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {guests.map((g) => {
            const open = expanded === g.userId;
            return (
              <div key={g.userId} style={{ borderRadius: 14, border: `1px solid ${line}`, background: panel2, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : g.userId)}
                  aria-expanded={open}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'start' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: cream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {g.name ?? t('tools.sanctions.noName')}
                    </div>
                    <div style={{ fontSize: 12.5, color: dim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {g.phone ?? g.email ?? t('tools.sanctions.noPhone')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'end', flexShrink: 0 }}>
                    <div style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, color: bad, fontVariantNumeric: 'tabular-nums' }}>{money(g.totalCents)}</div>
                    <div style={{ fontSize: 11, color: faint }}>{t('tools.sanctions.itemsCount', { count: g.count })}</div>
                  </div>
                  <span style={{ color: faint, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', fontSize: 12 }}>▾</span>
                </button>
                {open ? (
                  <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {g.items.map((it, i) => (
                      <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 12.5, color: dim, padding: '9px 0', borderTop: `1px solid ${line}` }}>
                        <span style={{ lineHeight: 1.4 }}>{it.reason}</span>
                        <span style={{ fontWeight: 600, color: cream, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(it.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Overlay>
  );
}

// ── Capacity quick-view ────────────────────────────────────────────────────--

const STATUS_STYLE: Record<CapacityCellStatus, { bg: string; color: string; border: string }> = {
  booked: { bg: gold, color: '#ffffff', border: gold },
  awaiting: { bg: 'rgba(183,121,31,0.18)', color: warn, border: 'rgba(183,121,31,0.5)' },
  available: { bg: panel2, color: faint, border: line },
};

/** Which category + service the modal should open on — the requested service if
 * given (found in its category), else the first bookable one. */
function resolveInitialCapacity(categories: ReceptionCategory[], initialServiceId: string | null) {
  if (initialServiceId) {
    const cat = categories.find((c) => c.services.some((s) => s.id === initialServiceId));
    if (cat) return { categoryId: cat.id, serviceId: initialServiceId };
  }
  const fb = categories.find((c) => c.services.length > 0) ?? categories[0] ?? null;
  return { categoryId: fb?.id ?? '', serviceId: fb?.services[0]?.id ?? '' };
}

export function CapacityPreviewModal({
  locale,
  categories,
  initialServiceId = null,
  onClose,
}: {
  locale: 'ar' | 'en';
  categories: ReceptionCategory[];
  /** Open directly on this service (e.g. clicked from the status bar). */
  initialServiceId?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('reception.desk');
  // The modal remounts each time it opens, so the initial service resolves fresh
  // from whatever was clicked.
  const initial = resolveInitialCapacity(categories, initialServiceId);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const category = categories.find((c) => c.id === categoryId) ?? null;
  const [serviceId, setServiceId] = useState(initial.serviceId);
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [snap, setSnap] = useState<CapacitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep the selected service valid for the chosen category.
  function pickCategory(id: string) {
    setCategoryId(id);
    const next = categories.find((c) => c.id === id)?.services[0]?.id ?? '';
    setServiceId(next);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!serviceId || !date) {
        setSnap(null);
        return;
      }
      setLoading(true);
      setErr(null);
      const res = await getCapacitySnapshotAction({ serviceId, date, locale });
      if (cancelled) return;
      if (res.ok) setSnap(res.snapshot);
      else {
        setSnap(null);
        setErr(t('tools.capacity.loadError'));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, date, locale, t]);

  const services = category?.services ?? [];
  const todayIso = toIsoDate(new Date());

  return (
    <Overlay title={t('tools.capacity.title')} subtitle={t('tools.capacity.subtitle')} onClose={onClose} width={860}>
      {/* Controls — category + date, then quick service switcher */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px', minWidth: 180 }}>
          <FieldLabel>{t('tools.capacity.category')}</FieldLabel>
          <NativeSelect value={categoryId} onChange={pickCategory} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
        <div style={{ flex: '0 0 170px' }}>
          <FieldLabel>{t('tools.capacity.date')}</FieldLabel>
          <input
            type="date"
            value={date}
            min={todayIso}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: '100%', height: 46, borderRadius: 12, background: panel2, border: `1px solid ${line}`, color: cream, fontFamily: sans, fontSize: 14, padding: '0 12px', colorScheme: 'light', cursor: 'pointer', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      {services.length > 1 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {services.map((s) => {
            const on = s.id === serviceId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setServiceId(s.id)}
                aria-pressed={on}
                style={{
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  background: on ? gold : panel2,
                  border: `1px solid ${on ? gold : line}`,
                  color: on ? '#ffffff' : dim,
                  fontFamily: sans,
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Body */}
      <div style={{ marginTop: 20 }}>
        {services.length === 0 ? (
          <EmptyState>{t('tools.capacity.noServices')}</EmptyState>
        ) : loading && !snap ? (
          <EmptyState>{t('tools.loading')}</EmptyState>
        ) : err ? (
          <EmptyState>{err}</EmptyState>
        ) : !snap ? (
          <EmptyState>{t('tools.capacity.pickService')}</EmptyState>
        ) : (
          <>
            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
              <Stat label={t('tools.capacity.totalCapacity')} value={snap.capacity == null ? t('tools.capacity.unlimited') : String(snap.capacity)} />
              <Stat label={t('tools.capacity.booked')} value={String(snap.totalBooked)} tone={gold} />
              <Stat label={t('tools.capacity.available')} value={snap.available == null ? '—' : String(snap.available)} tone={ok} />
              {snap.placeRequired && snap.unplaced > 0 ? (
                <Stat label={t('tools.capacity.awaiting')} value={String(snap.unplaced)} tone={warn} />
              ) : null}
            </div>

            {/* Occupancy bar */}
            {snap.capacity != null && snap.capacity > 0 ? (
              <div style={{ marginTop: 16, height: 6, borderRadius: 999, background: panel2, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, (snap.totalBooked / snap.capacity) * 100)}%`,
                    background: snap.totalBooked >= snap.capacity ? bad : gold,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            ) : null}

            {/* Cell map */}
            {snap.cells.length === 0 ? (
              <EmptyState>{t('tools.capacity.noPlaces')}</EmptyState>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 22, justifyContent: 'center' }}>
                {snap.cells.map((cell) => {
                  const st = STATUS_STYLE[cell.status];
                  const title =
                    cell.status === 'available'
                      ? t('tools.capacity.cellAvailable', { label: cell.label })
                      : cell.status === 'awaiting'
                        ? t('tools.capacity.cellAwaiting', { label: cell.label, ref: cell.reference ?? '' })
                        : t('tools.capacity.cellBooked', { label: cell.label, ref: cell.reference ?? '' });
                  return (
                    <div
                      key={cell.id}
                      title={title}
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        fontFamily: sans,
                        fontSize: 10.5,
                        fontWeight: 700,
                        background: st.bg,
                        color: st.color,
                        border: `1px solid ${st.border}`,
                        boxShadow: cell.status === 'booked' ? '0 4px 12px rgba(194,161,78,0.35)' : 'none',
                      }}
                    >
                      {cell.label.length > 3 ? cell.label.slice(0, 3) : cell.label}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', marginTop: 22, fontSize: 11.5, color: dim, fontFamily: sans }}>
              <LegendDot color={gold} label={t('tools.capacity.legendBooked')} />
              <LegendDot color={warn} label={t('tools.capacity.legendAwaiting')} />
              <LegendDot color={faint} label={t('tools.capacity.legendAvailable')} outline />
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}

// ── Customer-360 lookup ────────────────────────────────────────────────────--

const BOOKING_TONE: Record<CustomerBookingRow['status'], string> = {
  CONFIRMED: ok,
  PENDING_PAYMENT: warn,
  CANCELLED: bad,
  EXPIRED: faint,
  FAILED: bad,
};

export function CustomerLookupModal({
  locale,
  onClose,
  onStartBooking,
}: {
  locale: 'ar' | 'en';
  onClose: () => void;
  /** When provided, a viewed profile offers "Start new booking" — the desk
   *  prefills the wizard for this customer (identity + saved IDs + last trip). */
  onStartBooking?: (ref: { userId: string | null; phone: string | null }) => void;
}) {
  const t = useTranslations('reception.desk');
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<CustomerCandidate[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [selected, setSelected] = useState<CustomerCandidate | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    if (selected) return;
    let cancelled = false;
    const h = setTimeout(async () => {
      const q = search.trim();
      if (q.length < 2) {
        if (!cancelled) {
          setCandidates(null);
          setLoadingList(false);
        }
        return;
      }
      setLoadingList(true);
      const res = await searchCustomersAction({ query: q });
      if (cancelled) return;
      setCandidates(res.ok ? res.candidates : []);
      setLoadingList(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [search, selected]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selected) {
        setProfile(null);
        return;
      }
      setLoadingProfile(true);
      const res = await getCustomerProfileAction({ userId: selected.userId, phone: selected.phone, locale });
      if (cancelled) return;
      setProfile(res.ok ? res.profile : null);
      setLoadingProfile(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, locale]);

  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });

  return (
    <Overlay
      title={selected ? selected.name ?? t('tools.customer.unknown') : t('tools.customer.title')}
      subtitle={selected ? undefined : t('tools.customer.subtitle')}
      onClose={onClose}
      width={760}
    >
      {selected ? (
        // ── Detail ──
        <div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: gold, fontFamily: sans, fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 14 }}
          >
            ← {t('tools.customer.back')}
          </button>

          {loadingProfile && !profile ? (
            <EmptyState>{t('tools.loading')}</EmptyState>
          ) : !profile ? (
            <EmptyState>{t('tools.customer.loadError')}</EmptyState>
          ) : (
            <>
              {/* Identity */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', alignItems: 'center', marginBottom: 4 }}>
                {profile.isWalkin ? <span style={chipStyle(warn)}>{t('tools.customer.walkin')}</span> : <span style={chipStyle(ok)}>{t('tools.customer.account')}</span>}
                {profile.phone ? <IdentityBit label={t('tools.customer.phone')} value={profile.phone} /> : null}
                {profile.email ? <IdentityBit label={t('tools.customer.email')} value={profile.email} /> : null}
                {profile.nationalId ? <IdentityBit label={t('tools.customer.id')} value={profile.nationalId} /> : null}
              </div>

              {/* One-tap repeat booking: hand this customer to the wizard —
                  identity, saved ID photos and their last trip prefill there. */}
              {onStartBooking ? (
                <button
                  type="button"
                  onClick={() => onStartBooking({ userId: profile.userId, phone: profile.phone })}
                  style={{
                    marginTop: 14, height: 44, padding: '0 22px', borderRadius: 12, cursor: 'pointer',
                    background: gold, border: `1px solid ${gold}`, color: '#1c2b40',
                    fontFamily: sans, fontSize: 13.5, fontWeight: 700, letterSpacing: '0.3px',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  {t('tools.customer.startBooking')}
                </button>
              ) : null}

              {/* Outstanding sanctions */}
              {profile.sanctions.totalCents > 0 ? (
                <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 14, background: 'rgba(192,57,43,0.08)', border: `1px solid rgba(192,57,43,0.3)` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <strong style={{ color: bad, fontSize: 13.5 }}>{t('tools.customer.owesHeading')}</strong>
                    <span style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, color: bad }}>{money(profile.sanctions.totalCents)}</span>
                  </div>
                  <ul style={{ margin: '8px 0 0', paddingInlineStart: 16, color: 'rgba(192,57,43,0.85)', fontSize: 12.5 }}>
                    {profile.sanctions.items.map((s, i) => (
                      <li key={i}>{money(s.amountCents)} — {s.reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Bookings */}
              <BookingSection title={t('tools.customer.upcoming')} rows={profile.bookings.filter((b) => b.upcoming)} locale={locale} money={money} t={t} empty={t('tools.customer.noUpcoming')} />
              <BookingSection title={t('tools.customer.history')} rows={profile.bookings.filter((b) => !b.upcoming)} locale={locale} money={money} t={t} empty={t('tools.customer.noHistory')} />
            </>
          )}
        </div>
      ) : (
        // ── Search + candidates ──
        <>
          <SearchInput value={search} onChange={setSearch} placeholder={t('tools.customer.searchPlaceholder')} />
          {search.trim().length < 2 ? (
            <EmptyState>{t('tools.customer.searchHint')}</EmptyState>
          ) : loadingList ? (
            <EmptyState>{t('tools.loading')}</EmptyState>
          ) : !candidates || candidates.length === 0 ? (
            <EmptyState>{t('tools.customer.empty')}</EmptyState>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              {candidates.map((c) => (
                <button
                  key={`${c.userId ?? 'w'}-${c.phone ?? ''}`}
                  type="button"
                  onClick={() => setSelected(c)}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderRadius: 14, border: `1px solid ${line}`, background: panel2, cursor: 'pointer', textAlign: 'start' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: cream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name ?? t('tools.customer.unknown')}
                    </div>
                    <div style={{ fontSize: 12.5, color: dim, marginTop: 2 }}>{c.phone ?? c.email ?? t('tools.customer.noContact')}</div>
                  </div>
                  {c.isWalkin ? <span style={chipStyle(warn)}>{t('tools.customer.walkin')}</span> : null}
                  {c.sanctionCents > 0 ? <span style={chipStyle(bad)}>{money(c.sanctionCents)}</span> : null}
                  <span style={{ color: faint, fontSize: 16 }}>›</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </Overlay>
  );
}

function IdentityBit({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: faint, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13.5, color: cream, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function BookingSection({
  title,
  rows,
  locale,
  money,
  t,
  empty,
}: {
  title: string;
  rows: CustomerBookingRow[];
  locale: 'ar' | 'en';
  money: (c: number) => string;
  t: ReturnType<typeof useTranslations<'reception.desk'>>;
  empty: string;
}) {
  const prefix = locale === 'en' ? 'en/' : '';
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: faint, fontWeight: 700, marginBottom: 10 }}>
        {title} · {rows.length}
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12.5, color: faint, margin: 0 }}>{empty}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((b) => (
            <div key={b.id} style={{ borderRadius: 14, border: `1px solid ${line}`, background: panel2, padding: '13px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: cream }}>{b.serviceName}</div>
                  <div style={{ fontSize: 12, color: dim, marginTop: 2 }}>{b.categoryName} · {b.dateLabel}</div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: BOOKING_TONE[b.status], background: panel, border: `1px solid ${BOOKING_TONE[b.status]}40`, whiteSpace: 'nowrap' }}>
                  {t(`tools.customer.status.${b.status}`)}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', marginTop: 10, fontSize: 12, color: dim }}>
                <span>{t('tools.customer.checkedIn', { done: b.checkedInCount, total: b.people })}</span>
                {b.places.length > 0 ? <span style={{ color: gold, fontWeight: 600 }}>{t('tools.customer.places')}: {b.places.join(', ')}</span> : null}
                {b.totalCents != null ? (
                  <span>
                    {money(b.totalCents)}{' '}
                    <span style={{ color: b.paid ? ok : warn, fontWeight: 600 }}>· {b.paid ? t('tools.customer.paid') : t('tools.customer.unpaid')}</span>
                  </span>
                ) : null}
                <span style={{ marginInlineStart: 'auto', display: 'inline-flex', gap: 12 }}>
                  <a href={`/${prefix}gate/reception/invoice/${b.id}`} target="_blank" rel="noreferrer" style={{ color: gold, fontWeight: 600, textDecoration: 'none' }}>
                    {t('tools.customer.invoice')}
                  </a>
                  {b.status === 'CONFIRMED' ? (
                    <a href={`/${prefix}gate/reception/passes/${b.id}`} target="_blank" rel="noreferrer" style={{ color: gold, fontWeight: 600, textDecoration: 'none' }}>
                      {t('tools.customer.passes')}
                    </a>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Live status bar ────────────────────────────────────────────────────────--

const LEVEL_COLOR: Record<CapacityLevel, string> = { open: ok, filling: warn, full: bad };

export function StatusBar({ locale, onOpenCapacity }: { locale: 'ar' | 'en'; onOpenCapacity: (serviceId: string) => void }) {
  const t = useTranslations('reception.desk');
  const [data, setData] = useState<ReceptionStatusOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await getReceptionStatusAction({ locale });
      if (!cancelled && res.ok) setData(res.status);
    };
    void load();
    const h = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(h);
    };
  }, [locale]);

  if (!data) return null; // stay silent until the first load so the bar never flashes empty

  const kpis: { label: string; value: number; tone?: string }[] = [
    { label: t('tools.status.bookingsToday'), value: data.bookingsToday },
    { label: t('tools.status.waiting'), value: data.arrivalsWaiting, tone: data.arrivalsWaiting > 0 ? warn : undefined },
    { label: t('tools.status.soldOut'), value: data.soldOut, tone: data.soldOut > 0 ? bad : undefined },
    { label: t('tools.status.offline'), value: data.placesOffline, tone: data.placesOffline > 0 ? warn : undefined },
  ];

  return (
    <div
      className="rc-scroll"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '8px 28px',
        borderBottom: `1px solid ${line}`,
        background: panel,
        overflowX: 'auto',
        position: 'relative',
        zIndex: 2,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: ok, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: ok, boxShadow: `0 0 0 3px ${ok}22` }} />
        {t('tools.status.live')}
      </span>

      <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
        {kpis.map((k) => (
          <span key={k.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 700, color: k.tone ?? cream, fontVariantNumeric: 'tabular-nums' }}>{k.value}</span>
            <span style={{ fontSize: 11.5, color: dim }}>{k.label}</span>
          </span>
        ))}
      </div>

      {data.services.length > 0 ? <span style={{ width: 1, height: 22, background: line, flexShrink: 0 }} /> : null}

      <div style={{ display: 'flex', gap: 8 }}>
        {data.services.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpenCapacity(s.id)}
            title={`${s.category} · ${s.name} — ${s.booked}/${s.capacity}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: 36, padding: '4px 12px', borderRadius: 14, background: panel2, border: `1px solid ${line}`, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: sans, fontSize: 12, color: cream }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: LEVEL_COLOR[s.level], flexShrink: 0 }} />
            <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0, textAlign: 'start' }}>
              <span style={{ fontSize: 8.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: faint, fontWeight: 700, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.category}</span>
              <span style={{ fontWeight: 600, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
            </span>
            <span style={{ color: s.level === 'full' ? bad : dim, fontVariantNumeric: 'tabular-nums', fontWeight: 600, flexShrink: 0 }}>
              {s.level === 'full' ? t('tools.status.full') : `${s.booked}/${s.capacity}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Command palette ────────────────────────────────────────────────────────--

export interface Command {
  id: string;
  label: string;
  run: () => void;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const t = useTranslations('reception.desk');
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? commands.filter((c) => c.label.toLowerCase().includes(needle)) : commands;
  const activeIdx = Math.min(idx, Math.max(0, filtered.length - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const c = filtered[activeIdx];
        if (c) {
          onClose();
          c.run();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [filtered, activeIdx, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('palette.title')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 20px 40px', background: 'rgba(15,23,35,0.55)', backdropFilter: 'blur(2px)' }}
    >
      <div dir="ltr" style={{ width: '100%', maxWidth: 560, background: panel, border: `1px solid ${line}`, borderRadius: 18, boxShadow: '0 30px 80px rgba(15,23,35,0.35)', overflow: 'hidden', fontFamily: sans }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          placeholder={t('palette.placeholder')}
          style={{ width: '100%', height: 54, border: 'none', borderBottom: `1px solid ${line}`, outline: 'none', background: 'none', padding: '0 20px', color: cream, fontFamily: sans, fontSize: 16, boxSizing: 'border-box' }}
        />
        <div className="rc-scroll" style={{ maxHeight: '50vh', overflowY: 'auto', padding: 8 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: faint, fontSize: 13 }}>{t('palette.empty')}</div>
          ) : (
            filtered.map((c, i) => {
              const on = i === activeIdx;
              return (
                <button
                  key={c.id}
                  type="button"
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => {
                    onClose();
                    c.run();
                  }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', textAlign: 'start', background: on ? gold : 'transparent', color: on ? '#ffffff' : cream, fontFamily: sans, fontSize: 14, fontWeight: 600 }}
                >
                  {c.label}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── small shared bits ──────────────────────────────────────────────────────--

function chipStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 12px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: sans,
    color,
    background: panel2,
    border: `1px solid ${line}`,
  };
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: '1.2px', fontWeight: 600, color: faint, marginBottom: 8, textTransform: 'uppercase' }}>{children}</div>;
}

function NativeSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          height: 46,
          borderRadius: 12,
          cursor: 'pointer',
          background: panel2,
          border: `1px solid ${line}`,
          color: cream,
          fontFamily: sans,
          fontSize: 14,
          fontWeight: 500,
          padding: '0 38px 0 12px',
          appearance: 'none',
          WebkitAppearance: 'none',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: panel }}>
            {o.label}
          </option>
        ))}
      </select>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
        <path d="M6 9l6 6 6-6" stroke={gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${line}`, background: panel2, padding: '14px 16px' }}>
      <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: faint, fontFamily: sans, fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 6, fontFamily: serif, fontSize: 24, fontWeight: 600, color: tone ?? cream, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function LegendDot({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 12, height: 12, borderRadius: 4, background: outline ? 'transparent' : color, border: `1px solid ${color}` }} />
      {label}
    </span>
  );
}
