import assert from 'node:assert/strict';
import test from 'node:test';
import { isDynamicServerUsageError } from './error-core';

test('recognizes only the Next.js dynamic-render control-flow error', () => {
  assert.equal(isDynamicServerUsageError({ digest: 'DYNAMIC_SERVER_USAGE' }), true);
  assert.equal(isDynamicServerUsageError({ digest: 'NEXT_REDIRECT' }), false);
  assert.equal(isDynamicServerUsageError(new Error('database down')), false);
});
