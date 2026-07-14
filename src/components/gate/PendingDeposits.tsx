'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { formatMoney } from '@/lib/money';
import { listPendingDepositsAction } from '@/features/reception/insurance-actions';
import type { PendingDepositRow } from '@/server/services/insurance-reads';
import { CROWN } from './tokens';

/**
 * Compact "Pending deposits" worklist for the desk's Today mode: collected
 * deposits whose visit already ended without a checkout decision, plus desk
 * payouts still owed. Each row opens the deposit-checkout window. Renders
 * nothing while empty so the board stays uncluttered.
 */

const { cream, dim, faint, gold, panel, panel2, line, serif, sans, warn } = CROWN;

export function PendingDeposits({ locale }: { locale: 'ar' | 'en' }) {
  const t = useTranslations('reception.today.pendingDeposits');
  const router = useRouter();
  const [rows, setRows] = useState<PendingDepositRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();
  // Age anchor captured once at mount (render must stay pure; day-granularity
  // ages don't need a live clock).
  const [now] = useState(() => Date.now());

  useEffect(() => {
    startLoad(async () => {
      const res = await listPendingDepositsAction();
      if (res.ok) {
        setRows(res.rows);
        setError(null);
      } else {
        setRows([]);
        setError(res.code === 'forbidden' ? null : t('error'));
      }
    });
  }, [t]);

  if (rows.length === 0 && !error) return null;

  const ageDays = (iso: string) =>
    Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));

  return (
    <div style={{ borderRadius: 18, background: panel, border: `1px solid ${warn}45`, padding: '16px 18px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontFamily: serif, fontSize: 19, fontWeight: 600, color: cream }}>{t('title')}</h2>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 999,
            background: 'rgba(183,121,31,0.12)', border: '1px solid rgba(183,121,31,0.4)', color: warn,
            fontFamily: sans, fontSize: 12, fontWeight: 700,
          }}
        >
          {rows.length}
        </span>
      </div>
      {error ? (
        <p style={{ margin: 0, color: '#c0392b', fontFamily: sans, fontSize: 12.5 }}>{error}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => (
            <button
              key={`${r.kind}-${r.bookingId}`}
              type="button"
              onClick={() => router.push(`/gate/reception/checkout/${r.bookingId}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'start',
                padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                background: panel2, border: `1px solid ${line}`, transition: 'border-color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${gold}55`)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = line)}
            >
              <span style={{ flex: 1, minWidth: 0, fontFamily: sans, fontSize: 13.5, fontWeight: 600, color: cream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.guestName}
                <span style={{ color: faint, fontWeight: 500 }}> · #{r.reference}</span>
              </span>
              <span style={{ flexShrink: 0, fontFamily: sans, fontSize: 11.5, fontWeight: 700, color: r.kind === 'DESK_PAYOUT' ? warn : dim, whiteSpace: 'nowrap' }}>
                {r.kind === 'DESK_PAYOUT' ? t('kindDesk') : t('kindForgotten')}
              </span>
              <span style={{ flexShrink: 0, fontFamily: sans, fontSize: 13, fontWeight: 700, color: gold, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {formatMoney(r.amountCents, { locale, currency: 'EGP' })}
              </span>
              <span style={{ flexShrink: 0, fontFamily: sans, fontSize: 11.5, color: faint, whiteSpace: 'nowrap' }}>
                {t('age', { days: ageDays(r.sinceIso) })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
