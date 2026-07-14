/**
 * Conflict rule for `Sanction` — the ONLY bidirectional sync model (venue-issued
 * fines push up; admin fines + settlements pull down). The generic apply-side
 * `updatedAt` guard is WRONG for it: the two timestamps being compared originate
 * on DIFFERENT machines (venue clock vs cloud clock), so a venue clock lagging
 * the cloud makes a legitimate settlement look "stale" and the guard silently
 * drops it — the guest's fine stays ACTIVE on the master and the next pull
 * reverts the local copy too (a lost settlement, i.e. a double-charge risk).
 *
 * Instead of cross-host wall-clock LWW, converge on the DOMAIN state machine
 * (sanctions-core: ACTIVE → PAID/WAIVED/CANCELLED is one-way; settled rows are
 * terminal/immutable). No clocks involved except the both-ACTIVE edit case,
 * where a lost amount/reason edit is annoying but never money-wrong.
 *
 * Pure module (no Prisma import) so the rule matrix is unit-testable — the same
 * pattern as file-integrity-core.ts.
 */

export type SanctionApplyDecision =
  /** Skip the updatedAt guard and upsert — the incoming row must win. */
  | 'apply'
  /** Do not write; report success-noop (the stored row must stand). */
  | 'skip'
  /** No domain rule applies — fall through to the generic updatedAt guard. */
  | 'guard';

/** The subset of Sanction fields the merge rule reads. */
export interface SanctionMergeView {
  status: string;
  settledAt: Date | string | null;
}

/** A sanction is settled once it left ACTIVE or carries a settlement stamp. */
export function isSettledSanction(s: SanctionMergeView): boolean {
  return s.status !== 'ACTIVE' || s.settledAt != null;
}

/**
 * Decide how the ONLINE receiver treats an incoming pushed Sanction snapshot.
 *
 *  - no stored row            → apply  (venue-issued fine lands as-is)
 *  - incoming settled, stored ACTIVE → apply  (a settlement ALWAYS wins over an
 *      unsettled row, timestamps ignored — the dropped-settlement fix)
 *  - incoming ACTIVE, stored settled → skip   (never UN-settle via push;
 *      reactivation is an online-authored action that reaches local via the
 *      pull, not this channel)
 *  - both settled             → skip   (settled is terminal; the first writer
 *      stands and both nodes converge to online's copy via the pull)
 *  - both ACTIVE              → guard  (plain edits; best-effort updatedAt LWW)
 */
export function decideSanctionApply(
  current: SanctionMergeView | null,
  incoming: Record<string, unknown>,
): SanctionApplyDecision {
  if (!current) return 'apply';
  const incomingView: SanctionMergeView = {
    status: typeof incoming.status === 'string' ? incoming.status : 'ACTIVE',
    settledAt: (incoming.settledAt ?? null) as Date | string | null,
  };
  const incomingSettled = isSettledSanction(incomingView);
  const currentSettled = isSettledSanction(current);
  if (incomingSettled && !currentSettled) return 'apply';
  if (!incomingSettled && currentSettled) return 'skip';
  if (incomingSettled && currentSettled) return 'skip';
  return 'guard';
}
