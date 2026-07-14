import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSyncPayload, encryptSyncPayload } from './envelope';

const SECRET = 'read-payload-encryption-secret-32-bytes-minimum';

test('sync envelope round-trips sensitive data without plaintext leakage', () => {
  const input = { users: [{ passwordHash: 'bcrypt-secret', email: 'guest@example.test' }] };
  const envelope = encryptSyncPayload(input, SECRET);
  assert.deepEqual(decryptSyncPayload(envelope, SECRET), input);
  assert.equal(envelope.ciphertext.includes('bcrypt-secret'), false);
  assert.equal(JSON.stringify(envelope).includes('guest@example.test'), false);
});

test('sync envelope rejects the wrong secret and tampering', () => {
  const envelope = encryptSyncPayload({ ok: true }, SECRET);
  assert.throws(() => decryptSyncPayload(envelope, 'different-secret-that-is-also-at-least-32-bytes'));
  const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` };
  assert.throws(() => decryptSyncPayload(tampered, SECRET));
});

test('sync envelope rejects weak data secrets', () => {
  assert.throws(() => encryptSyncPayload({ ok: true }, 'too-short'));
});
