'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { searchReceptionBookingsAction } from '@/features/reception/actions';
import type { ReceptionSearchRow } from '@/server/services/reception';
import { CROWN } from './tokens';

/**
 * Reception "find a booking" search.
 *
 * Lets the desk look up TODAY's confirmed bookings by guest name, phone, or
 * national ID and jump straight into the existing check-in flow
 * (`/gate/reception/checkin/[bookingId]`) — the path for a guest who turns up
 * without their QR pass. Rendered as a mode inside `ReceptionDesk`, so it
 * inherits the desk's LTR shell and CROWN palette.
 */

// ── CROWN tokens — single source of truth in ./tokens ──
const { cream, dim, faint, gold, panel, panel2, line, serif, sans } = CROWN;

export function ReceptionSearch({ locale }: { locale: 'ar' | 'en' }) {
  const t = useTranslations('reception.search');
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ReceptionSearchRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSearch] = useTransition();

  // Clear results as soon as the query drops below the search threshold — done
  // in the change handler (an event) rather than the effect to avoid a cascading
  // re-render. The effect below owns only the debounced fetch.
  const onChangeQuery = (value: string) => {
    setQ(value);
    if (value.trim().length < 2) {
      setRows([]);
      setSearched(false);
      setError(null);
    }
  };

  // Debounced, server-authoritative search for queries of 2+ characters.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      startSearch(async () => {
        const res = await searchReceptionBookingsAction({ q: term, locale });
        if (cancelled) return;
        setSearched(true);
        if (res.ok) {
          setRows(res.rows);
          setError(null);
        } else {
          setRows([]);
          setError(res.code === 'forbidden' ? t('errorForbidden') : t('errorFailed'));
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, locale, t]);

  const openCheckIn = (id: string) => router.push(`/gate/reception/checkin/${id}`);
  const openCheckout = (id: string) => router.push(`/gate/reception/checkout/${id}`);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: sans, fontSize: 11, letterSpacing: '2.6px', fontWeight: 700, color: gold, marginBottom: 8 }}>
          {t('eyebrow')}
        </div>
        <h1 style={{ margin: 0, fontFamily: serif, fontSize: 40, fontWeight: 600, color: cream, lineHeight: 1, letterSpacing: '-0.4px' }}>
          {t('title')}
        </h1>
        <p style={{ color: dim, fontSize: 13.5, margin: '10px 0 0', fontFamily: sans, lineHeight: 1.5 }}>
          {t('subtitle')}
        </p>
      </div>

      {/* search box */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, height: 60, borderRadius: 16,
          background: panel2, border: `1px solid ${line}`, padding: '0 18px', marginBottom: 18,
        }}
      >
        <SearchGlyph />
        <input
          autoFocus
          value={q}
          onChange={(e) => onChangeQuery(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('searchAria')}
          style={{
            flex: 1, height: '100%', border: 'none', outline: 'none', background: 'none',
            color: cream, fontFamily: sans, fontSize: 16, letterSpacing: '0.2px',
          }}
        />
        {q ? (
          <button
            type="button"
            onClick={() => onChangeQuery('')}
            aria-label={t('clearAria')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: faint, fontSize: 18, lineHeight: 1, padding: 4 }}
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* states */}
      {error ? (
        <Note tone="error">{error}</Note>
      ) : q.trim().length < 2 ? (
        <Note>{t('hintMinChars')}</Note>
      ) : pending ? (
        <Note>{t('searching')}</Note>
      ) : searched && rows.length === 0 ? (
        <Note>{t('noMatches', { query: q.trim() })}</Note>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.length > 0 ? (
            <div style={{ color: faint, fontSize: 11.5, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: sans }}>
              {t('matchCount', { count: rows.length })}
            </div>
          ) : null}
          {rows.map((r) => (
            <ResultCard key={r.id} row={r} onOpen={() => openCheckIn(r.id)} onCheckout={() => openCheckout(r.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ResultCard({
  row,
  onOpen,
  onCheckout,
}: {
  row: ReceptionSearchRow;
  onOpen: () => void;
  /** Opens the deposit-checkout window (shown only when the booking has a collected deposit). */
  onCheckout?: () => void;
}) {
  const t = useTranslations('reception.search');
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'block', width: '100%', textAlign: 'start', cursor: 'pointer',
        borderRadius: 18, background: panel, border: `1px solid ${line}`, padding: '18px 20px',
        transition: 'border-color 0.15s, transform 0.1s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${gold}55`)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = line)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: serif, fontSize: 21, fontWeight: 600, color: cream }}>{row.guestName}</span>
            <Tag tone={row.channel === 'RECEPTION' ? 'gold' : 'neutral'}>{row.channel === 'RECEPTION' ? t('channelReception') : t('channelOnline')}</Tag>
            <EntryTag people={row.people} entered={row.checkedInCount} full={row.fullyCheckedIn} />
            {row.deposit ? <DepositTag status={row.deposit.status} /> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px 14px', flexWrap: 'wrap', marginTop: 7, color: dim, fontFamily: sans, fontSize: 13 }}>
            <span dir="ltr">{row.phone}</span>
            {row.nationalId ? <span dir="ltr" style={{ color: faint }}>{t('idPrefix', { id: row.nationalId })}</span> : null}
            <span style={{ color: faint }}>#{row.reference}</span>
          </div>
          <div style={{ marginTop: 6, color: dim, fontFamily: sans, fontSize: 13 }}>
            {row.categoryName} · {row.serviceName} · {row.dateLabel}
            {row.isMultiDay ? t('multiDaySuffix') : ''} · {t('guestCount', { count: row.people })}
          </div>
        </div>
        <span style={{ flexShrink: 0, display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <span
            aria-hidden
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, padding: '0 16px',
              borderRadius: 10, background: 'linear-gradient(180deg, #c2a14e, #9c7d34)', color: '#ffffff',
              fontFamily: sans, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >
            {t('checkIn')}
          </span>
          {row.deposit && onCheckout ? (
            // Nested action inside the card button — a real <button> is invalid
            // here, so use the keyboard-operable role="button" span pattern (same
            // as the ID-photo eye glyph on the desk).
            <span
              role="button"
              tabIndex={0}
              aria-label={t('checkout')}
              onClick={(e) => { e.stopPropagation(); onCheckout(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onCheckout(); }
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, padding: '0 16px',
                borderRadius: 10, background: panel2, border: `1px solid ${gold}55`, color: gold,
                fontFamily: sans, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer',
              }}
            >
              {t('checkout')}
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}

/** Deposit badge: amber = undecided, blue = refund in progress, green = refunded, gray = retained. */
function DepositTag({ status }: { status: NonNullable<ReceptionSearchRow['deposit']>['status'] }) {
  const t = useTranslations('reception.search');
  switch (status) {
    case 'UNDECIDED':
      return <Tag tone="amber">{t('depositUndecided')}</Tag>;
    case 'IN_PROGRESS':
      return <Tag tone="blue">{t('depositInProgress')}</Tag>;
    case 'REFUNDED':
      return <Tag tone="green">{t('depositRefunded')}</Tag>;
    case 'RETAINED':
      return <Tag tone="neutral">{t('depositRetained')}</Tag>;
  }
}

function EntryTag({ people, entered, full }: { people: number; entered: number; full: boolean }) {
  const t = useTranslations('reception.search');
  if (full) return <Tag tone="green">{t('entryAll', { people })}</Tag>;
  if (entered > 0) return <Tag tone="amber">{t('entryPartial', { entered, people })}</Tag>;
  return <Tag tone="neutral">{t('entryNone')}</Tag>;
}

function Tag({ tone, children }: { tone: 'gold' | 'green' | 'amber' | 'blue' | 'neutral'; children: React.ReactNode }) {
  const palette = {
    gold: { c: gold, b: `${gold}55`, bg: 'rgba(194,161,78,0.12)' },
    green: { c: '#1f9d63', b: 'rgba(31,157,99,0.4)', bg: 'rgba(31,157,99,0.10)' },
    amber: { c: '#b7791f', b: 'rgba(183,121,31,0.4)', bg: 'rgba(183,121,31,0.10)' },
    blue: { c: '#2b6cb0', b: 'rgba(43,108,176,0.4)', bg: 'rgba(43,108,176,0.10)' },
    neutral: { c: dim, b: line, bg: panel2 },
  }[tone];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 7,
        background: palette.bg, border: `1px solid ${palette.b}`, color: palette.c,
        fontFamily: sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.02em', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function Note({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div
      style={{
        padding: '22px 20px', borderRadius: 14, textAlign: 'center', fontFamily: sans, fontSize: 13.5, lineHeight: 1.5,
        background: tone === 'error' ? 'rgba(192,57,43,0.08)' : panel2,
        border: `1px solid ${tone === 'error' ? 'rgba(192,57,43,0.3)' : line}`,
        color: tone === 'error' ? '#c0392b' : faint,
      }}
    >
      {children}
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
