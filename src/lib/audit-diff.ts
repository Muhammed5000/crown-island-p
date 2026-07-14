/**
 * Audit change diffing — turns an audit row's `before`/`after` JSON snapshots
 * into a readable list of exactly which fields changed and from/to what.
 *
 * Pure (no imports) so it can render in the audit-log viewer, the reports
 * export, and anywhere else. UPDATE → only the keys whose value changed;
 * CREATE (no before) → every `after` field as an addition; DELETE (no after) →
 * every `before` field as a removal.
 */

export interface FieldChange {
  field: string;
  /** Previous value rendered as text, or null when the field didn't exist (created). */
  from: string | null;
  /** New value rendered as text, or null when the field was removed (deleted). */
  to: string | null;
}

/** Render any JSON value compactly for a diff cell. */
export function fmtAuditValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Diff two audit snapshots into the fields that actually changed. Handles
 * object snapshots (the common case), and falls back to a single `value` row
 * when a snapshot is a scalar/array.
 */
export function diffAudit(before: unknown, after: unknown): FieldChange[] {
  const b = asObject(before);
  const a = asObject(after);

  if (!b && !a) {
    const out: FieldChange[] = [];
    if (before !== null && before !== undefined) out.push({ field: 'value', from: fmtAuditValue(before), to: null });
    if (after !== null && after !== undefined) out.push({ field: 'value', from: null, to: fmtAuditValue(after) });
    return out;
  }

  const keys = new Set<string>([...(b ? Object.keys(b) : []), ...(a ? Object.keys(a) : [])]);
  const out: FieldChange[] = [];
  for (const k of keys) {
    const bHas = !!b && k in b;
    const aHas = !!a && k in a;
    const bs = bHas ? fmtAuditValue(b![k]) : undefined;
    const as = aHas ? fmtAuditValue(a![k]) : undefined;
    if (bs === as) continue; // unchanged
    out.push({ field: k, from: bs ?? null, to: as ?? null });
  }
  // Stable, readable order.
  out.sort((x, y) => x.field.localeCompare(y.field));
  return out;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * One-line human summary, e.g. `status: ACTIVE → PAID · amountCents: 500 → 0`.
 * Additions read `+field=value`, removals `−field=value`. Long values are
 * clipped; `maxFields` caps the count with a `… +N more` tail.
 */
export function summarizeAuditChange(before: unknown, after: unknown, maxFields = 8, maxLen = 40): string {
  const diffs = diffAudit(before, after);
  if (diffs.length === 0) return '—';
  const parts = diffs.slice(0, maxFields).map((d) => {
    if (d.from === null) return `+${d.field}=${clip(d.to ?? '', maxLen)}`;
    if (d.to === null) return `−${d.field}=${clip(d.from, maxLen)}`;
    return `${d.field}: ${clip(d.from, maxLen)} → ${clip(d.to, maxLen)}`;
  });
  if (diffs.length > maxFields) parts.push(`… +${diffs.length - maxFields} more`);
  return parts.join('  ·  ');
}
