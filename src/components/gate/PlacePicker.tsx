'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CROWN, type PlacementView } from './tokens';

interface Props {
  bookingId: string;
  /** Called whenever placement changes, with the new roll-up status. */
  onComplete: (status: PlacementView['status']) => void;
  onClose: () => void;
}

const ngrokHeaders = (): HeadersInit => {
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined' && window.location.hostname.includes('ngrok')) {
    h['ngrok-skip-browser-warning'] = 'true';
  }
  return h;
};

/**
 * Effective out-of-service against the live clock: a place flagged out of
 * service is only *still* out while its window's end (`outageUntil`) is in the
 * future. Re-evaluated on a timer so a tile frees up the instant its downtime
 * ends — no page refresh.
 */
function isOutNow(p: { outOfService?: boolean; outageUntil?: string }, now: number): boolean {
  if (!p.outOfService) return false;
  if (!p.outageUntil) return true; // no end known → treat as still out
  return Date.parse(p.outageUntil) > now;
}

/**
 * Cinema-style live place picker. Loads the booking's placement view, lets the
 * operator select one place per still-unplaced unit (pre-seeded with the
 * adjacency recommendation), and assigns them transactionally. Re-fetches on
 * `place_taken` so a concurrent assignment never lets two bookings grab the same
 * place.
 */
export function PlacePicker({ bookingId, onComplete, onClose }: Props) {
  const t = useTranslations('gate');
  const [view, setView] = useState<PlacementView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The reason banner shown when staff tap an out-of-service (amber) place.
  const [outageInfo, setOutageInfo] = useState<string | null>(null);
  // Tick the clock so out-of-service tiles free up LIVE when their window ends.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(h);
  }, []);

  const buildOutageMsg = useCallback(
    (p: { label: string; outageReason?: string | null; outageUntil?: string }) => {
      const parts = [`${p.label} · ${t('outOfService')}`];
      if (p.outageReason) parts.push(`— ${p.outageReason}`);
      if (p.outageUntil) {
        const until = new Date(p.outageUntil).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        parts.push(`· ${t('outageReturns', { date: until })}`);
      }
      return parts.join(' ');
    },
    [t],
  );

  // Keep the latest onComplete without making it a fetch dependency (the parent
  // passes a fresh inline callback each render). Updated in an effect so we never
  // touch the ref during render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const unplacedUnits = useMemo(
    () => (view ? view.units.filter((u) => !u.placeId) : []),
    [view],
  );
  const needed = unplacedUnits.length;

  const applyView = useCallback((v: PlacementView) => {
    setView(v);
    // Start with NOTHING selected — the operator deliberately picks places (the
    // recommendation is only highlighted as a hint, never auto-applied, so "what
    // you click is what gets saved").
    setSelected([]);
    onCompleteRef.current(v.status);
  }, []);

  // Manual reload (used after a `place_taken` race) — safe to setState here as
  // it runs from an event handler, not an effect.
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gate/places?bookingId=${encodeURIComponent(bookingId)}`, {
        headers: ngrokHeaders(),
      });
      if (!res.ok) {
        setError(t('placesLoadFailed'));
        return;
      }
      const data = (await res.json()) as { placement: PlacementView };
      applyView(data.placement);
    } catch {
      setError(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [bookingId, t, applyView]);

  // Initial fetch on mount — no synchronous setState (loading starts true).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/gate/places?bookingId=${encodeURIComponent(bookingId)}`, {
          headers: ngrokHeaders(),
        });
        if (!active) return;
        if (!res.ok) {
          setError(t('placesLoadFailed'));
          return;
        }
        const data = (await res.json()) as { placement: PlacementView };
        if (!active) return;
        applyView(data.placement);
      } catch {
        if (active) setError(t('networkError'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const toggle = (placeId: string) => {
    setSelected((cur) => {
      if (cur.includes(placeId)) return cur.filter((id) => id !== placeId);
      // At the limit, ignore further picks (predictable — operator must deselect
      // one first) instead of silently replacing an existing choice.
      if (cur.length >= needed) return cur;
      return [...cur, placeId];
    });
  };

  const useRecommended = () => {
    if (!view) return;
    setSelected(view.recommended.slice(0, needed));
  };

  const confirm = async () => {
    if (!view || selected.length !== needed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const assignments = unplacedUnits.map((u, i) => ({ unitIndex: u.unitIndex, placeId: selected[i]! }));
      const res = await fetch('/api/gate/assign-places', {
        method: 'POST',
        headers: ngrokHeaders(),
        body: JSON.stringify({ bookingId, assignments }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'place_taken') {
          setError(t('placeTaken'));
          await reload(); // refresh availability — someone grabbed a place
        } else {
          setError(data.message ?? t('assignFailed'));
        }
        return;
      }
      const placement = data.placement as PlacementView;
      setView(placement);
      setSelected([]);
      onComplete(placement.status);
      if (placement.status === 'COMPLETE') onClose();
    } catch {
      setError(t('networkError'));
    } finally {
      setBusy(false);
    }
  };

  const recommendedSet = useMemo(() => new Set(view?.recommended ?? []), [view]);

  // Layout extents from the admin-arranged coordinates — the picker mirrors the
  // exact floor map the admin built so staff place a guest "on the map".
  const PCELL = 52;
  const cols = Math.max(1, ...(view?.available ?? []).map((p) => p.gridX + 1));
  const rows = Math.max(1, ...(view?.available ?? []).map((p) => p.gridY + 1));

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(28,43,64,0.45)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '90dvh',
          display: 'flex',
          flexDirection: 'column',
          background: CROWN.panel,
          border: `1px solid ${CROWN.line}`,
          borderRadius: 20,
          overflow: 'hidden',
          fontFamily: CROWN.sans,
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: `1px solid ${CROWN.line}` }}>
          <div style={{ fontFamily: CROWN.serif, fontSize: 22, color: CROWN.cream }}>
            {t('assignPlaces')}
          </div>
          <div style={{ fontSize: 12, color: CROWN.dim, marginTop: 4 }}>
            {view
              ? t('assignPlacesHint', {
                  type: view.placeType,
                  selected: selected.length,
                  needed,
                })
              : '…'}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }} className="crown-scroll">
          {loading ? (
            <div style={{ color: CROWN.dim, fontSize: 13 }}>{t('working')}…</div>
          ) : !view ? (
            <div style={{ color: CROWN.bad, fontSize: 13 }}>{error ?? t('placesLoadFailed')}</div>
          ) : (
            <>
              {/* Already-assigned units */}
              {view.units.some((u) => u.placeId) ? (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.6, color: CROWN.faint, marginBottom: 8 }}>
                    {t('assigned').toUpperCase()}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {view.units
                      .filter((u) => u.placeId)
                      .map((u) => (
                        <span
                          key={u.unitIndex}
                          style={{
                            padding: '7px 12px',
                            borderRadius: 10,
                            background: 'rgba(31,157,99,0.12)',
                            border: `1px solid ${CROWN.ok}55`,
                            color: CROWN.ok,
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          ✓ {u.placeLabel}
                        </span>
                      ))}
                  </div>
                </div>
              ) : null}

              {view.available.length === 0 ? (
                <div style={{ color: CROWN.warn, fontSize: 13 }}>{t('noPlaces')}</div>
              ) : (
                <div className="flex flex-col items-center">
                  {/* Selection counter + one-click adjacency suggestion. */}
                  {needed > 0 ? (
                    <div className="mb-4 flex w-full items-center justify-between gap-3">
                      <span style={{ fontSize: 12.5, color: CROWN.dim }}>
                        {t('selectedCount', { selected: selected.length, needed })}
                      </span>
                      {view.recommended.length > 0 ? (
                        <button
                          type="button"
                          onClick={useRecommended}
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: CROWN.gold,
                            border: `1px solid ${CROWN.gold}55`,
                            borderRadius: 999,
                            padding: '6px 12px',
                            background: 'rgba(194,161,78,0.12)',
                            cursor: 'pointer',
                          }}
                        >
                          {t('useRecommended')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Why a place is out of service — revealed on tap, else a hint. */}
                  {outageInfo ? (
                    <div
                      role="status"
                      className="mb-3 flex w-full items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-400/15 px-3 py-2 text-[12.5px] text-amber-800"
                    >
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" />
                      <span className="flex-1">{outageInfo}</span>
                      <button
                        type="button"
                        aria-label={t('close')}
                        onClick={() => setOutageInfo(null)}
                        className="shrink-0 text-amber-700/70 hover:text-amber-800"
                      >
                        ✕
                      </button>
                    </div>
                  ) : view.available.some((p) => isOutNow(p, now)) ? (
                    <p className="mb-3 w-full text-center text-[11px] text-amber-700/80">{t('outageTapHint')}</p>
                  ) : null}

                  {/* Entrance / "screen" marker, mirroring the admin floor map. */}
                  <div className="w-full max-w-md h-1.5 bg-gradient-to-r from-transparent via-gold-400/50 to-transparent rounded-full mb-8 shadow-[0_8px_20px_-4px_rgba(212,165,87,0.3)]" />

                  <div className="w-full overflow-auto">
                    <div
                      className="relative mx-auto"
                      style={{ width: cols * PCELL, height: rows * PCELL, minWidth: 'min-content' }}
                    >
                      {view.available.map((p) => {
                        const isSel = selected.includes(p.id);
                        const isRec = !isSel && recommendedSet.has(p.id);
                        const isOut = isOutNow(p, now);
                        // Taken = unavailable for a non-outage reason (booked). A place
                        // whose outage just ended is no longer out NOR taken → bookable.
                        const isTaken = !p.isAvailable && !p.outOfService;
                        // Accessibility (handicap) cell — bookable ones render blue and
                        // carry a ♿ mark so the operator can steer a guest who needs it.
                        const isHandi = !!p.isHandicap;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              if (isOut) {
                                setOutageInfo(buildOutageMsg(p));
                                return;
                              }
                              toggle(p.id);
                            }}
                            disabled={isTaken}
                            aria-pressed={isSel}
                            title={isOut ? buildOutageMsg(p) : isTaken ? t('taken') : isHandi ? `${p.label} · ${t('accessible')}` : p.label}
                            style={{ position: 'absolute', left: p.gridX * PCELL, top: p.gridY * PCELL }}
                            className={`group flex size-11 items-center justify-center rounded-lg text-[10px] font-bold transition-all duration-200 ${
                              isOut
                                ? 'cursor-pointer border border-amber-500/45 bg-amber-400/20 text-amber-700 hover:bg-amber-400/30'
                                : isTaken
                                  ? 'cursor-not-allowed border border-red-500/25 bg-red-500/10 text-red-600/50'
                                  : isSel
                                    ? 'scale-105 cursor-pointer bg-gold-500 text-white shadow-[0_4px_12px_rgba(194,161,78,0.4)]'
                                    : isHandi
                                      ? 'cursor-pointer border border-sky-500/50 bg-sky-400/15 text-sky-700 hover:bg-sky-400/25'
                                      : isRec
                                        ? 'cursor-pointer border border-gold-400/50 bg-gold-400/15 text-gold-700 hover:bg-gold-400/25'
                                        : 'cursor-pointer border border-navy-900/15 bg-navy-900/[0.04] text-muted-foreground hover:border-gold-400/40 hover:text-gold-700'
                            }`}
                          >
                            {isHandi ? (
                              <span className="pointer-events-none absolute right-0.5 top-0.5 text-[10px] leading-none" aria-hidden>
                                ♿
                              </span>
                            ) : null}
                            {p.label.length > 3 ? p.label.slice(0, 3) : p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-[10px] text-muted-foreground/60">
                    <Legend swatch="border border-gold-400/40 bg-gold-400/15" label={t('recommended')} />
                    <Legend swatch="bg-gold-500" label={t('selectedLabel')} />
                    <Legend swatch="border border-red-500/20 bg-red-500/10" label={t('taken')} />
                    {view.available.some((p) => isOutNow(p, now)) ? (
                      <Legend swatch="border border-amber-400/45 bg-amber-400/15" label={t('outOfService')} />
                    ) : null}
                    {view.available.some((p) => p.isHandicap) ? (
                      <Legend swatch="border border-sky-400/50 bg-sky-400/15" label={t('accessible')} />
                    ) : null}
                  </div>
                </div>
              )}

              {error ? (
                <div style={{ marginTop: 8, color: CROWN.bad, fontSize: 12.5 }} role="alert">
                  {error}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, padding: 16, borderTop: `1px solid ${CROWN.line}` }}>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || needed === 0 || selected.length !== needed}
            style={{
              flex: 1,
              height: 50,
              borderRadius: 14,
              border: 'none',
              cursor: busy || selected.length !== needed ? 'default' : 'pointer',
              background: selected.length === needed && needed > 0 ? CROWN.gold : CROWN.panel2,
              color: selected.length === needed && needed > 0 ? CROWN.panel : CROWN.faint,
              fontFamily: CROWN.sans,
              fontSize: 14,
              fontWeight: 700,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? `${t('working')}…` : `${t('confirmAssign')} · ${selected.length}/${needed}`}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 110,
              height: 50,
              borderRadius: 14,
              cursor: 'pointer',
              background: CROWN.panel2,
              border: `1px solid ${CROWN.line}`,
              color: CROWN.cream,
              fontFamily: CROWN.sans,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block size-3 rounded ${swatch}`} />
      {label}
    </span>
  );
}
