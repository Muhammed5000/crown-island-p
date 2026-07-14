'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { CrownMark } from './primitives';
import { CROWN } from './tokens';

/**
 * Shared success-screen pieces from the "Crown Booking Created Desktop" design
 * handoff — used by the reception desk's booking-created screen AND the
 * check-in wizard's admitted screen so both read as one visual system:
 *
 *   - `SuccessTicket`        boarding-pass entry ticket with the daily visit QR
 *   - `CopyReferenceButton`  copy-to-clipboard with the green "copied" state
 *   - `EntryTracker`         "x of y admitted" gate-status widget
 *   - `successGhostBtn` / `successGoldBtn`  the action-row button styles
 */

// ── CROWN tokens — single source of truth in ./tokens ──
const { cream, dim, faint, gold, bg, panel, panel2, line, ok, warn, serif, sans } = CROWN;

export const successGhostBtn: CSSProperties = {
  flex: 1, height: 52, borderRadius: 14, cursor: 'pointer',
  background: panel2, border: `1px solid ${line}`, color: cream,
  fontFamily: sans, fontSize: 14, fontWeight: 600, letterSpacing: 0.3,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
  textDecoration: 'none',
};

export const successGoldBtn: CSSProperties = {
  width: '100%', height: 58, borderRadius: 15, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(180deg, #c2a14e, #9c7d34)', color: '#ffffff',
  fontFamily: sans, fontSize: 15, fontWeight: 700, letterSpacing: 0.4,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  boxShadow: '0 12px 30px rgba(194,161,78,0.30)', textDecoration: 'none',
};

export function PrinterGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 8V4h10v4M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z" stroke={gold} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Boarding-pass "entry pass" ticket: gold-haloed card with the REAL daily
 * visit QR on a cream plate, a dashed perforation with side notches, and the
 * reference in gold serif. `qrSvg` is rendered server-side (the signed visit
 * token the gate scans); when missing, the plate shows the reference so the
 * ticket still works as a manual-entry fallback.
 */
export function SuccessTicket({ reference, serviceName, qrSvg }: { reference: string; serviceName: string; qrSvg: string | null }) {
  const t = useTranslations('reception.success');
  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          position: 'absolute', inset: -30, borderRadius: 40, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at 50% 30%, rgba(194,161,78,0.16), transparent 65%)',
        }}
      />
      <div
        style={{
          position: 'relative', borderRadius: 24, overflow: 'hidden',
          background: 'linear-gradient(180deg, #ffffff, #f4f6f7)',
          border: `1px solid ${gold}55`,
          boxShadow: '0 30px 70px -28px rgba(28,43,64,0.25)',
        }}
      >
        {/* header */}
        <div
          style={{
            padding: '20px 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${line}`,
            background: 'linear-gradient(180deg, rgba(194,161,78,0.10), transparent)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <CrownMark size={24} color={gold} />
            <div>
              <div style={{ fontFamily: serif, fontSize: 17, fontWeight: 600, color: cream, letterSpacing: 1.5, lineHeight: 1, whiteSpace: 'nowrap' }}>CROWN ISLAND</div>
              <div style={{ fontFamily: sans, fontSize: 8.5, letterSpacing: 2.5, color: faint, marginTop: 5, whiteSpace: 'nowrap' }}>{t('entryPass')}</div>
            </div>
          </div>
          <span
            style={{
              fontFamily: sans, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5,
              padding: '6px 12px', borderRadius: 999,
              background: 'rgba(194,161,78,0.14)', color: gold, border: `1px solid ${gold}55`,
              whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {serviceName.toUpperCase()}
          </span>
        </div>

        {/* QR plate */}
        <div style={{ padding: '30px 26px 22px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ padding: 16, background: '#f5ead0', borderRadius: 18, boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
            {qrSvg ? (
              <>
                {/* The server-rendered QR SVG carries fixed width/height attrs —
                    scale it to the 180px plate exactly like the invoice print CSS. */}
                <style>{'.ci-pass-qr svg{width:100%;height:auto;display:block}'}</style>
                <div
                  role="img"
                  aria-label={t('qrAriaLabel', { reference })}
                  className="ci-pass-qr"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                  style={{ width: 180, height: 180, display: 'block' }}
                />
              </>
            ) : (
              <div style={{ width: 180, height: 180, display: 'grid', placeItems: 'center', color: '#0e1622', fontFamily: sans, fontSize: 13, fontWeight: 700, textAlign: 'center', padding: 8 }}>
                {reference}
              </div>
            )}
          </div>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: dim, marginTop: 16, letterSpacing: 0.3 }}>
            {t('presentAtGate')}
          </div>
        </div>

        {/* perforation */}
        <div style={{ position: 'relative', height: 28 }}>
          <div style={{ position: 'absolute', left: -14, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: 999, background: bg }} />
          <div style={{ position: 'absolute', right: -14, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, borderRadius: 999, background: bg }} />
          <div style={{ position: 'absolute', left: 22, right: 22, top: '50%', borderTop: `2px dashed ${line}` }} />
        </div>

        {/* reference stub */}
        <div style={{ padding: '8px 26px 26px', textAlign: 'center' }}>
          <div style={{ fontFamily: sans, fontSize: 10.5, letterSpacing: 1.6, fontWeight: 600, color: faint }}>{t('reference')}</div>
          <div dir="ltr" style={{ fontFamily: serif, fontSize: 24, fontWeight: 600, color: gold, marginTop: 6, letterSpacing: 1 }}>{reference}</div>
        </div>
      </div>
    </div>
  );
}

export function CopyReferenceButton({ reference, label, copiedLabel }: { reference: string; label?: string; copiedLabel?: string }) {
  const t = useTranslations('reception.success');
  const resolvedLabel = label ?? t('copyReference');
  const resolvedCopiedLabel = copiedLabel ?? t('referenceCopied');
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable (http/permissions) — button simply stays idle */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      style={{
        width: '100%', height: 50, borderRadius: 14, cursor: 'pointer',
        background: panel2, border: `1px solid ${copied ? ok : line}`,
        color: copied ? ok : cream,
        fontFamily: sans, fontSize: 13.5, fontWeight: 600, letterSpacing: 0.3,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'all 0.18s',
      }}
    >
      {copied ? (
        resolvedCopiedLabel
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {resolvedLabel}
        </>
      )}
    </button>
  );
}

/** Localizable strings for the tracker (defaults = English staff desk). */
export interface EntryTrackerCopy {
  title: string;
  admittedOf: (entered: number, guests: number) => string;
  msgNone: (guests: number) => React.ReactNode;
  msgPartial: (entered: number, remaining: number) => React.ReactNode;
  msgAll: string;
}

/**
 * Gate entry-status tracker: "x of y admitted" with one dot per guest (green
 * = already inside) and an amber/green status line. Big parties (> 12) swap
 * the dot row for a single progress bar so the widget never overflows.
 */
export function EntryTracker({ entered, guests, copy }: { entered: number; guests: number; copy?: EntryTrackerCopy }) {
  const t = useTranslations('reception.success');
  const resolvedCopy: EntryTrackerCopy = copy ?? {
    title: t('gateEntryStatus'),
    admittedOf: (e, g) => t('admittedOf', { entered: e, guests: g }),
    msgNone: (g) =>
      t.rich('msgNone', { guests: g, b: (chunks) => <b style={{ color: warn }}>{chunks}</b> }),
    msgPartial: (e, r) =>
      t.rich('msgPartial', {
        entered: e,
        remaining: r,
        b: (chunks) => <b style={{ color: warn }}>{chunks}</b>,
      }),
    msgAll: t('msgAll'),
  };
  const remaining = Math.max(0, guests - entered);
  return (
    <div style={{ borderRadius: 20, background: panel, border: `1px solid ${line}`, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontFamily: sans, fontSize: 11, letterSpacing: 2, fontWeight: 600, color: faint }}>{resolvedCopy.title}</span>
        <span style={{ fontFamily: sans, fontSize: 12.5, fontWeight: 600, color: dim }}>{resolvedCopy.admittedOf(entered, guests)}</span>
      </div>

      {guests <= 12 ? (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          {Array.from({ length: guests }).map((_, i) => {
            const inside = i < entered;
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ width: '100%', height: 6, borderRadius: 99, background: inside ? ok : 'rgba(28,43,64,0.10)' }} />
                <div
                  style={{
                    width: 34, height: 34, borderRadius: 999,
                    background: inside ? 'rgba(31,157,99,0.14)' : panel2,
                    border: `1px solid ${inside ? `${ok}55` : line}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="8" r="3" stroke={inside ? ok : faint} strokeWidth="1.6" />
                    <path d="M6 19c.5-3 3-4.5 6-4.5s5.5 1.5 6 4.5" stroke={inside ? ok : faint} strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ height: 8, borderRadius: 99, background: 'rgba(28,43,64,0.10)', marginBottom: 18, overflow: 'hidden' }}>
          <div style={{ width: `${guests > 0 ? Math.min(100, (entered / guests) * 100) : 0}%`, height: '100%', borderRadius: 99, background: ok, transition: 'width 0.3s' }} />
        </div>
      )}

      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12,
          background: remaining > 0 ? 'rgba(183,121,31,0.10)' : 'rgba(31,157,99,0.10)',
          border: `1px solid ${remaining > 0 ? `${warn}33` : `${ok}33`}`,
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }} aria-hidden>
          <path d="M13 4l-2 7h4l-3 9" stroke={remaining > 0 ? warn : ok} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: cream }}>
          {entered === 0 ? resolvedCopy.msgNone(guests) : remaining > 0 ? resolvedCopy.msgPartial(entered, remaining) : resolvedCopy.msgAll}
        </span>
      </div>
    </div>
  );
}
