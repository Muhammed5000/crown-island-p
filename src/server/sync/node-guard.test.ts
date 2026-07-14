import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNotLocalNode, OnlineOwnedError } from './node-guard';

// Mirrors config.test.ts: mutate process.env.APP_MODE directly (appMode() reads
// it at call time) and restore after each case.

test('assertNotLocalNode throws a typed online_owned error on the local node', () => {
  const prev = process.env.APP_MODE;
  try {
    process.env.APP_MODE = 'local';
    assert.throws(
      () => assertNotLocalNode('The catalog'),
      (err: unknown) => {
        assert.ok(err instanceof OnlineOwnedError);
        assert.equal(err.code, 'online_owned');
        assert.equal(err.httpStatus, 409);
        assert.match(err.message, /online master/);
        assert.match(err.message, /The catalog/);
        return true;
      },
    );
  } finally {
    if (prev === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = prev;
  }
});

test('assertNotLocalNode is a no-op on online and on a single deployment', () => {
  const prev = process.env.APP_MODE;
  try {
    process.env.APP_MODE = 'online';
    assert.doesNotThrow(() => assertNotLocalNode('Site settings'));
    delete process.env.APP_MODE;
    assert.doesNotThrow(() => assertNotLocalNode('Site settings'));
  } finally {
    if (prev === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = prev;
  }
});
