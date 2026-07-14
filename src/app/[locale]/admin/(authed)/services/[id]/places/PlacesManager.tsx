'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Button } from '@/components/ui/Button';
import {
  createPlaceAction,
  bulkAddPlacesAction,
  bulkDeletePlacesAction,
  movePlaceAction,
  setPlaceZkLevelAction,
} from '@/features/admin/place-actions';
import { PlaceInventory, type OutageRow } from './PlaceInventory';

type PlaceType = 'CABIN' | 'CABANA' | 'UMBRELLA' | 'SEAT' | 'SPOT';

interface PlaceRow {
  id: string;
  label: string;
  type: PlaceType;
  zone: string | null;
  position: number;
  gridX: number;
  gridY: number;
  isActive: boolean;
  isHandicap: boolean;
  /** ZKBio access-level id that opens this place's door (ZK services only). */
  zkAccessLevelId: string | null;
  zkDoorLabel: string | null;
  /** Has (or had) booking assignments — protected from deletion. */
  inUse: boolean;
  outages: OutageRow[];
}

interface Props {
  serviceId: string;
  defaultType: PlaceType;
  /** When true, show the per-place ZKBio door access-level editor. */
  requiresAccessControl: boolean;
  places: PlaceRow[];
}

const TYPES: PlaceType[] = ['CABIN', 'CABANA', 'UMBRELLA', 'SEAT', 'SPOT'];
const CELL = 76; // px per grid cell on the layout board

function errorText(code: string): string {
  switch (code) {
    case 'label_taken':
      return 'A place with that label already exists for this service.';
    case 'place_in_use':
      return 'That place is assigned to a booking — deactivate it instead of deleting.';
    case 'invalid_range':
      return 'The “to” number must be ≥ the “from” number.';
    case 'range_too_large':
      return 'Batch is too large (max 500 at a time).';
    case 'invalid_input':
      return 'Some fields are missing or invalid.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

const selectCls =
  'block h-12 w-full rounded-2xl border border-border/60 bg-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent';

export function PlacesManager({ serviceId, defaultType, requiresAccessControl, places }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; code?: string }>, form?: HTMLFormElement) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(errorText(res.code ?? 'unknown'));
        return;
      }
      form?.reset();
      router.refresh();
    });
  }

  // ── Cell removal: click-to-select chips + bulk remove / remove all ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removeFilter, setRemoveFilter] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<null | 'selected' | 'all'>(null);

  const filteredPlaces = useMemo(() => {
    const term = removeFilter.trim().toLowerCase();
    if (!term) return places;
    return places.filter(
      (p) => p.label.toLowerCase().includes(term) || (p.zone ?? '').toLowerCase().includes(term),
    );
  }, [places, removeFilter]);
  const deletableFiltered = useMemo(() => filteredPlaces.filter((p) => !p.inUse), [filteredPlaces]);
  const inUseCount = useMemo(() => places.filter((p) => p.inUse).length, [places]);

  const toggleSelect = (p: PlaceRow) => {
    if (p.inUse) return; // protected — can't be deleted, so not selectable
    setConfirmRemove(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  };

  function runBulkDelete(placeIds: string[] | 'all') {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await bulkDeletePlacesAction({ serviceId, placeIds });
      if (!res.ok) {
        setError(errorText(res.code));
        return;
      }
      setNotice(
        `Removed ${res.deleted} cell${res.deleted === 1 ? '' : 's'}` +
          (res.skippedInUse > 0
            ? ` · ${res.skippedInUse} kept (used by bookings — take them offline instead)`
            : ''),
      );
      setSelected(new Set());
      setConfirmRemove(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      <LayoutBoard serviceId={serviceId} places={places} />

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">add a batch</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Creates a numbered run (e.g. prefix “C”, 1→10 → C1…C10), laid out as new rows on the map
            above. Consecutive numbers in the same zone are treated as adjacent for the reception
            recommendation.
          </p>
        </CardHeader>
        <CardBody>
          <form
            className="grid grid-cols-2 gap-3 md:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(() => bulkAddPlacesAction(serviceId, fd), e.currentTarget);
            }}
          >
            <div>
              <Label htmlFor="bulk-prefix">prefix</Label>
              <Input id="bulk-prefix" name="prefix" dir="ltr" placeholder="C" />
            </div>
            <div>
              <Label htmlFor="bulk-from">from</Label>
              <Input id="bulk-from" name="from" type="number" min={0} dir="ltr" defaultValue={1} />
            </div>
            <div>
              <Label htmlFor="bulk-to">to</Label>
              <Input id="bulk-to" name="to" type="number" min={0} dir="ltr" defaultValue={10} />
            </div>
            <div>
              <Label htmlFor="bulk-zone">zone</Label>
              <Input id="bulk-zone" name="zone" dir="ltr" placeholder="North" />
            </div>
            <div>
              <Label htmlFor="bulk-type">type</Label>
              <select id="bulk-type" name="type" defaultValue={defaultType} className={selectCls}>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {ty}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex h-12 items-center gap-2 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground">
                <input type="checkbox" name="isHandicap" className="size-4 accent-sky-400" />
                <span className="inline-flex items-center gap-1 whitespace-nowrap">♿ handicap</span>
              </label>
            </div>
            <div className="col-span-2 md:col-span-6">
              <Button type="submit" variant="primary" size="md" loading={isPending}>
                add batch
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">add a single place</h2>
        </CardHeader>
        <CardBody>
          <form
            className="grid grid-cols-2 gap-3 md:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(() => createPlaceAction(serviceId, fd), e.currentTarget);
            }}
          >
            <div>
              <Label htmlFor="p-label">label</Label>
              <Input id="p-label" name="label" dir="ltr" placeholder="VIP-1" required />
            </div>
            <div>
              <Label htmlFor="p-zone">zone</Label>
              <Input id="p-zone" name="zone" dir="ltr" placeholder="North" />
            </div>
            <div>
              <Label htmlFor="p-position">position</Label>
              <Input id="p-position" name="position" type="number" min={0} dir="ltr" defaultValue={0} />
            </div>
            <div>
              <Label htmlFor="p-type">type</Label>
              <select id="p-type" name="type" defaultValue={defaultType} className={selectCls}>
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {ty}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex h-12 items-center gap-2 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground">
                <input type="checkbox" name="isHandicap" className="size-4 accent-sky-400" />
                <span className="inline-flex items-center gap-1 whitespace-nowrap">♿ handicap</span>
              </label>
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="outline" size="md" loading={isPending}>
                add place
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {requiresAccessControl ? <ZkDoorEditor serviceId={serviceId} places={places} /> : null}

      <PlaceInventory serviceId={serviceId} places={places} />

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-600">
            remove cells · {places.length} total
            {inUseCount > 0 ? (
              <span className="ms-2 text-[11px] font-normal text-muted-foreground">
                ({inUseCount} protected — used by bookings)
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Click cells to select them, then remove the selection — or remove everything at once.
            Cells used by bookings (🔒) are never deleted; take them <strong>offline</strong> or{' '}
            <strong>out of service</strong> above instead. Deleting is permanent.
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          {places.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cells yet. Add a batch above.</p>
          ) : (
            <>
              {/* toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={removeFilter}
                  onChange={(e) => setRemoveFilter(e.target.value)}
                  dir="ltr"
                  placeholder="Filter by label or zone…"
                  aria-label="Filter cells"
                  className="h-9 w-44 rounded-xl text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deletableFiltered.length === 0}
                  onClick={() => {
                    setConfirmRemove(null);
                    setSelected(new Set(deletableFiltered.map((p) => p.id)));
                  }}
                >
                  select all{removeFilter.trim() ? ' (filtered)' : ''}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0}
                  onClick={() => {
                    setSelected(new Set());
                    setConfirmRemove(null);
                  }}
                >
                  clear
                </Button>
                <div className="grow" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selected.size === 0 || isPending}
                  className="border-danger/40 text-danger hover:bg-danger/10"
                  onClick={() => setConfirmRemove('selected')}
                >
                  remove selected ({selected.size})
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={places.length === 0 || isPending}
                  className="border-danger/40 text-danger hover:bg-danger/10"
                  onClick={() => setConfirmRemove('all')}
                >
                  remove all
                </Button>
              </div>

              {/* confirmation */}
              {confirmRemove ? (
                <div
                  role="alertdialog"
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
                >
                  <span className="min-w-0 flex-1">
                    {confirmRemove === 'all'
                      ? `Permanently remove ALL ${places.length} cells of this service?`
                      : `Permanently remove the ${selected.size} selected cell${selected.size === 1 ? '' : 's'}?`}{' '}
                    Cells used by bookings are kept automatically. This cannot be undone.
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={isPending}
                    className="border-danger/50 text-danger hover:bg-danger/15"
                    onClick={() => runBulkDelete(confirmRemove === 'all' ? 'all' : [...selected])}
                  >
                    yes, remove
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmRemove(null)}>
                    cancel
                  </Button>
                </div>
              ) : null}

              {/* selectable chips */}
              <div className="flex flex-wrap gap-2">
                {filteredPlaces.map((p) => {
                  const isSelected = selected.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={p.inUse}
                      aria-pressed={isSelected}
                      title={
                        p.inUse
                          ? `${p.label} has bookings — protected from deletion`
                          : isSelected
                            ? `${p.label} — selected for removal`
                            : `Select ${p.label} for removal`
                      }
                      onClick={() => toggleSelect(p)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-sm transition-colors ${
                        p.inUse
                          ? 'cursor-not-allowed border-border/30 bg-input/30 text-muted-foreground/60'
                          : isSelected
                            ? 'border-danger/60 bg-danger/15 text-danger'
                            : p.isActive
                              ? 'border-border/60 bg-input text-foreground hover:border-danger/40'
                              : 'border-border/30 bg-input/40 text-muted-foreground hover:border-danger/40'
                      }`}
                    >
                      <span className="font-medium tabular-nums">{p.label}</span>
                      {p.isHandicap ? <span aria-hidden>♿</span> : null}
                      {p.inUse ? <span aria-hidden>🔒</span> : isSelected ? <span aria-hidden>✓</span> : null}
                    </button>
                  );
                })}
                {filteredPlaces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No cells match &ldquo;{removeFilter.trim()}&rdquo;.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ── ZK door access editor ─────────────────────────────────────────────────────
/**
 * Maps each physical place to the ZKBio access-level id that opens its door. Only
 * shown for services flagged `requiresAccessControl`. Each row saves independently
 * (on blur) via the focused `setPlaceZkLevelAction`, mirroring the handicap toggle.
 */
function ZkDoorEditor({ serviceId, places }: { serviceId: string; places: PlaceRow[] }) {
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return places;
    return places.filter(
      (p) =>
        p.label.toLowerCase().includes(term) ||
        (p.zkAccessLevelId ?? '').toLowerCase().includes(term) ||
        (p.zkDoorLabel ?? '').toLowerCase().includes(term),
    );
  }, [places, filter]);

  const mappedCount = places.filter((p) => p.zkAccessLevelId).length;

  return (
    <Card>
      <CardHeader>
        <h2 className="font-display text-base text-gold-600">
          ZK door access · {mappedCount}/{places.length} mapped
        </h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Enter the ZKBio access-level group id that opens each place&rsquo;s door. When a booking
          is assigned this place, the guest&rsquo;s card + QR are bound to that level. The level
          must already be created and synced to the panel in ZKBio. Blank = no door for this place.
        </p>
      </CardHeader>
      <CardBody className="space-y-3">
        {places.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add places first, then map their doors.</p>
        ) : (
          <>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              dir="ltr"
              placeholder="Filter by label or level id…"
              aria-label="Filter places"
              className="h-9 w-56 rounded-xl text-sm"
            />
            <div className="max-h-[440px] divide-y divide-border/40 overflow-auto rounded-2xl border border-border/40">
              {rows.map((p) => (
                <ZkDoorRow key={p.id} serviceId={serviceId} place={p} />
              ))}
              {rows.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No places match the filter.</p>
              ) : null}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ZkDoorRow({ serviceId, place }: { serviceId: string; place: PlaceRow }) {
  const [levelId, setLevelId] = useState(place.zkAccessLevelId ?? '');
  const [doorLabel, setDoorLabel] = useState(place.zkDoorLabel ?? '');
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const savedRef = useRef({ levelId: place.zkAccessLevelId ?? '', doorLabel: place.zkDoorLabel ?? '' });

  function save() {
    if (levelId === savedRef.current.levelId && doorLabel === savedRef.current.doorLabel) return;
    startTransition(async () => {
      const res = await setPlaceZkLevelAction({
        serviceId,
        placeId: place.id,
        zkAccessLevelId: levelId.trim() || null,
        zkDoorLabel: doorLabel.trim() || null,
      });
      if (res.ok) {
        savedRef.current = { levelId, doorLabel };
        setStatus('saved');
      } else {
        setStatus('error');
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="w-16 shrink-0 font-medium tabular-nums text-foreground">{place.label}</span>
      <Input
        value={levelId}
        onChange={(e) => {
          setLevelId(e.target.value);
          setStatus('idle');
        }}
        onBlur={save}
        dir="ltr"
        placeholder="access-level id"
        aria-label={`ZK access level for ${place.label}`}
        className="h-9 min-w-[160px] flex-1 rounded-xl text-sm"
      />
      <Input
        value={doorLabel}
        onChange={(e) => {
          setDoorLabel(e.target.value);
          setStatus('idle');
        }}
        onBlur={save}
        dir="ltr"
        placeholder="door label (optional)"
        aria-label={`ZK door label for ${place.label}`}
        className="h-9 w-40 rounded-xl text-sm"
      />
      <span className="w-14 shrink-0 text-right text-[11px]">
        {isPending ? (
          <span className="text-muted-foreground">saving…</span>
        ) : status === 'saved' ? (
          <span className="text-emerald-600">saved ✓</span>
        ) : status === 'error' ? (
          <span className="text-danger">error</span>
        ) : null}
      </span>
    </div>
  );
}

// ── Drag-to-arrange layout board ──────────────────────────────────────────────
interface DragState {
  id: string;
  // pixel offset of the pointer within the tile
  offsetX: number;
  offsetY: number;
  // live pixel position while dragging
  x: number;
  y: number;
}

function LayoutBoard({ serviceId, places }: { serviceId: string; places: PlaceRow[] }) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement>(null);
  // Optimistic coordinates so the tile stays where it's dropped without waiting
  // for a server round-trip / refresh.
  const [coords, setCoords] = useState<Record<string, { x: number; y: number }>>(() =>
    Object.fromEntries(places.map((p) => [p.id, { x: p.gridX, y: p.gridY }])),
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const [, startMove] = useTransition();

  // Re-sync optimistic state when the server data changes (e.g. after add/delete)
  // using the React-sanctioned "store previous value in state" pattern.
  const placesKey = places.map((p) => `${p.id}:${p.gridX},${p.gridY}`).join('|');
  const [syncedKey, setSyncedKey] = useState(placesKey);
  if (syncedKey !== placesKey) {
    setSyncedKey(placesKey);
    setCoords(Object.fromEntries(places.map((p) => [p.id, { x: p.gridX, y: p.gridY }])));
  }

  const cols = Math.max(8, ...places.map((p) => (coords[p.id]?.x ?? p.gridX) + 2));
  const rows = Math.max(4, ...places.map((p) => (coords[p.id]?.y ?? p.gridY) + 2));

  // All board-rect reads happen inside event handlers (never during render), and
  // drag.x/drag.y are stored BOARD-RELATIVE so render can use them directly.
  function onPointerDown(e: React.PointerEvent, p: PlaceRow) {
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const tile = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetX = e.clientX - tile.left;
    const offsetY = e.clientY - tile.top;
    setDrag({
      id: p.id,
      offsetX,
      offsetY,
      x: tile.left - boardRect.left,
      y: tile.top - boardRect.top,
    });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    setDrag({
      ...drag,
      x: e.clientX - drag.offsetX - boardRect.left,
      y: e.clientY - drag.offsetY - boardRect.top,
    });
  }

  function onPointerUp() {
    if (!drag) return;
    const gx = Math.max(0, Math.round(drag.x / CELL));
    const gy = Math.max(0, Math.round(drag.y / CELL));
    setCoords((c) => ({ ...c, [drag.id]: { x: gx, y: gy } }));
    const id = drag.id;
    startMove(async () => {
      const res = await movePlaceAction({ serviceId, placeId: id, gridX: gx, gridY: gy });
      if (!res.ok) router.refresh(); // revert to server truth on failure
    });
    setDrag(null);
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-display text-base text-gold-600">layout map</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Drag each place to arrange the floor plan. Reception &amp; gate see this exact map when
          assigning a guest. Positions save automatically.
        </p>
      </CardHeader>
      <CardBody>
        {places.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add places below, then arrange them here.</p>
        ) : (
          <div className="overflow-auto">
            <div
              ref={boardRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="relative rounded-2xl border border-border/40 bg-[radial-gradient(circle,rgba(28,43,64,0.08)_1px,transparent_1px)] [background-size:76px_76px]"
              style={{ width: cols * CELL, height: rows * CELL, minWidth: '100%', touchAction: 'none' }}
            >
              {places.map((p) => {
                const c = coords[p.id] ?? { x: p.gridX, y: p.gridY };
                const isDragging = drag?.id === p.id;
                // drag.x/drag.y are already board-relative (set in handlers).
                const left = isDragging ? drag!.x : c.x * CELL;
                const top = isDragging ? drag!.y : c.y * CELL;
                // Handicap cells render blue (the universal accessibility colour)
                // so the floor plan matches what reception/gate see.
                const tileColor = !p.isActive
                  ? 'border-border/40 bg-input/40 text-muted-foreground'
                  : p.isHandicap
                    ? 'border-sky-400/60 bg-sky-400/15 text-sky-700'
                    : 'border-gold-400/50 bg-gold-400/10 text-gold-700';
                return (
                  <button
                    key={p.id}
                    type="button"
                    onPointerDown={(e) => onPointerDown(e, p)}
                    title={`${p.label}${p.zone ? ` · ${p.zone}` : ''}${p.isHandicap ? ' · Accessible' : ''} — drag to move`}
                    className={`absolute flex size-[64px] cursor-grab touch-none select-none flex-col items-center justify-center rounded-xl border text-center active:cursor-grabbing ${tileColor} ${isDragging ? 'z-10 scale-105 shadow-lg' : ''}`}
                    style={{ left, top }}
                  >
                    {p.isHandicap ? (
                      <span className="absolute right-1 top-1 text-[10px] leading-none" aria-hidden>♿</span>
                    ) : null}
                    <span className="text-[13px] font-bold tabular-nums leading-none">{p.label}</span>
                    {p.zone ? <span className="mt-0.5 text-[9px] opacity-70">{p.zone}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
