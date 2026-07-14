/**
 * Unit tests for fetchWithTimeout (fetch-timeout.ts).
 *
 * Guards the deadline behaviour that the sync/payment/ZK clients now depend on:
 * a timeout must surface as a distinguishable FetchTimeoutError, a caller abort
 * must NOT be mislabelled as a timeout, and a fast success must pass through.
 *
 * Run:  npx tsx --test src/lib/fetch-timeout.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout, FetchTimeoutError } from './fetch-timeout';

/** A fake fetch that never resolves until its signal aborts (then rejects). */
const hangUntilAbort: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = (init as RequestInit | undefined)?.signal;
    if (!signal) return; // hangs forever — only used where a signal is always present
    if (signal.aborted) return reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
  });

test('resolves with the response when fetch returns before the deadline', async () => {
  const ok = new Response('hi', { status: 200 });
  const fast: typeof fetch = async () => ok;
  const res = await fetchWithTimeout('https://example.test/', { timeoutMs: 1000 }, fast);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'hi');
});

test('throws FetchTimeoutError (with the url + timeout) when the deadline elapses', async () => {
  await assert.rejects(
    () => fetchWithTimeout('https://slow.test/x', { timeoutMs: 10 }, hangUntilAbort),
    (err: unknown) => {
      assert.ok(err instanceof FetchTimeoutError, 'expected FetchTimeoutError');
      assert.equal(err.timeoutMs, 10);
      assert.equal(err.url, 'https://slow.test/x');
      return true;
    },
  );
});

test('a caller abort is NOT relabelled as a timeout', async () => {
  const controller = new AbortController();
  const p = fetchWithTimeout(
    'https://slow.test/y',
    { timeoutMs: 5000, signal: controller.signal },
    hangUntilAbort,
  );
  controller.abort(new Error('caller cancelled'));
  await assert.rejects(p, (err: unknown) => {
    assert.ok(!(err instanceof FetchTimeoutError), 'caller abort must not be a FetchTimeoutError');
    return true;
  });
});

test('propagates a non-abort fetch error unchanged', async () => {
  const boom = new TypeError('network down');
  const failing: typeof fetch = async () => {
    throw boom;
  };
  await assert.rejects(
    () => fetchWithTimeout('https://example.test/', { timeoutMs: 1000 }, failing),
    (err: unknown) => err === boom,
  );
});
