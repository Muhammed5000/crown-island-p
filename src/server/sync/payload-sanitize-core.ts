import { Prisma } from '@prisma/client';

/**
 * Field hygiene for the /api/sync/apply payload — the online master's write
 * path. The push payload is a whole-row JSON snapshot that gets spread straight
 * into a Prisma upsert, so without this the wire format IS the write schema:
 *  - an UNKNOWN key (receiver behind the sender after a rollout, or a junk
 *    field) makes Prisma throw, burning the row's 5 retry attempts + endless
 *    recovery churn for something we can simply drop;
 *  - a nested object/array in a non-Json scalar can never apply — better to
 *    classify it as a permanent reject up-front than let it cycle.
 *
 * Driven by the Prisma DMMF (same pattern as services/backup.ts) so the
 * per-model field table stays in sync with the schema automatically. Pure with
 * respect to the DB (DMMF is static metadata) → unit-testable.
 */

export type SanitizeResult =
  | { ok: true; data: Record<string, unknown>; dropped: string[] }
  | { ok: false; reason: 'bad_value'; field: string };

interface DmmfField {
  name: string;
  kind: 'scalar' | 'object' | 'enum' | 'unsupported';
  type: string;
  isList: boolean;
}
interface DmmfModel {
  name: string;
  fields: readonly DmmfField[];
}

interface ModelFieldTable {
  /** scalar + enum field names — the only keys a snapshot may carry. */
  writable: Set<string>;
  /** the subset typed `Json` — the only fields allowed to hold objects/arrays. */
  json: Set<string>;
  /** scalar LISTS (e.g. String[]) — arrays are the expected shape for these. */
  list: Set<string>;
}

const tableCache = new Map<string, ModelFieldTable | null>();

function fieldTableFor(entityType: string): ModelFieldTable | null {
  const cached = tableCache.get(entityType);
  if (cached !== undefined) return cached;
  const model = (Prisma.dmmf.datamodel.models as unknown as DmmfModel[]).find(
    (m) => m.name === entityType,
  );
  const table: ModelFieldTable | null = model
    ? {
        writable: new Set(
          model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name),
        ),
        json: new Set(
          model.fields.filter((f) => f.kind === 'scalar' && f.type === 'Json').map((f) => f.name),
        ),
        list: new Set(
          model.fields
            .filter((f) => (f.kind === 'scalar' || f.kind === 'enum') && f.isList)
            .map((f) => f.name),
        ),
      }
    : null;
  tableCache.set(entityType, table);
  return table;
}

/**
 * Strip unknown keys and reject impossible values for one pushed snapshot.
 *
 *  - unknown key → silently dropped (returned in `dropped` for logging) —
 *    absorbs sender-newer-than-receiver rollout skew instead of erroring;
 *  - known non-Json, non-list scalar holding an object/array → hard fail
 *    ('bad_value'): Prisma will refuse it on every attempt, so the caller
 *    should classify the row as a permanent reject (dead-letters instead of
 *    retry-churning);
 *  - Json fields accept anything; list fields accept arrays; null is always
 *    allowed (nullability is enforced by the DB, a retryable concern).
 *
 * Unknown MODEL returns ok with the payload untouched — the apply allow-list
 * (isPushable) has already rejected those before this runs.
 */
export function sanitizePayload(
  entityType: string,
  payload: Record<string, unknown>,
): SanitizeResult {
  const table = fieldTableFor(entityType);
  if (!table) return { ok: true, data: payload, dropped: [] };
  const data: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!table.writable.has(key)) {
      dropped.push(key);
      continue;
    }
    if (
      value !== null &&
      typeof value === 'object' &&
      !table.json.has(key) &&
      !(table.list.has(key) && Array.isArray(value))
    ) {
      return { ok: false, reason: 'bad_value', field: key };
    }
    data[key] = value;
  }
  return { ok: true, data, dropped };
}
