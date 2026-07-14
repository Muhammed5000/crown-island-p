'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { listTodayBookingsAction } from '@/features/reception/actions';
import type { ReceptionSearchRow } from '@/server/services/reception';
import { ResultCard, Note } from './ReceptionSearch';
import { PendingDeposits } from './PendingDeposits';
import { CROWN } from './tokens';

/**
 * Reception "Today's bookings" board.
 *
 * The desk's at-a-glance view of EVERY confirmed booking of the day (walk-in +
 * online), newest-and-not-yet-entered first. Each row opens the same check-in
 * flow (`/gate/reception/checkin/[bookingId]`) as the search, and a local
 * filter box narrows the already-loaded list without another round-trip — handy
 * when the operator just wants to scroll the day, not type a query. Rendered as
 * a mode inside `ReceptionDesk`, so it inherits the LTR shell + CROWN palette.
 */

// ── CROWN tokens — single source of truth in ./tokens ──
const { cream, dim, faint, gold, panel2, line, serif, sans } = CROWN;

export function ReceptionToday({ locale }: { locale: 'ar' | 'en' }) {
  const t = useTranslations('reception.today');
  const router = useRouter();
  const [rows, setRows] = useState<ReceptionSearchRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [pending, startLoad] = useTransition();

  const load = () => {
    startLoad(async () => {
      const res = await listTodayBookingsAction({ locale });
      setLoaded(true);
      if (res.ok) {
        setRows(res.rows);
        setError(null);
      } else {
        setRows([]);
        setError(
          res.code === 'forbidden'
            ? t('errorForbidden')
            : t('errorLoad'),
        );
      }
    });
  };

  // Cosmetic header date. Computed at render (not in an effect, which would
  // trigger a cascading re-render); `suppressHydrationWarning` on the span
  // covers the rare server/client midnight-timezone edge.
  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [locale],
  );

  // Load the day's bookings once on mount (and whenever the locale changes).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  // Local, instant narrowing of the loaded list — name, phone digits,
  // reference, or national id. No server round-trip.
  const visible = useMemo(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return rows;
    const digits = t.replace(/\D/g, '');
    return rows.filter(
      (r) =>
        r.guestName.toLowerCase().includes(t) ||
        r.reference.toLowerCase().includes(t) ||
        (digits.length > 0 && r.phone.replace(/\D/g, '').includes(digits)) ||
        (!!r.nationalId && r.nationalId.toLowerCase().includes(t)),
    );
  }, [rows, filter]);

  const stats = useMemo(() => {
    const guests = rows.reduce((s, r) => s + r.people, 0);
    const entered = rows.reduce((s, r) => s + r.checkedInCount, 0);
    const done = rows.filter((r) => r.fullyCheckedIn).length;
    return { bookings: rows.length, guests, entered, waiting: Math.max(0, guests - entered), done };
  }, [rows]);

  const openCheckIn = (id: string) => router.push(`/gate/reception/checkin/${id}`);
  const openCheckout = (id: string) => router.push(`/gate/reception/checkout/${id}`);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: '2.6px', fontWeight: 700, color: gold, marginBottom: 8 }}>
            {t('eyebrow')}
          </div>
          <h1 style={{ margin: 0, fontFamily: serif, fontSize: 40, fontWeight: 600, color: cream, lineHeight: 1, letterSpacing: '-0.4px' }}>
            {t('title')}
          </h1>
          <p style={{ color: dim, fontSize: 13.5, margin: '10px 0 0', fontFamily: sans, lineHeight: 1.5 }}>
            {t.rich('subtitle', {
              date: () => <span suppressHydrationWarning>{todayLabel}</span>,
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={pending}
          aria-label={t('refreshAria')}
          style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 15px',
            borderRadius: 11, background: panel2, border: `1px solid ${line}`, color: dim,
            fontFamily: sans, fontSize: 13, fontWeight: 600, cursor: pending ? 'default' : 'pointer',
            opacity: pending ? 0.6 : 1,
          }}
        >
          <RefreshGlyph spinning={pending} />
          {pending ? t('refreshing') : t('refresh')}
        </button>
      </div>

      {/* summary */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <Stat label={t('statBookings')} value={stats.bookings} />
        <Stat label={t('statGuests')} value={stats.guests} />
        <Stat label={t('statEntered')} value={stats.entered} tone="green" />
        <Stat label={t('statWaiting')} value={stats.waiting} tone={stats.waiting > 0 ? 'amber' : undefined} />
      </div>

      {/* deposits still owed a checkout / payout — hidden while empty */}
      <PendingDeposits locale={locale} />

      {/* filter box */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, height: 56, borderRadius: 16,
          background: panel2, border: `1px solid ${line}`, padding: '0 18px', marginBottom: 18,
        }}
      >
        <SearchGlyph />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('filterPlaceholder')}
          aria-label={t('filterAria')}
          style={{
            flex: 1, height: '100%', border: 'none', outline: 'none', background: 'none',
            color: cream, fontFamily: sans, fontSize: 15, letterSpacing: '0.2px',
          }}
        />
        {filter ? (
          <button
            type="button"
            onClick={() => setFilter('')}
            aria-label={t('clearFilter')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: faint, fontSize: 18, lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* states */}
      {error ? (
        <Note tone="error">{error}</Note>
      ) : !loaded && pending ? (
        <Note>{t('loading')}</Note>
      ) : rows.length === 0 ? (
        <Note>{t('emptyToday')}</Note>
      ) : visible.length === 0 ? (
        <Note>{t('emptyFilter', { query: filter.trim() })}</Note>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ color: faint, fontSize: 11.5, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: sans }}>
            {filter.trim()
              ? t('countShown', { shown: visible.length, total: rows.length })
              : t('countToday', { count: rows.length })}
          </div>
          {visible.map((r) => (
            <ResultCard key={r.id} row={r} onOpen={() => openCheckIn(r.id)} onCheckout={() => openCheckout(r.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' }) {
  const color = tone === 'green' ? '#1f9d63' : tone === 'amber' ? '#b7791f' : cream;
  return (
    <div
      style={{
        flex: '1 1 120px', minWidth: 120, padding: '14px 16px', borderRadius: 14,
        background: panel2, border: `1px solid ${line}`,
      }}
    >
      <div style={{ fontFamily: serif, fontSize: 30, fontWeight: 600, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ marginTop: 6, color: faint, fontFamily: sans, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke={gold} strokeWidth="1.8" />
      <path d="M16.5 16.5L21 21" stroke={gold} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RefreshGlyph({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden
      style={spinning ? { animation: 'ci-spin 0.8s linear infinite' } : undefined}
    >
      <style>{`@keyframes ci-spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" stroke={gold} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M21 4v5h-5" stroke={gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
