import type { BlockedIdentityKind } from '@prisma/client';
import { toE164 } from '../../lib/phone';

/**
 * Identity blocklist — PURE / DB-injected core shared by the server service
 * (`blocklist.ts`, which binds the real Prisma client) and the unit tests. No
 * `server-only` / prisma imports here, so it loads under `tsx --test`.
 *
 * When an admin blocks a user, their email / phone / national-id / passport are
 * written to `BlockedIdentity`. Every registration + identity-changing entry
 * point calls {@link isAnyIdentityBlocked} so the same person cannot create a
 * new account (or be admitted at the gate / reception) under any of those
 * identifiers.
 */

export type BlockKind = BlockedIdentityKind;

/** Normalise an identifier so writing + checking compare apples to apples. */
export function normIdentity(kind: BlockedIdentityKind, value: string): string {
  const v = value.trim();
  switch (kind) {
    case 'EMAIL':
      return v.toLowerCase();
    case 'PHONE':
      // Canonicalise to E.164 so equivalent formats ("+20 100…", "0100…",
      // "00201…") collapse to ONE value. Stripping punctuation alone left
      // "0100…" ≠ "+20100…", so a re-typed format could slip past the ban list
      // AND the phone @unique constraint.
      return toE164(v);
    case 'PASSPORT':
      return v.toUpperCase();
    case 'NATIONAL_ID':
    default:
      return v;
  }
}

export interface IdentityCheck {
  kind: BlockedIdentityKind;
  value: string | null | undefined;
}

/**
 * Minimal DB surface the blocklist needs. Satisfied structurally by the Prisma
 * client AND any transaction client, and trivially by a test fake — that
 * injection seam is what makes the matching logic unit-testable without a DB.
 */
export interface BlocklistDb {
  blockedIdentity: {
    findFirst(args: {
      where: { OR: Array<{ kind: BlockedIdentityKind; value: string }> };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

/** True when ANY of the supplied identifiers is on the blocklist. */
export async function isAnyIdentityBlocked(
  checks: IdentityCheck[],
  db: BlocklistDb,
): Promise<boolean> {
  const or = checks
    .filter((c): c is { kind: BlockedIdentityKind; value: string } => !!c.value && c.value.trim().length > 0)
    .map((c) => ({ kind: c.kind, value: normIdentity(c.kind, c.value) }));
  if (or.length === 0) return false;
  const hit = await db.blockedIdentity.findFirst({ where: { OR: or }, select: { id: true } });
  return !!hit;
}

/**
 * Block-check reception/gate guest DOCUMENT numbers (ID card / passport).
 *
 * The reception flow records a single document number per guest without storing
 * which document type it came from, so each number is tested under BOTH the
 * NATIONAL_ID and PASSPORT kinds — each normalised its own way (national-id
 * trimmed, passport upper-cased via {@link normIdentity}). A match is therefore
 * caught whether the admin originally blocked the person by national id or by
 * passport. Blank numbers are ignored; returns false when nothing is checkable.
 */
export async function anyDocumentNumberBlocked(
  numbers: ReadonlyArray<string | null | undefined>,
  db: BlocklistDb,
): Promise<boolean> {
  const checks: IdentityCheck[] = [];
  for (const n of numbers) {
    const v = (n ?? '').trim();
    if (!v) continue;
    checks.push({ kind: 'NATIONAL_ID', value: v }, { kind: 'PASSPORT', value: v });
  }
  if (checks.length === 0) return false;
  return isAnyIdentityBlocked(checks, db);
}

/** Single-number convenience wrapper around {@link anyDocumentNumberBlocked}. */
export function isDocumentNumberBlocked(
  number: string | null | undefined,
  db: BlocklistDb,
): Promise<boolean> {
  return anyDocumentNumberBlocked([number], db);
}
