'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CROWN } from './tokens';
import type { GateSummary } from './useGateScan';
import { ScannerMobile } from './ScannerMobile';
import { ScannerDesktop } from './ScannerDesktop';

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
 * Responsive shell for the gate scanner. Picks the mobile or desktop layout by
 * viewport width and injects the shared keyframes + scrollbar-hide CSS that the
 * inline-styled components rely on. The break is at 900px — tablets in landscape
 * and kiosks get the desktop kiosk; phones get the single-column app.
 */
export function GateScanner({ locale, operatorName, staffRole, initialSummary, canViewMoney }: Props) {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const t = useTranslations('gate');

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return (
    <>
      <GateGlobalStyle />
      {isDesktop === null ? (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: CROWN.faint, fontFamily: CROWN.sans, fontSize: 12, letterSpacing: 0.5 }}>
          {t('loading')}
        </div>
      ) : isDesktop ? (
        <ScannerDesktop locale={locale} operatorName={operatorName} staffRole={staffRole} initialSummary={initialSummary} canViewMoney={canViewMoney} />
      ) : (
        <ScannerMobile locale={locale} operatorName={operatorName} staffRole={staffRole} initialSummary={initialSummary} canViewMoney={canViewMoney} />
      )}
    </>
  );
}

function GateGlobalStyle() {
  return (
    <style>{`
      @keyframes crown-scanline {
        0% { top: 18px; opacity: 0; }
        15% { opacity: 1; }
        85% { opacity: 1; }
        100% { top: calc(100% - 18px); opacity: 0; }
      }
      @keyframes crown-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      @keyframes crown-fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes crown-slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
      .crown-scroll::-webkit-scrollbar { width: 0; height: 0; }
      .crown-scroll { scrollbar-width: none; -ms-overflow-style: none; }
      /* Let the mobile header wordmark scale down on narrow phones instead of
         overflowing — the CrownLogo <img> has a fixed inline width. */
      .crown-gate-logo { max-width: 100%; height: auto; }
    `}</style>
  );
}
