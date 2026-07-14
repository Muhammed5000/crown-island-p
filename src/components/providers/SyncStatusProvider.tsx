'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Client-side mirror of /api/sync/status for the offline-lock UI. On the on-prem
 * LOCAL node it polls connectivity so the "New booking" surfaces can disable
 * themselves BEFORE a click (the server-side `assertBookingWritesEnabled` remains
 * the authoritative lock). On `online` / a single APP_MODE-unset deployment it
 * reads once, sees a non-local mode, and stops — the UI never locks there.
 */
export type SyncActivity = 'idle' | 'pulling' | 'pushing';

/** Counters from the last local file-integrity sweep (see file-sync.ts). */
export interface FileSyncSweep {
  at: string;
  checked: number;
  downloaded: number;
  repaired: number;
  repushQueued: number;
  failed: number;
}

export interface SyncStatus {
  mode: string;
  online: boolean;
  /** false only on a LOCAL node that is currently offline. */
  bookingWritesEnabled: boolean;
  outboxDepth: number;
  /** Pending file-bytes pushes (the MediaFile lane) — a subset of outboxDepth. */
  filePushPending: number;
  /** What the local worker is doing right now (drives the visible indicator). */
  activity: SyncActivity;
  /** Last file-integrity sweep counters, or null before the first sweep. */
  fileSync: FileSyncSweep | null;
  loaded: boolean;
}

const DEFAULT: SyncStatus = {
  mode: 'unset',
  online: true,
  bookingWritesEnabled: true,
  outboxDepth: 0,
  filePushPending: 0,
  activity: 'idle',
  fileSync: null,
  loaded: false,
};

const SyncStatusContext = createContext<SyncStatus>(DEFAULT);

export function useSyncStatus(): SyncStatus {
  return useContext(SyncStatusContext);
}

// Poll fast enough to catch a pull/push (which lasts a few seconds within the
// worker tick) so the on-screen indicator actually shows it.
const POLL_LOCAL_MS = 4_000;
const RETRY_MS = 15_000;

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>(DEFAULT);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch('/api/sync/status', { cache: 'no-store' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const b = (await res.json()) as Partial<SyncStatus>;
        if (!active) return;
        setStatus({
          mode: b.mode ?? 'unset',
          online: b.online !== false,
          // Default TRUE — never lock a deployment on a missing/garbled field.
          bookingWritesEnabled: b.bookingWritesEnabled !== false,
          outboxDepth: b.outboxDepth ?? 0,
          filePushPending: b.filePushPending ?? 0,
          activity: (b.activity as SyncActivity) ?? 'idle',
          fileSync: (b.fileSync as FileSyncSweep | null) ?? null,
          loaded: true,
        });
        // Only the local node changes connectivity; elsewhere one read suffices.
        if (b.mode === 'local') timer = setTimeout(poll, POLL_LOCAL_MS);
      } catch {
        if (!active) return;
        // A hiccup must NOT lock the UI — mark loaded, keep the safe defaults.
        setStatus((s) => ({ ...s, loaded: true }));
        timer = setTimeout(poll, RETRY_MS);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>;
}
