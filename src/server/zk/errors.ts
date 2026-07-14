/**
 * ZKBio CVSecurity error model — PURE (no `server-only`) so it can be unit-tested
 * and imported by both the API client and the pure provisioning core.
 *
 * The platform wraps every response in `{ code, message, data }`. A NEGATIVE
 * `code` means failure (see §9 of the API reference). `ZkApiError` carries that
 * code; `classifyZkError` turns any thrown error (an API error OR a raw network /
 * timeout failure) into a decision the provisioner can act on without sniffing
 * strings.
 */

/** Human-readable messages for the documented negative codes (API reference §9). */
export const ZK_ERROR_MESSAGES: Record<number, string> = {
  [-1]: 'Program error',
  [-20]: 'Pin number cannot be empty',
  [-22]: 'The person does not exist',
  [-23]: 'The card number has been used',
  [-24]: 'The level group does not exist',
  [-25]: 'No person under the access level',
  [-26]: 'The password has been used',
  [-27]: 'Invalid personnel photo',
  [-29]: 'PIN exception',
  [-40]: 'Authorize access failure',
  [-41]: 'Delete access level failure',
  [-42]: 'Personnel ID or access level id is null',
  [-43]: "Access level id can't be null",
  [-44]: "Door id can't be null",
  [-45]: 'Door open duration must be 1–254 seconds',
  [-46]: "Door name can't be null",
  [-47]: "Door doesn't exist",
  [-48]: "Device serial number can't be null",
  [-90]: 'pageNo/pageSize cannot be ≤ 0',
  [-91]: 'pageSize is greater than 1000',
  [-92]: 'pageSize and pageNo cannot be empty',
  [-254]: 'User in the block list',
};

/** Returns a readable label for a ZK error code (falls back to the raw code). */
export function zkErrorMessage(code: number, fallback?: string): string {
  return ZK_ERROR_MESSAGES[code] ?? fallback ?? `ZK error ${code}`;
}

/**
 * An error returned by the ZK platform: the envelope came back with `code < 0`.
 * Distinct from a transport failure (network/timeout), which is a plain Error.
 */
export class ZkApiError extends Error {
  readonly name = 'ZkApiError';
  constructor(
    /** The negative platform code (API reference §9). */
    readonly zkCode: number,
    /** The platform's `message` field (or our derived label). */
    readonly zkMessage: string,
    /** The endpoint path that failed, for logs (never includes the token). */
    readonly endpoint?: string,
  ) {
    super(`ZK ${endpoint ?? 'call'} failed (code ${zkCode}): ${zkMessage}`);
  }
}

export function isZkApiError(err: unknown): err is ZkApiError {
  return err instanceof ZkApiError;
}

/**
 * What kind of failure this is, and how the provisioner should react.
 *   transient     — network/timeout/5xx/-1: retry later (reconciler will).
 *   card_conflict — the claimed card number is already used in ZK: drop it,
 *                   claim a different one, retry.
 *   not_found     — the person/entity doesn't exist (idempotent for deletes).
 *   config        — an admin misconfiguration (missing level/door): needs a human,
 *                   retrying won't help until the config is fixed.
 *   fatal         — anything else we can't auto-recover from.
 */
export type ZkErrorKind = 'transient' | 'card_conflict' | 'not_found' | 'config' | 'fatal';

export interface ZkErrorDecision {
  kind: ZkErrorKind;
  /** Worth retrying automatically (immediately or via the reconciler). */
  retryable: boolean;
  /** The current card should be released and a different one claimed. */
  releaseCard: boolean;
  /** Surface to an admin — provisioning cannot succeed until they act. */
  adminActionable: boolean;
  /** A short, stable reason string stored on `Booking.zkLastError`. */
  reason: string;
}

/** Codes that mean an access-level / door / device is misconfigured in ZKBio. */
const CONFIG_CODES = new Set([-24, -25, -40, -41, -42, -43, -44, -46, -47, -48]);

/**
 * Classify any error thrown while talking to ZK. Pure and total: a non-ZK error
 * (fetch abort, DNS failure, JSON parse) is treated as transient so the booking
 * is retried rather than permanently failed.
 */
export function classifyZkError(err: unknown): ZkErrorDecision {
  if (isZkApiError(err)) {
    const code = err.zkCode;
    if (code === -23) {
      return {
        kind: 'card_conflict',
        retryable: true,
        releaseCard: true,
        adminActionable: false,
        reason: 'card_in_use',
      };
    }
    if (code === -22) {
      return {
        kind: 'not_found',
        retryable: false,
        releaseCard: false,
        adminActionable: false,
        reason: 'person_not_found',
      };
    }
    if (code === -1) {
      // Generic server-side error — usually transient. Let the reconciler retry.
      return {
        kind: 'transient',
        retryable: true,
        releaseCard: false,
        adminActionable: false,
        reason: 'zk_program_error',
      };
    }
    if (CONFIG_CODES.has(code)) {
      return {
        kind: 'config',
        retryable: false,
        releaseCard: false,
        adminActionable: true,
        reason: `zk_config_${Math.abs(code)}`,
      };
    }
    return {
      kind: 'fatal',
      retryable: false,
      releaseCard: false,
      adminActionable: true,
      reason: `zk_error_${Math.abs(code)}`,
    };
  }

  // Transport-level failure (timeout / network / bad gateway / parse). Retryable.
  return {
    kind: 'transient',
    retryable: true,
    releaseCard: false,
    adminActionable: false,
    reason: 'zk_unreachable',
  };
}
