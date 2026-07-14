'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/money';
import { searchCustomersAction } from '@/features/reception/actions';
import type { CustomerCandidate } from '@/server/services/customer-360';
import { CROWN } from './tokens';

/**
 * Returning-guest picker for the desk's new-booking wizard — single-select,
 * debounced search over accounts + past walk-ins (`searchCustomersAction`).
 *
 * The picker only SELECTS a candidate; fetching the prefill and filling the
 * wizard belongs to the parent (`onPick`, awaited so the row can show a busy
 * state). One selection at a time: once picked, the search collapses into a
 * "booking for …" chip with a clear action.
 */

const { cream, dim, faint, gold, panel, panel2, line, bad, warn, sans, serif } = CROWN;

export interface PickedCustomer {
  name: string | null;
  phone: string | null;
  sanctionCents: number;
}

interface Props {
  locale: 'ar' | 'en';
  /** Currently applied customer (collapses the search into a chip). */
  selected: PickedCustomer | null;
  /** Apply a candidate to the wizard. Resolve false to surface a pick error. */
  onPick: (candidate: CustomerCandidate) => Promise<boolean>;
  /** Clear the applied customer (back to a blank manual form). */
  onClear: () => void;
}

export function CustomerPicker({ locale, selected, onPick, onClear }: Props) {
  const t = useTranslations('reception.desk.prefill');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<CustomerCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pickError, setPickError] = useState(false);

  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const keyOf = (c: CustomerCandidate) => `${c.userId ?? 'w'}-${c.phone ?? ''}`;

  // Debounced candidate search (same pattern as the desk's other live searches).
  useEffect(() => {
    if (selected) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const q = query.trim();
      if (q.length < 2) {
        if (!cancelled) {
          setCandidates(null);
          setSearching(false);
        }
        return;
      }
      setSearching(true);
      const res = await searchCustomersAction({ query: q });
      if (cancelled) return;
      setCandidates(res.ok ? res.candidates : []);
      setSearching(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, selected]);

  async function pick(c: CustomerCandidate) {
    if (busyKey) return;
    setPickError(false);
    setBusyKey(keyOf(c));
    try {
      const ok = await onPick(c);
      if (ok) {
        setQuery('');
        setCandidates(null);
      } else {
        setPickError(true);
      }
    } finally {
      setBusyKey(null);
    }
  }

  // ── Applied state: compact "booking for …" chip ──
  if (selected) {
    return (
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
          borderRadius: 16, background: 'rgba(194,161,78,0.08)', border: `1px solid ${gold}55`,
        }}
      >
        <ReturnGlyph />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: '1.8px', fontWeight: 700, color: gold }}>
            {t('appliedEyebrow')}
          </div>
          <div style={{ fontFamily: serif, fontSize: 17, color: cream, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selected.name ?? t('unnamed')}
            {selected.phone ? (
              <span dir="ltr" style={{ fontFamily: sans, fontSize: 12.5, color: dim, marginInlineStart: 10 }}>{selected.phone}</span>
            ) : null}
          </div>
        </div>
        {selected.sanctionCents > 0 ? (
          <span style={{ fontFamily: sans, fontSize: 11.5, fontWeight: 700, color: bad, background: 'rgba(192,57,43,0.10)', border: '1px solid rgba(192,57,43,0.35)', borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' }}>
            {t('owes', { amount: money(selected.sanctionCents) })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClear}
          style={{ height: 34, padding: '0 14px', borderRadius: 999, cursor: 'pointer', background: 'transparent', border: `1px solid ${line}`, color: dim, fontFamily: sans, fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}
        >
          {t('clear')}
        </button>
      </div>
    );
  }

  // ── Search state ──
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <ReturnGlyph />
        <div>
          <div style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 700, color: cream }}>{t('title')}</div>
          <div style={{ fontFamily: sans, fontSize: 12, color: faint, marginTop: 1 }}>{t('subtitle')}</div>
        </div>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchPlaceholder')}
        aria-label={t('title')}
        style={{
          width: '100%', height: 48, borderRadius: 13, background: panel2, border: `1px solid ${line}`,
          color: cream, padding: '0 16px', fontSize: 14, fontFamily: sans, outline: 'none',
        }}
      />
      {pickError ? (
        <p role="alert" style={{ color: bad, fontSize: 12.5, margin: '8px 0 0', fontFamily: sans }}>{t('pickError')}</p>
      ) : null}
      {query.trim().length >= 2 ? (
        searching && !candidates ? (
          <p style={{ color: dim, fontSize: 12.5, margin: '10px 0 0', fontFamily: sans }}>{t('searching')}</p>
        ) : !candidates || candidates.length === 0 ? (
          <p style={{ color: faint, fontSize: 12.5, margin: '10px 0 0', fontFamily: sans }}>{t('empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, maxHeight: 264, overflowY: 'auto' }}>
            {candidates.map((c) => {
              const key = keyOf(c);
              const busy = busyKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pick(c)}
                  disabled={busyKey != null}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 13,
                    border: `1px solid ${line}`, background: panel, cursor: busyKey ? 'default' : 'pointer',
                    textAlign: 'start', opacity: busyKey && !busy ? 0.55 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: cream, fontFamily: sans, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name ?? t('unnamed')}
                    </div>
                    <div dir="ltr" style={{ fontSize: 12, color: dim, marginTop: 2, fontFamily: sans, textAlign: 'start' }}>
                      {c.phone ?? c.email ?? t('noContact')}
                      {c.nationalId ? ` · ${c.nationalId}` : ''}
                    </div>
                  </div>
                  {c.isWalkin ? (
                    <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: warn, border: `1px solid ${warn}55`, borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>{t('walkin')}</span>
                  ) : null}
                  {c.sanctionCents > 0 ? (
                    <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: bad, border: '1px solid rgba(192,57,43,0.35)', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>{money(c.sanctionCents)}</span>
                  ) : null}
                  <span style={{ color: busy ? gold : faint, fontSize: 12.5, fontFamily: sans, fontWeight: 600, flexShrink: 0 }}>
                    {busy ? t('applying') : t('use')}
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}

function ReturnGlyph() {
  return (
    <span
      aria-hidden
      style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'rgba(194,161,78,0.12)', border: `1px solid ${gold}55` }}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
        <path d="M17.5 3.5l2 2-2 2" />
      </svg>
    </span>
  );
}
