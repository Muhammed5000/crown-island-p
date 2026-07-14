import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';

/**
 * Database backup — a generic, schema-driven export/import of every business
 * table to/from a single JSON file. Driven by the Prisma DMMF so it stays in
 * sync with the schema automatically (no per-model maintenance).
 *
 * SAFETY
 *  - DEVELOPER-only (enforced at the API route).
 *  - Export is read-only.
 *  - Import is ADDITIVE: `createMany({ skipDuplicates: true })` only inserts
 *    rows whose primary/unique key isn't already present — it never updates or
 *    deletes existing data. The whole import runs in ONE transaction, so any
 *    failure rolls the entire thing back (no partial/corrupt state).
 *  - Ephemeral auth tables (sessions, tokens, rate-limits) are skipped: they
 *    regenerate and don't belong in a data backup.
 *
 * The exported file contains sensitive data (password hashes, ID documents,
 * customer PII). It must be stored securely — surfaced as a warning in the UI.
 */

/**
 * Tables that are NOT part of a data backup: transient auth/session state, plus
 * live credential material that regenerates and must never travel in a
 * downloadable JSON file (OAuth access/refresh tokens, per-device web-push
 * secrets). Importing these into another env would resurrect stale credentials.
 */
const SKIP_MODELS = new Set<string>([
  'Session',
  'VerificationToken',
  'EmailVerificationToken',
  'PasswordResetToken',
  'AuthRateLimit',
  'Account', // OAuth access/refresh tokens
  'PushSubscription', // per-device push encryption secrets (p256dh/auth)
]);

export const BACKUP_VERSION = 1;

interface DmmfField {
  name: string;
  kind: 'scalar' | 'object' | 'enum' | 'unsupported';
  type: string;
  isList: boolean;
  relationFromFields?: readonly string[];
}
interface DmmfModel {
  name: string;
  fields: readonly DmmfField[];
}

function backupModels(): DmmfModel[] {
  return (Prisma.dmmf.datamodel.models as unknown as DmmfModel[]).filter(
    (m) => !SKIP_MODELS.has(m.name),
  );
}

/** Prisma client delegate name (lowerCamelCase of the PascalCase model name). */
function delegateFor(modelName: string) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

/**
 * Order models so every table comes AFTER the tables it has a foreign key to
 * (parents first) — required so `createMany` never inserts a child before its
 * parent. DFS post-order; cycles (none in this schema) are broken best-effort.
 */
function dependencyOrder(models: DmmfModel[]): DmmfModel[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const depsOf = (m: DmmfModel) => {
    const out = new Set<string>();
    for (const f of m.fields) {
      if (f.kind === 'object' && f.relationFromFields && f.relationFromFields.length > 0) {
        if (f.type !== m.name && byName.has(f.type)) out.add(f.type);
      }
    }
    return out;
  };
  const ordered: DmmfModel[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  const visit = (name: string) => {
    if (done.has(name) || onStack.has(name)) return;
    onStack.add(name);
    for (const dep of depsOf(byName.get(name)!)) visit(dep);
    onStack.delete(name);
    done.add(name);
    ordered.push(byName.get(name)!);
  };
  for (const m of models) visit(m.name);
  return ordered;
}

export interface BackupFile {
  meta: {
    app: 'crown-island';
    kind: 'db-backup';
    version: number;
    exportedAt: string;
    models: string[];
  };
  data: Record<string, unknown[]>;
}

/** Dump every backed-up table to a plain JSON-serialisable object. */
export async function exportDatabase(exportedAt: string): Promise<BackupFile> {
  const models = backupModels();
  const data: Record<string, unknown[]> = {};
  for (const m of models) {
    const delegate = (prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[
      delegateFor(m.name)
    ]!;
    data[m.name] = await delegate.findMany();
  }
  return {
    meta: {
      app: 'crown-island',
      kind: 'db-backup',
      version: BACKUP_VERSION,
      exportedAt,
      models: models.map((m) => m.name),
    },
    data,
  };
}

/** Coerce a JSON row back into Prisma create input (dates → Date, json nulls). */
function coerceRow(model: DmmfModel, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of model.fields) {
    if (f.kind === 'object') continue; // virtual relation accessor — not a column
    if (!(f.name in row)) continue;
    const v = row[f.name];
    if (f.type === 'Json') {
      out[f.name] = v === null || v === undefined ? Prisma.DbNull : v;
      continue;
    }
    if (v === null || v === undefined) {
      out[f.name] = null;
      continue;
    }
    if (f.type === 'DateTime') {
      out[f.name] = f.isList ? (v as string[]).map((s) => new Date(s)) : new Date(v as string);
      continue;
    }
    out[f.name] = v;
  }
  return out;
}

export interface ImportResult {
  ok: true;
  exportedAt: string | null;
  inserted: Record<string, number>;
  totalInserted: number;
}

/**
 * Additively import a backup file. Inserts only rows not already present
 * (`skipDuplicates`), in FK-dependency order, atomically.
 */
export async function importDatabase(payload: unknown): Promise<ImportResult> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('The file is not a Crown Island backup (expected a JSON object).');
  }
  const file = payload as Partial<BackupFile>;
  if (!file.data || typeof file.data !== 'object' || file.meta?.kind !== 'db-backup') {
    throw new Error('The file is not a Crown Island backup (missing meta.kind / data).');
  }

  const models = dependencyOrder(backupModels());
  const data = file.data as Record<string, unknown[]>;
  const inserted: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      for (const m of models) {
        const rows = data[m.name];
        if (!Array.isArray(rows) || rows.length === 0) {
          inserted[m.name] = 0;
          continue;
        }
        const records = rows.map((r) => coerceRow(m, r as Record<string, unknown>));
        const delegate = (tx as unknown as Record<
          string,
          { createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<{ count: number }> }
        >)[delegateFor(m.name)]!;
        const res = await delegate.createMany({ data: records, skipDuplicates: true });
        inserted[m.name] = res.count;
      }
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return {
    ok: true,
    exportedAt: file.meta?.exportedAt ?? null,
    inserted,
    totalInserted: Object.values(inserted).reduce((a, b) => a + b, 0),
  };
}
