import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonBounded, readBytesBounded, KIB } from './http-core';

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://local/api/sync/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

test('readJsonBounded parses an under-cap body', async () => {
  const r = await readJsonBounded(jsonRequest(JSON.stringify({ a: 1 })), 1 * KIB);
  assert.ok(r.ok);
  assert.deepEqual(r.body, { a: 1 });
});

test('readJsonBounded fails fast on a declared content-length over the cap', async () => {
  // The header alone must reject — the body is never buffered.
  const r = await readJsonBounded(
    jsonRequest('{}', { 'content-length': String(10 * KIB) }),
    1 * KIB,
  );
  assert.deepEqual(r, { ok: false, reason: 'too_large' });
});

test('readJsonBounded caps an over-cap body even without a content-length header', async () => {
  // A ReadableStream body carries no automatic content-length — the streaming
  // byte count is the real defence (chunked/lying senders).
  const big = new TextEncoder().encode(`{"pad":"${'x'.repeat(4 * KIB)}"}`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(big);
      controller.close();
    },
  });
  const req = new Request('http://local/api/sync/apply', {
    method: 'POST',
    body: stream,
    // @ts-expect-error duplex is required for stream bodies in undici
    duplex: 'half',
  });
  const r = await readJsonBounded(req, 1 * KIB);
  assert.deepEqual(r, { ok: false, reason: 'too_large' });
});

test('readJsonBounded classifies malformed JSON', async () => {
  const r = await readJsonBounded(jsonRequest('{not json'), 1 * KIB);
  assert.deepEqual(r, { ok: false, reason: 'bad_json' });
});

test('readBytesBounded returns the exact bytes under the cap and rejects over it', async () => {
  const okReq = new Request('http://local/api/sync/upload-file', {
    method: 'POST',
    body: Buffer.from('hello'),
  });
  const ok = await readBytesBounded(okReq, 1 * KIB);
  assert.ok(ok.ok);
  assert.equal(ok.bytes.toString('utf8'), 'hello');

  const bigReq = new Request('http://local/api/sync/upload-file', {
    method: 'POST',
    body: Buffer.alloc(2 * KIB, 1),
  });
  const over = await readBytesBounded(bigReq, 1 * KIB);
  assert.deepEqual(over, { ok: false, reason: 'too_large' });
});

test('readBytesBounded tolerates an empty body', async () => {
  const r = await readBytesBounded(new Request('http://local/x', { method: 'POST' }), 1 * KIB);
  assert.ok(r.ok);
  assert.equal(r.bytes.length, 0);
});
