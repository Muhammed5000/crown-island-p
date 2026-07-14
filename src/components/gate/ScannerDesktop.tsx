'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CROWN, fmtEGP } from './tokens';
import { DStat, LogRow, IdleHero } from './primitives';
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
 * Self-contained ticking clock. Isolated in its own component so the
 * 1-second tick re-renders ONLY these few characters — previously the clock
 * state lived on the kiosk root and re-rendered the entire three-column
 * desk (viewfinder, result card, scan log) every second.
 */
function GateClock({ locale }: { locale: 'ar' | 'en' }) {
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [locale]);

  return (
    <div style={{ fontFamily: CROWN.sans, fontSize: 15, fontWeight: 600, color: CROWN.cream, fontVariantNumeric: 'tabular-nums', minWidth: 86, textAlign: 'right' }}>
      {clock}
    </div>
  );
}

/**
 * Desktop gate kiosk — three columns. Left: gate-day tiles, the live viewfinder,
 * and scan/manual actions. Center: the verified pass (ResultCard) or the idle
 * hero. Right: today's recent-scan log and the running revenue tally.
 */
export function ScannerDesktop({ locale, operatorName, staffRole, initialSummary, canViewMoney }: Props) {
  const t = useTranslations('gate');
  const router = useRouter();
  const pathname = usePathname();
  const { phase, pass, visit, selectPass, admitted, busy, error, stats, log, verify, act, reset, mode, setMode } = useGateScan(
    locale,
    initialSummary,
    canViewMoney,
    (bookingId) => router.push(`/gate/reception/checkin/${bookingId}`),
  );
  const [scanning, setScanning] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [reference, setReference] = useState('');

  const submitManual = () => {
    const ref = reference.trim();
    if (!ref) return;
    setManualOpen(false);
    setReference('');
    verify({ reference: ref });
  };

  const switchLanguage = () => {
    const nextLocale = locale === 'ar' ? 'en' : 'ar';
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', maxWidth: 1440, margin: '0 auto', padding: '0 28px' }}>
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 0',
          borderBottom: `1px solid ${CROWN.line}`,
        }}
      >
        <CrownLogo size="sm" />
        {/* Centered surface switch — sits in the header's middle, in flow. */}
        <GateReceptionSwitch role={staffRole} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.4, color: CROWN.faint }}>{t('gateLane')}</div>
            <div style={{ fontFamily: CROWN.serif, fontSize: 18, color: CROWN.cream, lineHeight: 1.1 }}>{t('mainGate')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.4, color: CROWN.faint }}>{t('operator')}</div>
            <div style={{ fontFamily: CROWN.serif, fontSize: 18, color: CROWN.cream, lineHeight: 1.1 }}>{operatorName}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: CROWN.ok, boxShadow: `0 0 8px ${CROWN.okGlow}`, animation: 'crown-pulse 2s infinite' }} />
            <span style={{ fontFamily: CROWN.sans, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, color: CROWN.ok }}>{t('systemOnline')}</span>
          </div>
          <GateClock locale={locale} />
          <button
            onClick={switchLanguage}
            style={{
              background: 'transparent',
              border: `1px solid ${CROWN.gold}55`,
              color: CROWN.gold,
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 'bold',
            }}
          >
            {locale === 'ar' ? 'EN' : 'ع'}
          </button>
          <GateSignOut locale={locale} />
        </div>
      </div>

      {/* Body grid */}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '380px 1fr 320px', gap: 24, padding: '24px 0' }}>
        {/* Left — scan column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          {/* Admit / Exit mode toggle */}
          <div style={{ display: 'flex', gap: 8, padding: 4, background: 'rgba(28,43,64,0.05)', borderRadius: 14, border: `1px solid ${CROWN.line}` }}>
            {(['admit', 'exit'] as const).map((m) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); reset(); setScanning(false); }}
                  aria-pressed={on}
                  style={{
                    flex: 1, height: 42, borderRadius: 11, border: 'none', cursor: 'pointer',
                    background: on ? (m === 'exit' ? CROWN.gold : CROWN.ok) : 'transparent',
                    color: on ? CROWN.panel : CROWN.faint,
                    fontFamily: CROWN.sans, fontSize: 14, fontWeight: 700, letterSpacing: 0.4,
                    transition: 'all 0.16s',
                  }}
                >
                  {m === 'admit' ? t('modeAdmit') : t('modeExit')}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <DStat label={t('admitted').toUpperCase()} value={stats.admitted} c={CROWN.ok} />
            <DStat label={t('onSite').toUpperCase()} value={stats.onSite} c={CROWN.cream} />
            <DStat label={t('exited').toUpperCase()} value={stats.exited} c={CROWN.gold} />
            <DStat label={t('denied').toUpperCase()} value={stats.denied} c={CROWN.bad} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Viewfinder
              size={360}
              active={scanning && phase === 'idle'}
              detected={phase === 'detected'}
              onResult={(data) => verify({ token: data })}
              onCameraError={() => {
                setScanning(false);
                setManualOpen(true);
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
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
            {error && (
              <div style={{ textAlign: 'center', fontFamily: CROWN.sans, fontSize: 12, color: CROWN.bad }}>{error}</div>
            )}
          </div>
        </div>

        {/* Center — result / idle */}
        <div
          style={{
            minHeight: 0,
            borderRadius: 22,
            background: CROWN.panel,
            border: `1px solid ${CROWN.line}`,
            padding: 26,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {phase === 'result' && pass ? (
            <div style={{ minHeight: 0, overflowY: 'auto' }}>
              {visit ? (
                <VisitGroupBar visit={visit} selectedBookingId={pass.bookingId || null} onSelect={selectPass} />
              ) : null}
              <ResultCard pass={pass} admitted={admitted} busy={busy} onAdmit={act} onReset={() => { reset(); setScanning(false); }} variant="desktop" canViewMoney={canViewMoney} mode={mode} />
            </div>
          ) : (
            <IdleHero scanning={phase === 'detected'} />
          )}
        </div>

        {/* Right — recent scans + revenue */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          <div style={{ fontFamily: CROWN.sans, fontSize: 10, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint }}>{t('recentScansTitle').toUpperCase()}</div>
          <div className="crown-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {log.length === 0 ? (
              <div style={{ fontFamily: CROWN.sans, fontSize: 12.5, color: CROWN.faint, padding: '8px 2px' }}>{t('noScans')}</div>
            ) : (
              log.map((e, i) => <LogRow key={`${e.invoice}-${i}`} e={e} />)
            )}
          </div>
          {/* Revenue is money-related — rendered only for money-cleared operators
              (never for SECURITY, whose summary carries no revenue at all). */}
          {canViewMoney && (
            <div
              style={{
                padding: '18px 18px',
                borderRadius: 18,
                background: 'linear-gradient(135deg, rgba(194,161,78,0.12), rgba(194,161,78,0.04))',
                border: `1px solid ${CROWN.gold}55`,
              }}
            >
              <div style={{ fontFamily: CROWN.sans, fontSize: 9.5, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, marginBottom: 6 }}>{t('revenueToday')}</div>
              <div style={{ fontFamily: CROWN.serif, fontSize: 32, fontWeight: 600, color: CROWN.gold, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {fmtEGP(stats.revenue ?? 0)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Manual entry modal */}
      {manualOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(28,43,64,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setManualOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 440,
              background: CROWN.panel,
              borderRadius: 22,
              border: `1px solid ${CROWN.line}`,
              padding: 26,
              animation: 'crown-fadeIn 0.25s ease',
            }}
          >
            <div style={{ fontFamily: CROWN.sans, fontSize: 10, letterSpacing: 1.8, fontWeight: 600, color: CROWN.faint, marginBottom: 12 }}>{t('manualEntryTitle')}</div>
            <input
              autoFocus
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitManual()}
              placeholder="CI-20260525-LM8T3J"
              style={{
                width: '100%',
                height: 54,
                borderRadius: 14,
                background: CROWN.panel2,
                border: `1px solid ${CROWN.line}`,
                color: CROWN.cream,
                fontFamily: CROWN.sans,
                fontSize: 16,
                letterSpacing: 1,
                padding: '0 16px',
                outline: 'none',
                textTransform: 'uppercase',
              }}
            />
            <button
              onClick={submitManual}
              style={{
                marginTop: 14,
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
    </div>
  );
}
