'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'ci-theme';

function resolve(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'light';
}

/**
 * Drives the `data-theme` attribute on `<html>`. Persists user choice to localStorage.
 * Defaults to light ("Seaside Daylight") — the off-white/navy/teal/gold look from
 * the Crown Island reference image. Dark is retained as an opt-in choice.
 *
 * Hydration safety: a tiny pre-paint script in the locale layout sets `data-theme`
 * from localStorage before React mounts, so the first paint is correct.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer reads the same value the pre-paint script wrote, so SSR-vs-CSR mismatches
  // are limited to the suppressed `<html data-theme>` attribute.
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);

  useEffect(() => {
    const apply = () => {
      const resolved = resolve(theme);
      document.documentElement.setAttribute('data-theme', resolved);
    };
    apply();

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: resolve(theme), setTheme }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
