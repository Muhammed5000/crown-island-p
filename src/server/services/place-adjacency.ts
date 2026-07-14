/**
 * Pure adjacency recommendation for the reception/gate place picker.
 *
 * Dependency-free (no `server-only`, no Prisma) so it can be unit-tested with
 * `node:test` / `tsx`. Used by `place-assignment.ts` to suggest a block of
 * places next to each other for a multi-unit booking ("cinema seat" style).
 */

export interface PlaceLite {
  id: string;
  zone: string | null;
  position: number;
}

/**
 * Choose `count` places, preferring a consecutive run within a single zone.
 *
 * Strategy (best → fallback):
 *   1. A run of `count` places in the same zone with consecutive `position`s.
 *   2. The first `count` places from whichever zone has the most availability.
 *   3. The first `count` places overall (sorted by zone, then position).
 *
 * Returns the chosen place ids (length `count`), or as many as exist when fewer
 * than `count` are available (so the UI can still pre-select what it can).
 */
export function pickAdjacent(places: PlaceLite[], count: number): string[] {
  if (count <= 0) return [];
  if (places.length <= count) return places.map((p) => p.id);

  // Group by zone (null zone → its own bucket keyed by "").
  const byZone = new Map<string, PlaceLite[]>();
  for (const p of places) {
    const key = p.zone ?? '';
    const arr = byZone.get(key) ?? [];
    arr.push(p);
    byZone.set(key, arr);
  }
  for (const arr of byZone.values()) arr.sort((a, b) => a.position - b.position);

  // 1. Consecutive-position run within a zone.
  for (const arr of byZone.values()) {
    for (let i = 0; i + count <= arr.length; i++) {
      let consecutive = true;
      for (let j = 1; j < count; j++) {
        if (arr[i + j]!.position - arr[i + j - 1]!.position !== 1) {
          consecutive = false;
          break;
        }
      }
      if (consecutive) return arr.slice(i, i + count).map((p) => p.id);
    }
  }

  // 2. Densest zone with at least `count` places.
  let best: PlaceLite[] | null = null;
  for (const arr of byZone.values()) {
    if (arr.length >= count && (!best || arr.length > best.length)) best = arr;
  }
  if (best) return best.slice(0, count).map((p) => p.id);

  // 3. Fallback: first `count` overall, stable order (zone, position).
  const ordered = [...places].sort((a, b) => {
    const za = a.zone ?? '';
    const zb = b.zone ?? '';
    if (za !== zb) return za < zb ? -1 : 1;
    return a.position - b.position;
  });
  return ordered.slice(0, count).map((p) => p.id);
}
