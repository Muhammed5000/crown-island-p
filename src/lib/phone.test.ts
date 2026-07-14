import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toE164 } from './phone';

describe('toE164', () => {
  it('canonicalises equivalent Egyptian formats to one E.164 string', () => {
    const canonical = '+201001234567';
    assert.equal(toE164('+20 100 123 4567'), canonical);
    assert.equal(toE164('01001234567'), canonical); // local, default region EG
    assert.equal(toE164('00201001234567'), canonical); // 00 international prefix
    assert.equal(toE164('+201001234567'), canonical); // already E.164
  });

  it('returns empty string for blank/nullish input', () => {
    assert.equal(toE164(''), '');
    assert.equal(toE164('   '), '');
    assert.equal(toE164(null), '');
    assert.equal(toE164(undefined), '');
  });

  it('honours an explicit region for a local number', () => {
    // A UK local number parsed as GB → +44…
    assert.equal(toE164('07400123456', 'GB'), '+447400123456');
  });

  it('falls back to digits + leading plus when unparseable', () => {
    // Not a valid number in any region → deterministic, comparable fallback.
    assert.equal(toE164('+1 (23) 45'), '+12345');
    assert.equal(toE164('garbage-123'), '123');
  });
});
