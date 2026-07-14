import { configureStore } from '@reduxjs/toolkit';
import bookingFlow from './slices/bookingFlow';

/**
 * Per-request store factory. Next.js may render the same module on multiple requests,
 * so we never export a singleton store — each `<Providers>` boundary creates its own.
 *
 * Theme + locale are deliberately NOT in Redux: theme is owned by `ThemeProvider`
 * (localStorage-backed) and locale by next-intl routing. A former `preferences`
 * slice duplicated both with no sync and was unused; it was removed.
 */
export function makeStore() {
  return configureStore({
    reducer: {
      bookingFlow,
    },
    // Server-trusted data is fetched, not stored in Redux, so default settings are fine.
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
