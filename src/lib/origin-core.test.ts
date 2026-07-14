/**
 * Origin-resolution trust-model tests.
 *
 *   npx tsx --test src/lib/origin-core.test.ts
 *
 * The returned origin becomes the HOST of password-reset / verify / payment
 * links — a regression that re-trusts a client-influenced header in production
 * is a link-hijack. These tests pin every branch of the trust model.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveOrigin, type ResolveOriginInput } from './origin-core';

function input(over: Partial<ResolveOriginInput> = {}): ResolveOriginInput {
  return {
    nodeEnv: 'production',
    appUrl: undefined,
    trustedHosts: undefined,
    xfHost: null,
    host: null,
    xfProto: null,
    ...over,
  };
}

describe('resolveOrigin — explicit override', () => {
  it('NEXT_PUBLIC_APP_URL always wins, trailing slash stripped', () => {
    const r = resolveOrigin(
      input({ appUrl: 'https://crownisland.example/', xfHost: 'evil.example', host: 'other' }),
    );
    assert.deepEqual(r, { origin: 'https://crownisland.example' });
  });

  it('blank/whitespace override is ignored', () => {
    const r = resolveOrigin(input({ appUrl: '   ', host: 'crownisland.example' }));
    assert.equal(r.origin, 'https://crownisland.example');
  });
});

describe('resolveOrigin — production with TRUSTED_HOSTS allowlist', () => {
  it('allowlisted forwarded host is accepted (case-insensitive)', () => {
    const r = resolveOrigin(
      input({
        trustedHosts: 'crownisland.example, admin.crownisland.example',
        xfHost: 'Crownisland.Example',
        host: 'app:3000',
        xfProto: 'https',
      }),
    );
    assert.deepEqual(r, { origin: 'https://Crownisland.Example' });
  });

  it('non-allowlisted host snaps to the first trusted host with a warning', () => {
    const r = resolveOrigin(
      input({ trustedHosts: 'crownisland.example', xfHost: 'evil.example', host: 'app:3000' }),
    );
    assert.equal(r.origin, 'https://crownisland.example');
    assert.match(r.warning!, /untrusted host rejected/);
  });
});

describe('resolveOrigin — production WITHOUT any trust configuration (fail closed)', () => {
  it('ignores x-forwarded-host and uses the connection host, with a warning', () => {
    const r = resolveOrigin(
      input({ xfHost: 'evil.example', host: 'crownisland.example', xfProto: 'https' }),
    );
    assert.equal(r.origin, 'https://crownisland.example');
    assert.match(r.warning!, /x-forwarded-host "evil.example" ignored/);
  });

  it('no warning when forwarded host matches the connection host', () => {
    const r = resolveOrigin(input({ xfHost: 'crownisland.example', host: 'crownisland.example' }));
    assert.deepEqual(r, { origin: 'https://crownisland.example' });
  });

  it('falls back to localhost when no host at all', () => {
    assert.equal(resolveOrigin(input()).origin, 'http://localhost:3000');
  });
});

describe('resolveOrigin — non-production trusts the proxy (dev tunnels)', () => {
  it('trusts x-forwarded-host in development (ngrok/cloudflare workflow)', () => {
    const r = resolveOrigin(
      input({
        nodeEnv: 'development',
        xfHost: 'abc123.ngrok-free.app',
        host: 'localhost:3000',
        xfProto: 'https',
      }),
    );
    assert.deepEqual(r, { origin: 'https://abc123.ngrok-free.app' });
  });

  it('localhost proto heuristic: local hosts default to http, real domains to https', () => {
    assert.equal(
      resolveOrigin(input({ nodeEnv: 'development', host: 'localhost:3000' })).origin,
      'http://localhost:3000',
    );
    assert.equal(
      resolveOrigin(input({ nodeEnv: 'development', host: '127.0.0.1:3000' })).origin,
      'http://127.0.0.1:3000',
    );
    assert.equal(
      resolveOrigin(input({ nodeEnv: 'development', host: 'preview.example' })).origin,
      'https://preview.example',
    );
  });

  it('x-forwarded-proto wins over the heuristic', () => {
    assert.equal(
      resolveOrigin(
        input({ nodeEnv: 'development', host: 'localhost:3000', xfProto: 'https' }),
      ).origin,
      'https://localhost:3000',
    );
  });
});
