/**
 * Boot-time env validation tests.
 *
 *   npx tsx --test src/server/env-core.test.ts
 *
 * These pin WHAT counts as fatal (production must not boot) vs a warning
 * (degraded but runnable) — a rule quietly moving between the two buckets
 * changes deploy behaviour.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateEnvCore, DEV_DEFAULT_AUTH_SECRET } from './env-core';

/** A fully-healthy production env — the baseline each test perturbs. */
function healthyProd(): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/crown',
    AUTH_SECRET: 'a-real-secret',
    MPGS_GATEWAY_HOST: 'https://credit-agricole.gateway.mastercard.com',
    MPGS_MERCHANT_ID: 'MID',
    MPGS_PASSWORD: 'pw',
    MPGS_WEBHOOK_SECRET: 'whsec',
    TZ: 'Africa/Cairo',
    VAPID_PUBLIC_KEY: 'pub',
    VAPID_PRIVATE_KEY: 'priv',
    CRON_SECRET: 'cron',
    RESEND_API_KEY: 're_key',
    NEXT_PUBLIC_APP_URL: 'https://crownisland.example',
  };
}

describe('validateEnvCore — errors (fatal in production)', () => {
  it('healthy production env has no errors and no warnings', () => {
    const r = validateEnvCore(healthyProd());
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
  });

  it('missing DATABASE_URL is an error', () => {
    const env = healthyProd();
    delete env.DATABASE_URL;
    const r = validateEnvCore(env);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0]!, /DATABASE_URL/);
  });

  it('missing AUTH_SECRET is an error', () => {
    const env = healthyProd();
    delete env.AUTH_SECRET;
    assert.match(validateEnvCore(env).errors[0]!, /AUTH_SECRET/);
  });

  it('the docker-compose placeholder AUTH_SECRET is an error in production only', () => {
    const prod = { ...healthyProd(), AUTH_SECRET: DEV_DEFAULT_AUTH_SECRET };
    assert.match(validateEnvCore(prod).errors[0]!, /placeholder/);

    const dev = { ...prod, NODE_ENV: 'development' };
    assert.deepEqual(validateEnvCore(dev).errors, []);
  });
});

describe('validateEnvCore — warnings (degraded but runnable)', () => {
  it('MPGS entirely absent → single "disabled" warning', () => {
    const env = healthyProd();
    delete env.MPGS_GATEWAY_HOST;
    delete env.MPGS_MERCHANT_ID;
    delete env.MPGS_PASSWORD;
    const r = validateEnvCore(env);
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0]!, /disabled/);
  });

  it('MPGS PARTIALLY configured → stronger warning naming the missing keys', () => {
    const env = healthyProd();
    delete env.MPGS_PASSWORD;
    const r = validateEnvCore(env);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0]!, /PARTIALLY/);
    assert.match(r.warnings[0]!, /MPGS_PASSWORD/);
  });

  it('MPGS fully configured but MPGS_WEBHOOK_SECRET unset → instant-confirm-off warning', () => {
    const env = healthyProd();
    delete env.MPGS_WEBHOOK_SECRET;
    const r = validateEnvCore(env);
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0]!, /MPGS_WEBHOOK_SECRET/);
  });

  it('the webhook-secret warning does NOT fire when MPGS itself is disabled', () => {
    const env = healthyProd();
    delete env.MPGS_GATEWAY_HOST;
    delete env.MPGS_MERCHANT_ID;
    delete env.MPGS_PASSWORD;
    delete env.MPGS_WEBHOOK_SECRET;
    const r = validateEnvCore(env);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0]!, /disabled/);
    assert.ok(!r.warnings.some((w) => /MPGS_WEBHOOK_SECRET/.test(w)));
  });

  it('the webhook-secret warning does NOT double up when MPGS is only PARTIALLY set', () => {
    const env = healthyProd();
    delete env.MPGS_PASSWORD;
    delete env.MPGS_WEBHOOK_SECRET;
    const r = validateEnvCore(env);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0]!, /PARTIALLY/);
  });

  it('TZ unset or not Africa/Cairo warns (civil-day logic)', () => {
    const unset = healthyProd();
    delete unset.TZ;
    assert.match(validateEnvCore(unset).warnings[0]!, /TZ/);

    const wrong = { ...healthyProd(), TZ: 'UTC' };
    assert.match(validateEnvCore(wrong).warnings[0]!, /Africa\/Cairo/);
  });

  it('VAPID keys are all-or-nothing: one-of-two warns as a crash risk', () => {
    const oneOnly = healthyProd();
    delete oneOnly.VAPID_PRIVATE_KEY;
    assert.match(validateEnvCore(oneOnly).warnings[0]!, /VAPID/);

    const neither = healthyProd();
    delete neither.VAPID_PUBLIC_KEY;
    delete neither.VAPID_PRIVATE_KEY;
    const r = validateEnvCore(neither);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0]!, /disabled/);
  });

  it('missing CRON_SECRET warns', () => {
    const env = healthyProd();
    delete env.CRON_SECRET;
    assert.match(validateEnvCore(env).warnings[0]!, /CRON_SECRET/);
  });

  it('production without RESEND_API_KEY warns; development does not', () => {
    const prod = healthyProd();
    delete prod.RESEND_API_KEY;
    assert.match(validateEnvCore(prod).warnings[0]!, /RESEND_API_KEY/);

    const dev = { ...prod, NODE_ENV: 'development' };
    assert.deepEqual(validateEnvCore(dev).warnings, []);
  });

  it('production with neither NEXT_PUBLIC_APP_URL nor TRUSTED_HOSTS warns; either one silences it', () => {
    const bare = healthyProd();
    delete bare.NEXT_PUBLIC_APP_URL;
    assert.match(validateEnvCore(bare).warnings[0]!, /TRUSTED_HOSTS/);

    const withTrusted = { ...bare, TRUSTED_HOSTS: 'crownisland.example' };
    assert.deepEqual(validateEnvCore(withTrusted).warnings, []);
  });
});
