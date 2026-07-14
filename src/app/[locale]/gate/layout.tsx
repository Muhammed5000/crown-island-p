import { setRequestLocale } from 'next-intl/server';
import { requireGateOrNull } from '@/server/auth/guards';
import { isLocale } from '@/i18n/config';

interface Props {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Standalone layout for the gate security scanner (`/gate/**`).
 *
 * Deliberately NOT the admin panel and NOT the guest app — no AdminShell, no
 * app nav. Just a full-bleed midnight canvas the scanner fills edge to edge,
 * so gate staff can run it fullscreen on a phone or kiosk.
 *
 * Access: gate roles only (`requireGateOrNull` permits STAFF / ADMIN /
 * SUPER_ADMIN / DEVELOPER; signed-in customers/testers get a 403 panel;
 * unauthenticated users are bounced to the staff sign-in).
 */
export default async function GateLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const staff = await requireGateOrNull();

  if (!staff) {
    return (
      <main
        dir="ltr"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: 'radial-gradient(ellipse at top, #ffffff 0%, #f4f6f7 55%), #f4f6f7',
          color: '#1c2b40',
          fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 380,
            textAlign: 'center',
            padding: '32px 28px',
            borderRadius: 20,
            background: '#ffffff',
            border: '1px solid rgba(28,43,64,0.12)',
            boxShadow: '0 10px 30px rgba(28,43,64,0.08)',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-aurelia-display), serif',
              fontSize: 28,
              fontWeight: 600,
              color: '#9c7d34',
              margin: 0,
            }}
          >
            403
          </p>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: '12px 0 8px' }}>
            Gate access restricted
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(28,43,64,0.62)', margin: 0 }}>
            You are signed in, but this account is not authorised for gate
            check-in. Ask a supervisor to grant staff access.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div
      dir="ltr"
      style={{
        minHeight: '100dvh',
        // Safety net: keep any single over-wide child (mobile scanner) from
        // horizontally scrolling the whole gate surface. The real width fixes
        // live in the scanner; this only guards against regressions.
        overflowX: 'hidden',
        background: 'radial-gradient(ellipse at top, #ffffff 0%, #f4f6f7 55%), #f4f6f7',
      }}
    >
      {/* The staff-area switch (Reception / Ops desk / Scanner) is rendered
          INLINE inside each surface's own header toolbar (see GateScanner /
          OpsDesk / the reception desk top bar) rather than floating here, so it
          can't overlap header content. */}
      {children}
    </div>
  );
}
