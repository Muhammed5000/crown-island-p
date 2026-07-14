'use client';

import { StoreProvider } from './StoreProvider';
import { ThemeProvider } from './ThemeProvider';
import { ServiceWorkerRegister } from './ServiceWorkerRegister';
// import { DevtoolsLogoutGuard } from '@/components/security/DevtoolsLogoutGuard'; // TEMP disabled (payment debugging)
import { ToastProvider } from '@/components/ui/Toast';
import { SyncStatusProvider } from './SyncStatusProvider';
import { SyncIndicator } from '@/components/sync/SyncIndicator';

/**
 * Single client-boundary wrapping all top-level providers.
 * Keep this list short — every provider here runs on every page.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <StoreProvider>
        <ToastProvider>
          <SyncStatusProvider>
            <ServiceWorkerRegister />
            {/* TEMPORARILY DISABLED (payment debugging): the DevTools-logout guard
                was signing the user out the instant DevTools opened, which blocked
                inspecting the MPGS checkout failure. It is a client-side deterrent
                only — the real authorization boundary is server-side — so removing
                it here has no security impact. Re-enable once payment is resolved. */}
            {/* <DevtoolsLogoutGuard /> */}
            {/* Bottom-left popup: offline / data-syncing status (local node only). */}
            <SyncIndicator />
            {children}
          </SyncStatusProvider>
        </ToastProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
