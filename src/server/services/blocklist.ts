import 'server-only';
import { prisma } from '@/server/db/prisma';
import {
  normIdentity,
  isAnyIdentityBlocked as coreIsAnyIdentityBlocked,
  anyDocumentNumberBlocked as coreAnyDocumentNumberBlocked,
  isDocumentNumberBlocked as coreIsDocumentNumberBlocked,
  type BlocklistDb,
  type BlockKind,
  type IdentityCheck,
} from './blocklist-core';

/**
 * Identity blocklist — server entry point. The matching logic lives in
 * {@link ./blocklist-core} (pure / DB-injected, unit-tested); this module just
 * binds the real Prisma client as the default `db` and keeps the public API
 * stable for every caller (registration, gate/reception check-in, admin block).
 */

export { normIdentity };
export type { BlockKind, IdentityCheck };

/** True when ANY of the supplied identifiers is on the blocklist. */
export function isAnyIdentityBlocked(
  checks: IdentityCheck[],
  db: BlocklistDb = prisma,
): Promise<boolean> {
  return coreIsAnyIdentityBlocked(checks, db);
}

/** Block-check guest DOCUMENT numbers (tested as both national-id and passport). */
export function anyDocumentNumberBlocked(
  numbers: ReadonlyArray<string | null | undefined>,
  db: BlocklistDb = prisma,
): Promise<boolean> {
  return coreAnyDocumentNumberBlocked(numbers, db);
}

/** Single-number convenience wrapper around {@link anyDocumentNumberBlocked}. */
export function isDocumentNumberBlocked(
  number: string | null | undefined,
  db: BlocklistDb = prisma,
): Promise<boolean> {
  return coreIsDocumentNumberBlocked(number, db);
}
