'use client';

import { useState } from 'react';
import { Provider } from 'react-redux';
import { makeStore, type AppStore } from '@/store';

/**
 * Per-component-instance Redux store, created once via lazy `useState` initializer.
 * Avoids the older ref-init pattern that React 19 lint flags.
 */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState<AppStore>(() => makeStore());
  return <Provider store={store}>{children}</Provider>;
}
