import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  syncSecretOk,
  syncScopeSecret,
  SYNC_SECRET_HEADER,
  appMode,
  isLocal,
  isOnline,
  SYNC_PULL_SAFETY_LAG_MS,
  SYNC_SETS_INTERVAL_MS,
  SYNC_QUEUE_RETENTION_DAYS,
} from './config';

function makeReq(headerVal?: string): Request {
  return new Request('http://local/api/sync/apply', {
    method: 'POST',
    headers: headerVal === undefined ? {} : { [SYNC_SECRET_HEADER]: headerVal },
  });
}

/** Clear every sync secret so each test starts from a known-empty baseline. */
function clearSyncSecrets(): void {
  delete process.env.SYNC_SECRET;
  delete process.env.SYNC_READ_SECRET;
  delete process.env.SYNC_WRITE_SECRET;
}

function withNodeEnv(value: string | undefined, run: () => void): void {
  const writableEnv = process.env as Record<string, string | undefined>;
  const previous = writableEnv.NODE_ENV;
  if (value === undefined) delete writableEnv.NODE_ENV;
  else writableEnv.NODE_ENV = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete writableEnv.NODE_ENV;
    else writableEnv.NODE_ENV = previous;
  }
}

test('syncSecretOk refuses every request while no secret is configured', () => {
  clearSyncSecrets();
  assert.equal(syncSecretOk(makeReq('anything'), 'read'), false);
  assert.equal(syncSecretOk(makeReq('anything'), 'write'), false);
});

test('syncSecretOk rejects a missing, empty, or wrong header', () => {
  clearSyncSecrets();
  process.env.SYNC_SECRET = 's3cr3t-value';
  assert.equal(syncSecretOk(makeReq(undefined), 'write'), false);
  assert.equal(syncSecretOk(makeReq(''), 'write'), false);
  assert.equal(syncSecretOk(makeReq('nope'), 'write'), false);
});

test('shared SYNC_SECRET remains a non-production rollout fallback', () => {
  clearSyncSecrets();
  process.env.SYNC_SECRET = 's3cr3t-value';
  withNodeEnv('development', () => {
    assert.equal(syncSecretOk(makeReq('s3cr3t-value'), 'read'), true);
    assert.equal(syncSecretOk(makeReq('s3cr3t-value'), 'write'), true);
  });
});

test('production rejects the shared SYNC_SECRET fallback', () => {
  clearSyncSecrets();
  process.env.SYNC_SECRET = 'legacy-shared';
  withNodeEnv('production', () => {
    assert.equal(syncScopeSecret('read'), null);
    assert.equal(syncScopeSecret('write'), null);
    assert.equal(syncSecretOk(makeReq('legacy-shared'), 'read'), false);
    assert.equal(syncSecretOk(makeReq('legacy-shared'), 'write'), false);
  });
});

test('SYNC-001: scoped secrets isolate read from write (leaked read cannot write)', () => {
  clearSyncSecrets();
  process.env.SYNC_READ_SECRET = 'read-only-cred';
  process.env.SYNC_WRITE_SECRET = 'write-only-cred';

  // Each secret works ONLY on its own scope.
  assert.equal(syncSecretOk(makeReq('read-only-cred'), 'read'), true);
  assert.equal(syncSecretOk(makeReq('write-only-cred'), 'write'), true);
  // A leaked READ credential (the hash-bearing pull channel) cannot call writes.
  assert.equal(syncSecretOk(makeReq('read-only-cred'), 'write'), false);
  assert.equal(syncSecretOk(makeReq('write-only-cred'), 'read'), false);

  assert.equal(syncScopeSecret('read'), 'read-only-cred');
  assert.equal(syncScopeSecret('write'), 'write-only-cred');
  clearSyncSecrets();
});

test('appMode reads only the two valid modes; anything else is null (sync inert)', () => {
  process.env.APP_MODE = 'local';
  assert.equal(appMode(), 'local');
  assert.equal(isLocal(), true);
  assert.equal(isOnline(), false);

  process.env.APP_MODE = 'online';
  assert.equal(appMode(), 'online');
  assert.equal(isOnline(), true);

  process.env.APP_MODE = 'bogus';
  assert.equal(appMode(), null);

  delete process.env.APP_MODE;
  assert.equal(appMode(), null);
  assert.equal(isLocal(), false);
});

test('cadence/lag knobs default sanely (env unset in the unit lane)', () => {
  // The safety lag must be generous: it is the budget for slow-tx stamp->commit
  // gaps + app<->DB clock skew; a row beyond it is skipped FOREVER.
  assert.equal(SYNC_PULL_SAFETY_LAG_MS, 60_000);
  assert.equal(SYNC_SETS_INTERVAL_MS, 5 * 60_000);
  assert.equal(SYNC_QUEUE_RETENTION_DAYS, 14);
});
