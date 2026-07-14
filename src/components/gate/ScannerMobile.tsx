'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CROWN } from './tokens';
import { MiniStat } from './primitives';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { Viewfinder } from './Viewfinder';
import { ResultCard } from './ResultCard';
import { VisitGroupBar } from './VisitGroupBar';
import { GateSignOut } from './GateSignOut';
import { GateReceptionSwitch } from './GateReceptionSwitch';
import { useGateScan, type GateSummary } from './useGateScan';
import { useRouter, usePathname } from '@/i18n/navigation';

interface Props {
  locale: 'ar' | 'en';
  operatorName: string;
  /** Signed-in staff role — drives which surface-switch pills the header shows. */
  staffRole: string | null;
  initialSummary: GateSummary;
  /** Whether this operator may see money (false for SECURITY). */
  canViewMoney: boolean;
}

/**
 * Mobile gate scanner — single column app. Header wordmark + gate pill, the
 * gate-day stat strip, the live camera viewfinder, and the scan/manual actions.
 * The verified pass slides up as a bottom sheet rendering the shared ResultCard.
 */
export function ScannerMobile({ locale, staffRole, initialSummary, canViewMoney }: Props) {
  const t = useTranslations('gate');
  const router = useRouter();
  const pathname = usePathname();
  const { phase, pass, visit, selectPass, admitted, busy, error, stats, verify, act, reset, mode, setMode } = useGateScan(
    locale,
    initialSummary,
    canViewMoney,
    (bookingId) => router.push(`/gate/reception/checkin/${bookingId}`),
  );
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [reference, setReference] = useState('');
  /** Camera-error hint surfaced in the manual sheet (e.g. HTTPS / permission). */
  const [camHint, setCamHint] = useState<string | null>(null);

  // The square camera frame is a fixed pixel size, so on narrow phones (≤320px)
  // it can exceed the column's content width and scroll the whole page. Clamp it
  // to the available width: column maxWidth 460, minus the 18px×2 root padding.
  const [vfSize, setVfSize] = useState(296);
  useEffect(() => {
    const apply = () => setVfSize(Math.max(220, Math.min(296, Math.min(460, window.innerWidth) - 36)));
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  const sheetOpen = phase === 'result' && !!pass;

  const submitManual = () => {
    const ref = reference.trim();
    if (!ref) return;
    setManualOpen(false);
    setReference('');
    setScanning(false);
    setCamHint(null);
    verify({ reference: ref });
  };

  const switchLanguage = () => {
    const nextLocale = locale === 'ar' ? 'en' : 'ar';
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <div
      style={{
        maxWidth: 460,
        width: '100%',
        margin: '0 auto',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 18px 26px',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 20 }}>
        <div style={{ flexShrink: 1, minWidth: 0, display: 'flex' }}>
          <CrownLogo size="sm" className="crown-gate-logo" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <div
            style={{
              fontFamily: CROWN.sans,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.4,
              color: CROWN.gold,
              padding: '6px 11px',
              borderRadius: 999,
              background: 'rgba(194,161,78,0.14)',
              border: `1px solid ${CROWN.gold}55`,
              minWidth: 0,
              maxWidth: '100%',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {t('title')}
          </div>
          <button
            onClick={switchLanguage}
            style={{
              background: 'transparent',
              border: `1px solid ${CROWN.gold}55`,
              color: CROWN.gold,
              borderRadius: '50%',
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 'bold',
            }}
          >
            {locale === 'ar' ? 'EN' : 'ع'}
          </button>
          <GateSignOut locale={locale} compact />
        </div>
      </div>

      {/* Surface switch — its own centered row so it never crowds the header. */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
        <GateReceptionSwitch role={staffRole} />
      </div>

      {/* Admit / Exit mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, padding: 4, background: 'rgba(28,43,64,0.05)', borderRadius: 14, border: `1px solid ${CROWN.line}` }}>
        {(['admit', 'exit'] as const).map((m) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); reset(); setScanning(false); }}
              aria-pressed={on}
              style={{
                flex: 1, height: 40, borderRadius: 11, border: 'none', cursor: 'pointer',
                background: on ? (m === 'exit' ? CROWN.gold : CROWN.ok) : 'transparent',
                color: on ? CROWN.panel : CROWN.faint,
                fontFamily: CROWN.sans, fontSize: 13.5, fontWeight: 700, letterSpacing: 0.4,
                transition: 'all 0.16s',
              }}
            >
              {m === 'admit' ? t('modeAdmit') : t('modeExit')}
            </button>
          );
        })}
      </div>

      {/* Stat strip */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        <MiniStat label={t('admitted')} value={stats.admitted} c={CROWN.ok} />
        <MiniStat label={t('onSite')} value={stats.onSite} c={CROWN.cream} />
        <MiniStat label={t('exited')} value={stats.exited} c={CROWN.gold} />
        <MiniStat label={t('vehicles')} value={stats.vehicles} c={CROWN.gold} />
        <MiniStat label={t('denied')} value={stats.denied} c={CROWN.bad} />
      </div>

      {/* Viewfinder */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
        <Viewfinder
          size={vfSize}
          active={scanning && phase === 'idle'}
          detected={phase === 'detected'}
          onResult={(data) => verify({ token: data })}
          onCameraError={(m) => {
            setScanning(false);
            setManualOpen(true);
            setCamHint(m);
          }}
        />
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontFamily: CROWN.serif, fontSize: 26, fontWeight: 500, color: CROWN.cream, lineHeight: 1.1 }}>
          {phase === 'detected' ? t('reading') : t('scanPrompt')}
        </h1>
        <p style={{ margin: '8px auto 0', maxWidth: 300, fontFamily: CROWN.sans, fontSize: 12.5, color: CROWN.dim, lineHeight: 1.5 }}>
          {t('scanDesc')}
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: 14, textAlign: 'center', fontFamily: CROWN.sans, fontSize: 12, color: CROWN.bad }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={() => setScanning((s) => !s)}
          disabled={phase === 'detected'}
          style={{
            height: 54,
            borderRadius: 16,
            border: 'none',
            cursor: 'pointer',
            background: scanning ? CROWN.panel2 : CROWN.gold,
            color: scanning ? CROWN.cream : CROWN.panel,
            fontFamily: CROWN.sans,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          {scanning ? t('stopCamera') : t('startCamera')}
        </button>
        <button
          onClick={() => setManualOpen(true)}
          style={{
            height: 48,
            borderRadius: 14,
            cursor: 'pointer',
            background: 'transparent',
            border: `1px solid ${CROWN.line}`,
            color: CROWN.dim,
            fontFamily: CROWN.sans,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.3,
          }}
        >
          {t('manualEntry')}
        </button>
      </div>

      {/* Manual entry sheet */}
      {manualOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(28,43,64,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => { setManualOpen(false); setCamHint(null); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 460,
              background: CROWN.panel,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTop: `1px solid ${CROWN.line}`,
              padding: '22px 18px calc(22px + env(safe-area-inset-bottom))',
              animation: 'crown-slideUp 0.3s ease',
            }}
          >
            <div style={{ fontFamily: CROWN.sans, fontSize: 10, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, marginBottom: 10 }}>
              {t('manualEntryTitle')}
            </div>
            {camHint && (
              <div style={{ fontFamily: CROWN.sans, fontSize: 11.5, color: CROWN.dim, marginBottom: 12, lineHeight: 1.45 }}>
                {camHint}
              </div>
            )}
            <input
              autoFocus
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitManual()}
              placeholder="CI-20260525-LM8T3J"
              style={{
                width: '100%',
                height: 52,
                borderRadius: 14,
                background: CROWN.panel2,
                border: `1px solid ${CROWN.line}`,
                color: CROWN.cream,
                fontFamily: CROWN.sans,
                fontSize: 15,
                letterSpacing: 1,
                padding: '0 16px',
                outline: 'none',
                textTransform: 'uppercase',
              }}
            />
            <button
              onClick={submitManual}
              style={{
                marginTop: 12,
                width: '100%',
                height: 52,
                borderRadius: 14,
                border: 'none',
                cursor: 'pointer',
                background: CROWN.gold,
                color: CROWN.panel,
                fontFamily: CROWN.sans,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              {t('lookupBooking')}
            </button>
          </div>
        </div>
      )}

      {/* Result bottom sheet */}
      {sheetOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(28,43,64,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 460,
              height: '92%',
              background: CROWN.panel,
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              borderTop: `1px solid ${CROWN.line}`,
              padding: '20px 18px calc(18px + env(safe-area-inset-bottom))',
              animation: 'crown-slideUp 0.34s cubic-bezier(0.22,1,0.36,1)',
            }}
          >
            <div style={{ height: '100%', overflowY: 'auto' }}>
              {visit ? (
                <VisitGroupBar visit={visit} selectedBookingId={pass?.bookingId ?? null} onSelect={selectPass} />
              ) : null}
              <ResultCard
                pass={pass!}
                admitted={admitted}
                busy={busy}
                onAdmit={act}
                onReset={() => {
                  reset();
                  setScanning(false);
                }}
                variant="mobile"
                canViewMoney={canViewMoney}
                mode={mode}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
