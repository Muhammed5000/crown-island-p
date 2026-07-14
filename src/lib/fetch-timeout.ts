/**
 * `fetch()` with a hard timeout deadline.
 *
 * The AbortController + setTimeout dance was re-implemented ~29× across the sync,
 * payment and ZK clients (a hung peer would otherwise stall the caller forever —
 * see SYNC-002). This centralises it: one deadline, composed with any caller
 * signal, and a distinguishable `FetchTimeoutError` so callers can tell a timeout
 * apart from a real network failure or a caller-initiated abort.
 *
 * Pure and dependency-free; `fetchImpl` is injectable purely so the timeout path
 * is deterministically unit-testable without a network.
 */

export interface FetchWithTimeoutInit extends RequestInit {
  /** Abort the request after this many milliseconds. Default 10_000. */
  timeoutMs?: number;
}

/** Thrown when the request exceeds `timeoutMs` (not when the caller aborts). */
export class FetchTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly url: string,
  ) {
    super(`fetch timed out after ${timeoutMs}ms: ${url}`);
    this.name = 'FetchTimeoutError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: FetchWithTimeoutInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  // Compose the deadline with any caller signal so either can abort the request.
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetchImpl(input, { ...rest, signal });
  } catch (err) {
    // Distinguish OUR deadline from a caller abort: only the timeout raises
    // FetchTimeoutError; a caller-initiated abort re-throws the original reason.
    if (timeoutSignal.aborted && !(callerSignal && callerSignal.aborted)) {
      const url = input instanceof Request ? input.url : String(input);
      throw new FetchTimeoutError(timeoutMs, url);
    }
    throw err;
  }
}
