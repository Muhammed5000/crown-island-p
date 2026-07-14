import { DomainError } from '@/server/services/errors';
import { isLocal } from './config';

/**
 * Guard for ONLINE-OWNED data on the LOCAL venue node. Catalog, settings,
 * promos, tags and the blocklist are mastered on the online deployment and
 * hard-mirrored down by the pull — a local edit "succeeds", then the next pull
 * (≤20s later) silently reverts it, which reads as data loss to the admin.
 * Rather than let that footgun stand, the mutating service functions for those
 * tables call this first and fail LOUDLY on the local node with a message that
 * says where to make the edit. No-op on `online` and on a single (APP_MODE
 * unset) deployment.
 *
 * Deliberately NOT applied to place activate/deactivate: venue ops flows write
 * `ServicePlace.isActive` as part of outage handling (see ops-tickets.ts), so
 * that mixed-ownership wart keeps its current behaviour — documented in
 * docs/SYNC.md as a follow-up.
 */
export class OnlineOwnedError extends DomainError {
  constructor(what: string) {
    super(
      `${what} is managed on the online master — make this change there; the venue mirror is read-only for it.`,
      'online_owned',
      409,
    );
    this.name = 'OnlineOwnedError';
  }
}

/** Throw on the LOCAL node; no-op on online / single deployments. */
export function assertNotLocalNode(what: string): void {
  if (isLocal()) throw new OnlineOwnedError(what);
}
