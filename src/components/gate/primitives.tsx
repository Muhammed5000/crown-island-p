'use client';

import React from 'react';
import { CROWN, SCAN_THEME } from './tokens';

// ─────────────────────────────────────────────────────────
// Crown mark + wordmark
// ─────────────────────────────────────────────────────────
export function CrownMark({ size = 24, color = CROWN.gold }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path
        d="M4 11 L9 21 L23 21 L28 11 L21.5 15 L16 7 L10.5 15 Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8.5 24 L23.5 24" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4" cy="11" r="1.6" fill={color} />
      <circle cx="28" cy="11" r="1.6" fill={color} />
      <circle cx="16" cy="7" r="1.6" fill={color} />
    </svg>
  );
}

export function CrownWordmark({ scale = 1, color = CROWN.cream }: { scale?: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 * scale }}>
      <CrownMark size={28 * scale} color={CROWN.gold} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
        <span
          style={{
            fontFamily: CROWN.serif,
            fontSize: 19 * scale,
            fontWeight: 600,
            color,
            letterSpacing: 3 * scale,
          }}
        >
          CROWN ISLAND
        </span>
        <span
          style={{
            fontFamily: CROWN.sans,
            fontSize: 8 * scale,
            marginTop: 3,
            color: CROWN.faint,
            letterSpacing: 3 * scale,
          }}
        >
          EL MONTAZAH · GATE
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Status mark — check / warn / cross
// ─────────────────────────────────────────────────────────
export function StatusMark({ kind, size = 64 }: { kind: 'check' | 'warn' | 'cross'; size?: number }) {
  const theme = kind === 'check' ? SCAN_THEME.valid : kind === 'warn' ? SCAN_THEME.used : SCAN_THEME.invalid;
  const c = theme.c;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: `radial-gradient(circle, ${theme.glow}, transparent 72%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: size * 0.72,
          height: size * 0.72,
          borderRadius: 999,
          background: c,
          color: CROWN.panel,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.4,
          fontWeight: 700,
        }}
      >
        {kind === 'check' ? '✓' : kind === 'warn' ? '!' : '✕'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Alert banner (used / invalid states)
// ─────────────────────────────────────────────────────────
export function Banner({ c, icon, title, sub }: { c: string; icon: string; title: string; sub: string }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '13px 14px',
        borderRadius: 13,
        marginBottom: 16,
        alignItems: 'flex-start',
        background: `${c}14`,
        border: `1px solid ${c}44`,
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          flexShrink: 0,
          background: c,
          color: CROWN.panel,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 700,
          marginTop: 1,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontFamily: CROWN.sans, fontSize: 13, color: CROWN.cream, fontWeight: 600, lineHeight: 1.35 }}>
          {title}
        </div>
        <div style={{ fontFamily: CROWN.sans, fontSize: 11.5, color: CROWN.dim, marginTop: 4, lineHeight: 1.4 }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Guests / vehicles counter
// ─────────────────────────────────────────────────────────
export function Counter({ label, value, icon }: { label: string; value: number; icon: 'guests' | 'car' }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '14px 16px',
        borderRadius: 14,
        background: CROWN.panel2,
        border: `1px solid ${CROWN.line}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          flexShrink: 0,
          background: 'rgba(194,161,78,0.14)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon === 'guests' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="9" cy="8" r="3" stroke={CROWN.gold} strokeWidth="1.6" />
            <path d="M3.5 19c.6-3.3 3-5 5.5-5s4.9 1.7 5.5 5" stroke={CROWN.gold} strokeWidth="1.6" strokeLinecap="round" />
            <path
              d="M16 6.5a3 3 0 0 1 0 5.5M17.5 19c-.3-2.2-1.3-3.8-2.8-4.6"
              stroke={CROWN.gold}
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity="0.7"
            />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 13l1.5-4.5A2 2 0 0 1 7.4 7h9.2a2 2 0 0 1 1.9 1.5L20 13M4 13h16M4 13v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1M20 13v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1"
              stroke={CROWN.gold}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="7.5" cy="15.5" r="0.6" fill={CROWN.gold} />
            <circle cx="16.5" cy="15.5" r="0.6" fill={CROWN.gold} />
          </svg>
        )}
      </div>
      <div>
        <div style={{ fontFamily: CROWN.serif, fontSize: 28, color: CROWN.cream, lineHeight: 1, fontWeight: 600 }}>
          {value}
        </div>
        <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.5, fontWeight: 600, color: CROWN.faint, marginTop: 3 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Mobile gate-day mini stat
// ─────────────────────────────────────────────────────────
export function MiniStat({ label, value, c }: { label: string; value: number | string; c: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: '11px 9px', borderRadius: 13, background: CROWN.panel2, border: `1px solid ${CROWN.line}` }}>
      <div
        style={{
          fontFamily: CROWN.serif,
          fontSize: 24,
          fontWeight: 600,
          color: c,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: CROWN.sans,
          fontSize: 9.5,
          letterSpacing: 0.6,
          color: CROWN.faint,
          marginTop: 4,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Desktop stat tile
// ─────────────────────────────────────────────────────────
export function DStat({ label, value, c }: { label: string; value: number | string; c: string }) {
  return (
    <div style={{ flex: 1, padding: '14px 16px', borderRadius: 14, background: CROWN.panel2, border: `1px solid ${CROWN.line}` }}>
      <div
        style={{ fontFamily: CROWN.serif, fontSize: 30, fontWeight: 600, color: c, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
      <div style={{ fontFamily: CROWN.sans, fontSize: 10, letterSpacing: 0.8, color: CROWN.faint, marginTop: 5 }}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Desktop recent-scan log row
// ─────────────────────────────────────────────────────────
export interface LogEntry {
  time: string;
  name: string;
  invoice: string;
  guests: number;
  vehicles: number;
  result: 'admitted' | 'denied';
  gate: string;
}

export function LogRow({ e }: { e: LogEntry }) {
  const c = e.result === 'admitted' ? CROWN.ok : CROWN.bad;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 13px',
        borderRadius: 12,
        background: CROWN.panel2,
        border: `1px solid ${CROWN.line}`,
      }}
    >
      <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 99, background: c }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: CROWN.sans,
            fontSize: 13,
            color: CROWN.cream,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {e.name}
        </div>
        <div style={{ fontFamily: CROWN.sans, fontSize: 10.5, color: CROWN.faint, marginTop: 2 }}>
          {e.time} · {e.guests}G · {e.vehicles}V
        </div>
      </div>
      <span
        style={{
          fontFamily: CROWN.sans,
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: 0.8,
          padding: '4px 9px',
          borderRadius: 999,
          color: c,
          background: `${c}1a`,
          border: `1px solid ${c}40`,
        }}
      >
        {e.result === 'admitted' ? 'IN' : 'DENIED'}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Desktop idle hero
// ─────────────────────────────────────────────────────────
import { useTranslations } from 'next-intl';

export function IdleHero({ scanning }: { scanning: boolean }) {
  const t = useTranslations('gate');
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 22,
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 26,
          background: 'rgba(194,161,78,0.12)',
          border: `1px solid ${CROWN.gold}55`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 7V5a2 2 0 0 1 2-2h2M21 7V5a2 2 0 0 0-2-2h-2M3 17v2a2 2 0 0 0 2 2h2M21 17v2a2 2 0 0 1-2 2h-2"
            stroke={CROWN.gold}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <rect x="7" y="7" width="4" height="4" rx="1" stroke={CROWN.gold} strokeWidth="1.4" />
          <rect x="13" y="7" width="4" height="4" rx="1" stroke={CROWN.gold} strokeWidth="1.4" />
          <rect x="7" y="13" width="4" height="4" rx="1" stroke={CROWN.gold} strokeWidth="1.4" />
          <path d="M13 13h1.5v1.5M17 13v1.5M13 17h4" stroke={CROWN.gold} strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <h1 style={{ margin: 0, fontFamily: CROWN.serif, fontSize: 42, fontWeight: 500, lineHeight: 1.05, color: CROWN.cream }}>
          {scanning ? t('readingPass') : t('readyToScan')}
        </h1>
        <p style={{ margin: '12px auto 0', maxWidth: 380, fontFamily: CROWN.sans, fontSize: 14, color: CROWN.dim, lineHeight: 1.55 }}>
          {t('idleHeroDesc')}
        </p>
      </div>
    </div>
  );
}
