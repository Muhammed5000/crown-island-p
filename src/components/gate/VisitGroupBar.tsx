'use client';

import { useTranslations } from 'next-intl';
import { CROWN, type GatePass, type GateVisit } from './tokens';

/**
 * Visit group switcher shown above the scanner's result card when one scanned
 * pass covers SEVERAL bookings (the customer's whole day groups under one
 * daily visit code). One chip per booking — status dot, service, entered
 * count — tapping a chip swaps the card to that booking so staff process each
 * one in turn without re-scanning.
 */
export function VisitGroupBar({
  visit,
  selectedBookingId,
  onSelect,
}: {
  visit: GateVisit;
  selectedBookingId: string | null;
  onSelect: (bookingId: string) => void;
}) {
  const t = useTranslations('gate');
  if (visit.passes.length <= 1) return null;

  const dot = (p: GatePass) =>
    p.scan === 'valid' ? CROWN.ok : p.scan === 'used' ? CROWN.warn : CROWN.bad;

  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${CROWN.line}`,
        background: CROWN.panel2,
        padding: '12px 14px',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 10,
          fontFamily: CROWN.sans,
        }}
      >
        <span style={{ fontSize: 10.5, letterSpacing: '0.18em', fontWeight: 700, color: CROWN.gold }}>
          {t('visitPass').toUpperCase()}
        </span>
        <span style={{ fontSize: 12.5, color: CROWN.dim }}>
          {visit.customer} · {visit.date}
        </span>
        <span style={{ fontSize: 12, color: CROWN.faint }}>
          {t('visitBookingCount', { count: visit.bookingCount })}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {visit.passes.map((p) => {
          const selected = p.bookingId === selectedBookingId;
          return (
            <button
              key={p.bookingId}
              type="button"
              onClick={() => onSelect(p.bookingId)}
              aria-pressed={selected}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 12px',
                borderRadius: 11,
                cursor: 'pointer',
                background: selected ? 'rgba(194,161,78,0.14)' : 'rgba(28,43,64,0.04)',
                border: `1px solid ${selected ? CROWN.gold : CROWN.line}`,
                color: selected ? CROWN.cream : CROWN.dim,
                fontFamily: CROWN.sans,
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <span
                aria-hidden
                style={{ width: 8, height: 8, borderRadius: 99, background: dot(p), flexShrink: 0 }}
              />
              <span style={{ whiteSpace: 'nowrap' }}>{p.tier}</span>
              <span dir="ltr" style={{ color: CROWN.faint, fontSize: 11 }}>
                {p.invoice.slice(-6)}
              </span>
              <span style={{ color: CROWN.faint, fontSize: 11, whiteSpace: 'nowrap' }}>
                {p.enteredCount ?? 0}/{p.guests}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
