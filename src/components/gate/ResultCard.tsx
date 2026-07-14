'use client';

import React, { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { CROWN, SCAN_THEME, fmtEGP, type GatePass } from './tokens';
import { StatusMark, Banner, Counter } from './primitives';
import { printTicketBarcode } from './printTicket';
import { PlacePicker } from './PlacePicker';
import { ImageLightbox, EyeGlyph } from '@/components/ui/ImageLightbox';

function CountBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label === '+' ? 'increase' : 'decrease'}
      style={{
        width: 40, height: 40, borderRadius: 11, cursor: disabled ? 'not-allowed' : 'pointer',
        background: 'rgba(28,43,64,0.05)', border: `1px solid ${CROWN.line}`,
        color: disabled ? CROWN.faint : CROWN.gold, fontSize: 20, fontWeight: 500,
        display: 'grid', placeItems: 'center',
      }}
    >
      {label}
    </button>
  );
}

interface Props {
  pass: GatePass;
  admitted: boolean;
  busy?: boolean;
  /** Admit: `guestSeqs` selects specific guests by ID slot; `count` is the headcount fallback / exit count. */
  onAdmit: (opts?: { count?: number; guestSeqs?: number[] }) => void;
  onReset: () => void;
  variant?: 'mobile' | 'desktop';
  /** Whether this operator may see money (false for SECURITY). */
  canViewMoney?: boolean;
  /** Gate mode — 'exit' swaps the admit action for a check-out action. */
  mode?: 'admit' | 'exit';
}

/**
 * Booking verification card — the heart of the scan result. Shows the verdict
 * header, any alert banner, package/tier, guest & vehicle counts, the service
 * breakdown, the total paid, and the admit/override/deny action.
 */
export function ResultCard({ pass, admitted, busy, onAdmit, onReset, variant = 'mobile', canViewMoney = false, mode = 'admit' }: Props) {
  const t = useTranslations('gate');
  const tHistory = useTranslations('history');
  const locale = useLocale();
  const theme = SCAN_THEME[pass.scan];
  const isDesktop = variant === 'desktop';
  const [printing, setPrinting] = useState(false);

  // Live place-assignment state. Seeded from the pass; the picker updates it as
  // the operator assigns. Re-synced during render (React-sanctioned pattern)
  // whenever a different booking is scanned — no effect, no cascading renders.
  const [placement, setPlacement] = useState(pass.placementStatus ?? 'NOT_REQUIRED');
  const [showPicker, setShowPicker] = useState(false);
  // Headcount to admit on this scan (partial check-in). Re-seeded per booking.
  const passRemaining = pass.remaining ?? pass.guests;
  const roster = pass.guestRoster ?? [];
  const unenteredSeqs = roster.filter((g) => !g.entered).map((g) => g.seq);
  // Children carry no ID row, so they're absent from the roster — but a SECURITY
  // operator (no reception/wizard access) must still be able to admit them.
  // Derive the not-yet-entered child slots (adults+1 … people) and make them
  // selectable alongside the photo cards, so a family party can be fully admitted
  // at the gate instead of getting stuck once the adults are in.
  const childrenEntered = Math.max(0, (pass.enteredCount ?? 0) - roster.filter((g) => g.entered).length);
  const childSeqs = Array.from({ length: pass.children ?? 0 }, (_, i) => (pass.adults ?? 0) + i + 1);
  const selectableChildSeqs = childSeqs.slice(childrenEntered);
  const initialSelected = [...unenteredSeqs, ...selectableChildSeqs];
  const totalSelectable = unenteredSeqs.length + selectableChildSeqs.length;
  const [admitSel, setAdmitSel] = useState(Math.max(1, passRemaining));
  // Per-guest selection: which guests (by ID slot, incl. child headcount slots)
  // are entering on this scan. Defaults to everyone not yet entered.
  const [selectedSeqs, setSelectedSeqs] = useState<Set<number>>(() => new Set(initialSelected));
  const [syncedKey, setSyncedKey] = useState(`${pass.bookingId}:${pass.placementStatus ?? ''}:${pass.enteredCount ?? 0}`);
  const currentKey = `${pass.bookingId}:${pass.placementStatus ?? ''}:${pass.enteredCount ?? 0}`;
  if (currentKey !== syncedKey) {
    setSyncedKey(currentKey);
    setPlacement(pass.placementStatus ?? 'NOT_REQUIRED');
    setShowPicker(false);
    setAdmitSel(Math.max(1, passRemaining));
    setSelectedSeqs(new Set(initialSelected));
  }
  const toggleGuest = (seq: number) =>
    setSelectedSeqs((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  const hasRoster = roster.length > 0;
  // Enlarge an ID photo in a lightbox (without toggling the guest's selection).
  const [zoomDoc, setZoomDoc] = useState<{ src: string; caption: string } | null>(null);

  // A valid pass on a place-required service must have every unit placed before
  // it can be admitted. The server enforces this too (check-in returns
  // `placement_required`); this just drives the UI.
  const needsPlacement =
    pass.scan === 'valid' && !!pass.requiresPlacement && placement !== 'COMPLETE';

  // A valid pass also needs every guest's ID uploaded before admit. The server
  // enforces this (`guest_id_required`); reception staff resolve it on the
  // dedicated check-in screen. SECURITY can't upload, so they only see the gate.
  const needsIds = pass.scan === 'valid' && !!pass.idDocsRequired && !pass.idDocsComplete;
  const idHref = `/${locale === 'en' ? 'en/' : ''}gate/reception/checkin/${pass.bookingId}`;
  const idCount = `${pass.idDocsUploaded ?? 0}/${pass.idDocsTotal ?? pass.guests}`;

  // Only real tickets carry a signed token; an unrecognised pass cannot be printed.
  const canPrint = pass.scan !== 'invalid' && !!pass.qrToken;
  const copies = Math.max(1, pass.guests || 1);

  const handlePrint = async () => {
    if (!canPrint || printing) return;
    setPrinting(true);
    try {
      await printTicketBarcode({
        count: copies,
        invoice: pass.invoice,
        customer: pass.customer,
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Verdict header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: isDesktop ? '4px 4px 22px' : '8px 4px 18px',
          borderBottom: `1px solid ${CROWN.line}`,
        }}
      >
        <StatusMark kind={theme.mark} size={isDesktop ? 60 : 54} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: CROWN.sans, fontSize: 10, letterSpacing: 2.4, fontWeight: 700, color: theme.c, marginBottom: 4 }}>
            {admitted ? t('admittedVerdict') : theme.head.toUpperCase()}
          </div>
          <h2
            style={{
              margin: 0,
              fontFamily: CROWN.serif,
              fontSize: isDesktop ? 34 : 28,
              fontWeight: 500,
              lineHeight: 1,
              color: CROWN.cream,
              letterSpacing: -0.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pass.customer}
          </h2>
          <div style={{ fontFamily: CROWN.sans, fontSize: 11.5, color: CROWN.dim, marginTop: 5, letterSpacing: 0.4 }}>
            {pass.invoice} · {pass.phone}
          </div>
        </div>
      </div>

      {/* Scroll body */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '18px 4px' }} className="crown-scroll">
        {pass.scan === 'used' && (
          <Banner
            c={CROWN.warn}
            icon="!"
            title={`${t('alreadyAdmitted')}${pass.usedAt ? ` ${t('atTime')} ${pass.usedAt}` : ''}${pass.usedGate ? ` · ${pass.usedGate}` : ''}`}
            sub={t('alreadyAdmittedSub')}
          />
        )}
        {pass.scan === 'invalid' && (
          <Banner c={CROWN.bad} icon="✕" title={pass.reason ?? t('invalidPass')} sub={t('invalidPassSub')} />
        )}

        {/* Package + tier */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderRadius: 14,
            marginBottom: 14,
            background: CROWN.panel2,
            border: `1px solid ${CROWN.line}`,
          }}
        >
          <div>
            <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, marginBottom: 4 }}>
              {t('package')}
            </div>
            <div style={{ fontFamily: CROWN.serif, fontSize: 22, color: CROWN.cream, lineHeight: 1 }}>{pass.package}</div>
          </div>
          <div
            style={{
              fontFamily: CROWN.sans,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1.5,
              padding: '7px 13px',
              borderRadius: 999,
              background: 'rgba(194,161,78,0.14)',
              color: CROWN.gold,
              border: `1px solid ${CROWN.gold}55`,
              whiteSpace: 'nowrap',
            }}
          >
            {pass.tier}
          </div>
        </div>

        {/* Guests / vehicles */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <Counter label={tHistory('guests').toUpperCase()} value={pass.guests} icon="guests" />
          <Counter label={t('vehicles').toUpperCase()} value={pass.vehicles} icon="car" />
        </div>

        {/* Per-guest check-in — pick exactly who is entering by their ID photo
            + name. The roster comes from the uploaded guest IDs. */}
        {pass.scan === 'valid' && !admitted && hasRoster ? (
          <div style={{ padding: '14px 16px', borderRadius: 14, marginBottom: 16, background: CROWN.panel2, border: `1px solid ${CROWN.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, textTransform: 'uppercase' }}>
                {t('enteringNow')}
              </div>
              <div style={{ fontFamily: CROWN.sans, fontSize: 12, fontWeight: 700, color: CROWN.gold }}>
                {selectedSeqs.size} / {totalSelectable}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: 8 }}>
              {roster.map((g) => {
                const sel = selectedSeqs.has(g.seq);
                return (
                  <button
                    key={g.seq}
                    type="button"
                    disabled={g.entered}
                    onClick={() => toggleGuest(g.seq)}
                    aria-pressed={!g.entered && sel}
                    title={g.name}
                    style={{
                      position: 'relative',
                      padding: 0,
                      borderRadius: 12,
                      overflow: 'hidden',
                      cursor: g.entered ? 'default' : 'pointer',
                      border: g.entered
                        ? `1px solid ${CROWN.ok}66`
                        : sel
                          ? `2px solid ${CROWN.gold}`
                          : `1px solid ${CROWN.line}`,
                      background: CROWN.panel,
                      opacity: g.entered ? 0.55 : 1,
                      textAlign: 'start',
                      transition: 'border 0.15s, opacity 0.15s',
                    }}
                  >
                    <div style={{ position: 'relative', aspectRatio: '3 / 4', background: '#e3e8ec' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Enlarge ${g.name} ID`}
                        onClick={(e) => { e.stopPropagation(); setZoomDoc({ src: g.imageUrl, caption: g.name }); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setZoomDoc({ src: g.imageUrl, caption: g.name }); } }}
                        style={{
                          position: 'absolute', top: 6, insetInlineStart: 6, width: 24, height: 24, borderRadius: '50%',
                          display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.55)',
                          border: '1px solid rgba(255,255,255,0.25)', color: '#f5ead0', cursor: 'pointer',
                        }}
                      >
                        <EyeGlyph />
                      </span>
                      <div
                        style={{
                          position: 'absolute',
                          top: 6,
                          insetInlineEnd: 6,
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 12,
                          fontWeight: 800,
                          background: g.entered ? CROWN.ok : sel ? CROWN.gold : 'rgba(0,0,0,0.45)',
                          color: g.entered || sel ? '#ffffff' : 'rgba(255,255,255,0.5)',
                          border: g.entered || sel ? 'none' : `1px solid rgba(255,255,255,0.3)`,
                        }}
                      >
                        {g.entered ? '✓' : sel ? '✓' : ''}
                      </div>
                    </div>
                    <div
                      style={{
                        padding: '6px 8px',
                        fontFamily: CROWN.sans,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: g.entered ? CROWN.dim : CROWN.cream,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {g.entered ? `✓ ${g.name}` : g.name}
                    </div>
                  </button>
                );
              })}
              {/* Children (no ID photo) — selectable headcount cards so SECURITY
                  can admit them; the server admits these seqs as headcount. */}
              {selectableChildSeqs.map((seq) => {
                const sel = selectedSeqs.has(seq);
                return (
                  <button
                    key={`child-${seq}`}
                    type="button"
                    onClick={() => toggleGuest(seq)}
                    aria-pressed={sel}
                    title={`${locale === 'ar' ? 'طفل' : 'Child'} ${seq}`}
                    style={{
                      position: 'relative', padding: 0, borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
                      border: sel ? `2px solid ${CROWN.gold}` : `1px solid ${CROWN.line}`,
                      background: CROWN.panel, textAlign: 'start', transition: 'border 0.15s',
                    }}
                  >
                    <div style={{ position: 'relative', aspectRatio: '3 / 4', background: 'rgba(194,161,78,0.06)', display: 'grid', placeItems: 'center' }}>
                      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={CROWN.gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="6" r="3" /><path d="M12 9v6" /><path d="M8 12h8" /><path d="M9 21l3-6 3 6" />
                      </svg>
                      <div
                        style={{
                          position: 'absolute', top: 6, insetInlineEnd: 6, width: 22, height: 22, borderRadius: '50%',
                          display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800,
                          background: sel ? CROWN.gold : 'rgba(0,0,0,0.45)', color: sel ? '#ffffff' : 'rgba(255,255,255,0.5)',
                          border: sel ? 'none' : `1px solid rgba(255,255,255,0.3)`,
                        }}
                      >
                        {sel ? '✓' : ''}
                      </div>
                    </div>
                    <div style={{ padding: '6px 8px', fontFamily: CROWN.sans, fontSize: 11.5, fontWeight: 600, color: CROWN.cream, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {locale === 'ar' ? 'طفل' : 'Child'} {seq}
                    </div>
                  </button>
                );
              })}
            </div>
            {totalSelectable > 0 && selectedSeqs.size === 0 ? (
              <p style={{ color: CROWN.warn, fontSize: 12, marginTop: 10, fontFamily: CROWN.sans }}>
                Select who is entering now.
              </p>
            ) : null}
          </div>
        ) : pass.scan === 'valid' && !admitted && passRemaining >= 1 ? (
          /* Fallback: a booking with no uploaded IDs — admit by headcount. */
          <div style={{ padding: '14px 16px', borderRadius: 14, marginBottom: 16, background: CROWN.panel2, border: `1px solid ${CROWN.line}` }}>
            {(pass.enteredCount ?? 0) > 0 ? (
              <div style={{ fontFamily: CROWN.sans, fontSize: 12.5, color: CROWN.ok, fontWeight: 600, marginBottom: 10 }}>
                ✓ {t('alreadyEntered', { entered: pass.enteredCount ?? 0, total: pass.guests })}
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, textTransform: 'uppercase' }}>
                {t('enteringNow')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <CountBtn label="−" disabled={admitSel <= 1} onClick={() => setAdmitSel((v) => Math.max(1, v - 1))} />
                <span style={{ fontFamily: CROWN.serif, fontSize: 24, fontWeight: 600, color: CROWN.cream, minWidth: 54, textAlign: 'center' }}>
                  {admitSel}<span style={{ color: CROWN.faint, fontSize: 15 }}> / {passRemaining}</span>
                </span>
                <CountBtn label="+" disabled={admitSel >= passRemaining} onClick={() => setAdmitSel((v) => Math.min(passRemaining, v + 1))} />
              </div>
            </div>
          </div>
        ) : null}

        {/* Place assignment status — only for services that require it. */}
        {pass.requiresPlacement ? (
          <div
            onClick={() => !admitted && setShowPicker(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderRadius: 14,
              marginBottom: 16,
              background: CROWN.panel2,
              border: `1px solid ${placement === 'COMPLETE' ? `${CROWN.ok}55` : `${CROWN.warn}55`}`,
              cursor: !admitted ? 'pointer' : 'default',
            }}
          >
            <div>
              <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, marginBottom: 4 }}>
                {t('placement')}
              </div>
              <div style={{ fontFamily: CROWN.sans, fontSize: 13.5, color: CROWN.cream, fontWeight: 600 }}>
                {(pass.placedUnits ?? 0)}/{pass.unitsTotal ?? pass.unitsPerDay ?? 1}
              </div>
            </div>
            <span
              style={{
                fontFamily: CROWN.sans,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                padding: '6px 12px',
                borderRadius: 999,
                color: placement === 'COMPLETE' ? CROWN.ok : CROWN.warn,
                background: placement === 'COMPLETE' ? 'rgba(31,157,99,0.12)' : 'rgba(183,121,31,0.12)',
              }}
            >
              {placement === 'COMPLETE' ? t('placementComplete') : t('placementPending')}
            </span>
          </div>
        ) : null}

        {/* Guest ID collection status — required for every booking. */}
        {pass.idDocsRequired ? (
          React.createElement(
            canViewMoney && !admitted ? 'a' : 'div',
            {
              ...(canViewMoney && !admitted ? { href: idHref } : {}),
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: 14,
                marginBottom: 16,
                textDecoration: 'none',
                background: CROWN.panel2,
                border: `1px solid ${pass.idDocsComplete ? `${CROWN.ok}55` : `${CROWN.warn}55`}`,
                cursor: canViewMoney && !admitted ? 'pointer' : 'default',
              },
            },
            <div key="l">
              <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, marginBottom: 4 }}>
                {t('idDocs')}
              </div>
              <div style={{ fontFamily: CROWN.sans, fontSize: 13.5, color: CROWN.cream, fontWeight: 600 }}>{idCount}</div>
            </div>,
            <span
              key="b"
              style={{
                fontFamily: CROWN.sans,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                padding: '6px 12px',
                borderRadius: 999,
                color: pass.idDocsComplete ? CROWN.ok : CROWN.warn,
                background: pass.idDocsComplete ? 'rgba(31,157,99,0.12)' : 'rgba(183,121,31,0.12)',
              }}
            >
              {pass.idDocsComplete ? t('idStatusComplete') : t('idStatusPending')}
            </span>,
          )
        ) : null}

        {/* Services */}
        <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, marginBottom: 10, paddingLeft: 2 }}>
          {t('services')}
        </div>
        <div style={{ borderRadius: 14, background: CROWN.panel2, border: `1px solid ${CROWN.line}`, overflow: 'hidden', marginBottom: 16 }}>
          {pass.services.length === 0 ? (
            <div style={{ padding: '13px 16px', fontFamily: CROWN.sans, fontSize: 12.5, color: CROWN.faint }}>{t('none')}</div>
          ) : (
            pass.services.map((s, i) => (
              <div
                key={`${s.code}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '13px 16px',
                  borderTop: i > 0 ? `1px solid ${CROWN.line}` : 'none',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: CROWN.sans, fontSize: 13.5, color: CROWN.cream, fontWeight: 500 }}>{s.label}</div>
                  <div style={{ fontFamily: CROWN.sans, fontSize: 10.5, color: CROWN.faint, marginTop: 2, letterSpacing: 0.4 }}>
                    {s.code} · ×{s.qty}
                  </div>
                </div>
                {canViewMoney && s.amount !== undefined && (
                  <div style={{ fontFamily: CROWN.sans, fontSize: 13.5, color: CROWN.cream, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtEGP(s.amount)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Total — money-related, shown only to money-cleared operators. SECURITY
            never receives `pass.total`, so this block is omitted entirely. */}
        {canViewMoney && pass.total !== undefined && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 16px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(194,161,78,0.12), rgba(194,161,78,0.04))',
              border: `1px solid ${CROWN.gold}55`,
            }}
          >
            <div>
              <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, marginBottom: 4 }}>
                {t('totalPaid')}
              </div>
              <div style={{ fontFamily: CROWN.sans, fontSize: 10.5, color: CROWN.dim }}>{t('egyptianPound')} · {pass.status}</div>
            </div>
            <div style={{ fontFamily: CROWN.serif, fontSize: 30, fontWeight: 600, color: CROWN.gold, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {fmtEGP(pass.total)}
            </div>
          </div>
        )}

        {/* Print barcode — one Code 128 copy per guest on the ticket */}
        {canPrint && (
          <button
            onClick={handlePrint}
            disabled={printing}
            style={{
              marginTop: 16,
              width: '100%',
              height: 50,
              borderRadius: 14,
              cursor: printing ? 'default' : 'pointer',
              background: CROWN.panel2,
              border: `1px solid ${CROWN.gold}40`,
              color: CROWN.gold,
              fontFamily: CROWN.sans,
              fontSize: 13.5,
              fontWeight: 700,
              letterSpacing: 0.4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              opacity: printing ? 0.7 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z"
                stroke={CROWN.gold}
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {printing
              ? t('preparing')
              : `${t('printBarcode')} · ${copies} ${copies === 1 ? t('copy') : t('copies')}`}
          </button>
        )}
      </div>

      {/* Action footer */}
      <div style={{ paddingTop: 14, borderTop: `1px solid ${CROWN.line}`, display: 'flex', gap: 10 }}>
        {admitted ? (
          <div
            style={{
              flex: 1,
              height: 54,
              borderRadius: 16,
              background: 'rgba(31,157,99,0.12)',
              border: `1px solid ${CROWN.ok}55`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              color: CROWN.ok,
              fontFamily: CROWN.sans,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            ✓ {mode === 'exit' ? t('checkedOut') : t('checkedIn')} · {pass.usedAt ?? new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
        ) : mode === 'exit' ? (
          // Exit gate: check the party out. Disabled when no one is on site.
          <button
            onClick={() => onAdmit({ count: pass.onSite })}
            disabled={busy || (pass.onSite ?? 0) <= 0}
            style={{
              flex: 1,
              height: 54,
              borderRadius: 16,
              border: 'none',
              cursor: busy || (pass.onSite ?? 0) <= 0 ? 'default' : 'pointer',
              background: (pass.onSite ?? 0) > 0 ? CROWN.gold : 'rgba(28,43,64,0.06)',
              color: (pass.onSite ?? 0) > 0 ? CROWN.onFill : CROWN.faint,
              fontFamily: CROWN.sans,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy
              ? t('working')
              : (pass.onSite ?? 0) > 0
                ? `${t('checkOut')} · ${pass.onSite} ${tHistory('guests')}`
                : t('noneOnSite')}
          </button>
        ) : pass.scan === 'valid' && canViewMoney ? (
          // Reception-capable operators run the staged check-in (data → IDs →
          // places → confirm/admit). SECURITY (no reception access) keeps the
          // direct admit path below.
          <a
            href={idHref}
            style={{
              flex: 1,
              height: 54,
              borderRadius: 16,
              border: 'none',
              cursor: 'pointer',
              background: CROWN.gold,
              color: CROWN.onFill,
              fontFamily: CROWN.sans,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.5,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            ✓ {t('beginCheckIn')} · {pass.guests} {tHistory('guests')}
          </a>
        ) : needsPlacement ? (
          <button
            onClick={() => setShowPicker(true)}
            style={{
              flex: 1,
              height: 54,
              borderRadius: 16,
              border: 'none',
              cursor: 'pointer',
              background: CROWN.gold,
              color: CROWN.onFill,
              fontFamily: CROWN.sans,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            {t('assignPlaces')} · {(pass.placedUnits ?? 0)}/{pass.unitsTotal ?? pass.unitsPerDay ?? 1}
          </button>
        ) : needsIds ? (
          canViewMoney ? (
            <a
              href={idHref}
              style={{
                flex: 1, height: 54, borderRadius: 16, border: 'none', cursor: 'pointer',
                background: CROWN.gold, color: CROWN.onFill, fontFamily: CROWN.sans, fontSize: 14,
                fontWeight: 700, letterSpacing: 0.5, textDecoration: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}
            >
              🪪 {t('collectIds')} · {idCount}
            </a>
          ) : (
            <div
              style={{
                flex: 1, height: 54, borderRadius: 16,
                background: 'rgba(183,121,31,0.12)', border: `1px solid ${CROWN.warn}55`,
                color: CROWN.warn, fontFamily: CROWN.sans, fontSize: 14, fontWeight: 700,
                letterSpacing: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}
            >
              🪪 {t('idDocs')} · {idCount}
            </div>
          )
        ) : (
          <button
            onClick={() =>
              onAdmit(
                hasRoster && pass.scan === 'valid'
                  ? { guestSeqs: [...selectedSeqs] }
                  : { count: pass.scan === 'valid' ? admitSel : undefined },
              )
            }
            disabled={busy || (hasRoster && pass.scan === 'valid' && selectedSeqs.size === 0)}
            style={{
              flex: 1,
              height: 54,
              borderRadius: 16,
              border: 'none',
              cursor: busy ? 'default' : 'pointer',
              background: theme.c,
              color: CROWN.onFill,
              fontFamily: CROWN.sans,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {pass.scan === 'valid' && <span style={{ fontSize: 17 }}>✓</span>}
            {busy
              ? t('working')
              : `${theme.word}${pass.scan === 'valid' ? ` · ${hasRoster ? selectedSeqs.size : admitSel} ${tHistory('guests')}` : ''}`}
          </button>
        )}
        <button
          onClick={onReset}
          style={{
            width: admitted ? undefined : 56,
            flex: admitted ? 1 : undefined,
            height: 54,
            borderRadius: 16,
            cursor: 'pointer',
            background: CROWN.panel2,
            border: `1px solid ${CROWN.line}`,
            color: CROWN.cream,
            fontFamily: CROWN.sans,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.3,
            padding: '0 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {admitted ? t('scanNext') : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M3 12h18" stroke={CROWN.cream} strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      {showPicker && pass.bookingId ? (
        <PlacePicker
          bookingId={pass.bookingId}
          onComplete={(status) => setPlacement(status)}
          onClose={() => setShowPicker(false)}
        />
      ) : null}

      {zoomDoc ? (
        <ImageLightbox src={zoomDoc.src} alt={zoomDoc.caption} caption={zoomDoc.caption} onClose={() => setZoomDoc(null)} />
      ) : null}
    </div>
  );
}
