'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GatePass, GateVisit } from './tokens';
import type { LogEntry } from './primitives';

export type Phase = 'idle' | 'detected' | 'result';

export interface GateSummary {
  admitted: number;
  onSite: number;
  /** Guests scanned out today (live headcount = onSite). */
  exited?: number;
  vehicles: number;
  /** Money-related — absent for SECURITY operators. */
  revenue?: number;
  log: LogEntry[];
}

/** Whether the scanner is admitting guests in, or checking them out. */
export type GateMode = 'admit' | 'exit';

function unknownPass(canViewMoney: boolean, t: (key: string) => string): GatePass {
  return {
    bookingId: '',
    invoice: '—',
    date: '',
    customer: t('unknownPassTitle') ?? 'Unknown pass',
    phone: '—',
    status: 'INVALID',
    package: '—',
    tier: '—',
    services: [],
    ...(canViewMoney ? { total: 0, currency: 'EGP' } : {}),
    guests: 0,
    vehicles: 0,
    scan: 'invalid',
    qrToken: '',
    reason: t('unknownPassReason') ?? 'Pass not recognised — not issued by Crown Island',
  };
}

/**
 * Shared gate-scan state machine + API wiring for both the mobile and desktop
 * scanners. Owns the scan phase, the verified pass, admit/deny actions, and the
 * running session counters/log layered over the server's initial summary.
 */
export function useGateScan(
  locale: 'ar' | 'en',
  initial: GateSummary,
  canViewMoney = false,
  /**
   * Called with the booking id when a VALID pass is scanned by a reception-capable
   * operator (`canViewMoney`). The scanner uses this to flow straight into the
   * staged check-in wizard (data → IDs → places → confirm/admit) instead of the
   * one-tap result card — mirroring the reception desk. SECURITY (no reception
   * access) leaves it unset and keeps the direct admit/deny card.
   */
  onValidScan?: (bookingId: string) => void,
) {
  const t = useTranslations('gate');
  const [phase, setPhase] = useState<Phase>('idle');
  const [pass, setPass] = useState<GatePass | null>(null);
  /** The whole daily visit group the scan opened (null for unknown passes). */
  const [visit, setVisit] = useState<GateVisit | null>(null);
  const [admitted, setAdmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Admit guests in, or check them out at the exit gate. */
  const [mode, setMode] = useState<GateMode>('admit');

  const [stats, setStats] = useState({
    admitted: initial.admitted,
    onSite: initial.onSite,
    exited: initial.exited ?? 0,
    vehicles: initial.vehicles,
    // Money-related: only tracked for money-cleared operators. SECURITY keeps it
    // undefined so no financial figure ever lives in client state.
    revenue: canViewMoney ? (initial.revenue ?? 0) : undefined,
    denied: 0,
  });
  const [log, setLog] = useState<LogEntry[]>(initial.log);

  const tokenRef = useRef<string | null>(null);
  const lockRef = useRef(false);
  // Booking ids already counted toward the on-site/admit totals this session.
  // Guarantees a guest admitted again never bumps the count a second time.
  const admittedIdsRef = useRef<Set<string>>(new Set());

  // Called by the Viewfinder when a QR is decoded, or by manual entry.
  const verify = useCallback(
    async (input: { token?: string; reference?: string }) => {
      if (lockRef.current) return;
      lockRef.current = true;
      tokenRef.current = input.token ?? null;
      setPhase('detected');
      setError(null);
      try {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (window.location.hostname.includes('ngrok')) {
          headers['ngrok-skip-browser-warning'] = 'true';
        }
        const res = await fetch('/api/gate/verify', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...input, locale }),
        });
        if (res.status === 404) {
          setPass(unknownPass(canViewMoney, t));
          setVisit(null);
          setAdmitted(false);
          setPhase('result');
          return;
        }
        if (!res.ok) {
          setError(t('verifyFailed'));
          setPhase('idle');
          lockRef.current = false;
          return;
        }
        const data = (await res.json()) as { pass: GatePass; visit?: GateVisit };
        const group = data.visit ?? null;
        // Valid pass + reception-capable operator → flow into the staged
        // check-in wizard (same as the reception desk), skipping the one-tap
        // card. ONLY when the visit has a single booking — a multi-booking
        // group must show the grouped card first so the operator sees every
        // booking the pass covers and picks which to process.
        // Admit mode only; in exit mode we always show the card.
        if (
          mode === 'admit' &&
          data.pass.scan === 'valid' &&
          canViewMoney &&
          data.pass.bookingId &&
          onValidScan &&
          (group?.passes.length ?? 1) <= 1
        ) {
          onValidScan(data.pass.bookingId);
          return;
        }
        setPass(data.pass);
        setVisit(group);
        setAdmitted(false);
        setPhase('result');
      } catch {
        setError(t('networkError'));
        setPhase('idle');
        lockRef.current = false;
      }
    },
    [locale, canViewMoney, t, onValidScan, mode],
  );

  /** Switch the card to another booking of the same visit group. */
  const selectPass = useCallback(
    (bookingId: string) => {
      const target = visit?.passes.find((p) => p.bookingId === bookingId);
      if (!target) return;
      setPass(target);
      setAdmitted(false);
      setError(null);
    },
    [visit],
  );

  /** Keep the group's copy of a pass in sync after a check-in/out. */
  const syncVisitPass = useCallback((updated: GatePass) => {
    setVisit((v) =>
      v
        ? { ...v, passes: v.passes.map((p) => (p.bookingId === updated.bookingId ? updated : p)) }
        : v,
    );
  }, []);

  const appendLog = useCallback((p: GatePass, result: 'admitted' | 'denied', time: string) => {
    setLog((l) => [
      { time, name: p.customer, invoice: p.invoice, guests: p.guests, vehicles: p.vehicles, result, gate: 'Main' },
      ...l,
    ]);
  }, []);

  // Admit (valid), override (used), or deny (invalid). `opts.guestSeqs` admits
  // specific guests by their ID slot; `opts.count` is the headcount fallback
  // (and the exit headcount in exit mode).
  const act = useCallback(async (opts?: { count?: number; guestSeqs?: number[] }) => {
    if (!pass || busy) return;
    const admitCount = opts?.count;
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const enteredBefore = pass.enteredCount ?? 0;

    // ── Exit mode: scan the party OUT at the gate ──────────────────────────────
    if (mode === 'exit') {
      const onSiteBefore = pass.onSite ?? 0;
      setBusy(true);
      try {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (window.location.hostname.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
        const res = await fetch('/api/gate/check-out', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            token: tokenRef.current,
            bookingId: pass.bookingId,
            reference: pass.invoice,
            locale,
            exitCount: admitCount,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.message ?? 'Check-out failed.');
          setBusy(false);
          return;
        }
        const updated = data.pass as GatePass;
        setPass(updated);
        syncVisitPass(updated);
        setAdmitted(true);
        const exitedNow = Math.max(0, onSiteBefore - (updated.onSite ?? 0));
        setStats((s) => ({
          ...s,
          onSite: Math.max(0, s.onSite - exitedNow),
          exited: s.exited + exitedNow,
        }));
      } catch {
        setError('Network error during check-out.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (pass.scan === 'invalid') {
      setStats((s) => ({ ...s, denied: s.denied + 1 }));
      appendLog(pass, 'denied', now);
      setAdmitted(true); // acknowledge the deny so the footer flips to "scan next"
      // Record the deny server-side for the admin activity report (fire-and-
      // forget — a logging hiccup must never block the gate).
      const denyHeaders: HeadersInit = { 'Content-Type': 'application/json' };
      if (window.location.hostname.includes('ngrok')) {
        denyHeaders['ngrok-skip-browser-warning'] = 'true';
      }
      void fetch('/api/gate/deny', {
        method: 'POST',
        headers: denyHeaders,
        body: JSON.stringify({
          token: tokenRef.current ?? undefined,
          bookingId: pass.bookingId || undefined,
          reference: pass.invoice && pass.invoice !== '—' ? pass.invoice : undefined,
          reason: pass.reason,
        }),
      }).catch(() => {});
      return;
    }

    if (pass.scan === 'used') {
      // Supervisor override — acknowledge re-entry without re-stamping.
      appendLog(pass, 'admitted', now);
      setAdmitted(true);
      return;
    }

    // valid → real check-in
    setBusy(true);
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (window.location.hostname.includes('ngrok')) {
        headers['ngrok-skip-browser-warning'] = 'true';
      }
      const res = await fetch('/api/gate/check-in', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          token: tokenRef.current,
          bookingId: pass.bookingId,
          reference: pass.invoice,
          locale,
          admitCount,
          admitGuestSeqs: opts?.guestSeqs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? 'Check-in failed.');
        setBusy(false);
        return;
      }
      const updated = data.pass as GatePass;
      setPass(updated);
      syncVisitPass(updated);
      setAdmitted(true);
      // Guests admitted on THIS scan = the rise in entered count (partial
      // check-in). Add that to on-site so a partial entry counts only its group.
      const admittedNow = Math.max(0, (updated.enteredCount ?? updated.guests) - enteredBefore);
      const bookingKey = pass.bookingId || tokenRef.current || pass.invoice;
      const firstAdmit = !!bookingKey && !admittedIdsRef.current.has(bookingKey);
      if (bookingKey) admittedIdsRef.current.add(bookingKey);
      setStats((s) => ({
        ...s,
        // Count the ticket once (first admit); always add the guests + cars that
        // actually entered this scan.
        admitted: s.admitted + (firstAdmit ? 1 : 0),
        onSite: s.onSite + admittedNow,
        vehicles: s.vehicles + (firstAdmit ? pass.vehicles : 0),
        revenue: s.revenue === undefined ? undefined : s.revenue + (firstAdmit ? (pass.total ?? 0) : 0),
      }));
      appendLog(pass, 'admitted', now);
    } catch {
      setError('Network error during check-in.');
    } finally {
      setBusy(false);
    }
  }, [pass, busy, locale, appendLog, mode, syncVisitPass]);

  const reset = useCallback(() => {
    setPhase('idle');
    setPass(null);
    setVisit(null);
    setAdmitted(false);
    setBusy(false);
    setError(null);
    tokenRef.current = null;
    lockRef.current = false;
  }, []);

  return { phase, pass, visit, selectPass, admitted, busy, error, stats, log, verify, act, reset, setError, mode, setMode };
}
