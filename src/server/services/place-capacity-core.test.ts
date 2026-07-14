/**
 * Tests for the place-capacity ceiling + freedom-check helpers.
 *
 *   npx tsx --test src/server/services/place-capacity-core.test.ts
 *
 * A regression here re-opens overbooking: the whole point is that a place-
 * required service can NEVER sell more units than it has physical places.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { effectiveDailyCap, firstUnavailablePlace } from './place-capacity-core';

describe('effectiveDailyCap — place-required services', () => {
  it('clamps an explicit cap DOWN to the place count (never oversell)', () => {
    // Admin set 20 people but there are only 4 cabanas → hard ceiling is 4.
    assert.equal(effectiveDailyCap(20, true, 4), 4);
  });

  it('never raises a smaller explicit cap up to the place count', () => {
    // Admin deliberately capped at 2 even though 4 places exist → keep 2.
    assert.equal(effectiveDailyCap(2, true, 4), 2);
  });

  it('a null cap becomes the place count (blank-cap overbooking hole closed)', () => {
    assert.equal(effectiveDailyCap(null, true, 4), 4);
  });

  it('equal cap and place count is unchanged', () => {
    assert.equal(effectiveDailyCap(4, true, 4), 4);
  });

  it('no active places configured → fall back to the explicit cap (incl. null)', () => {
    assert.equal(effectiveDailyCap(10, true, 0), 10);
    assert.equal(effectiveDailyCap(null, true, 0), null);
  });
});

describe('effectiveDailyCap — non-place services', () => {
  it('keeps the configured cap untouched (null stays unlimited)', () => {
    assert.equal(effectiveDailyCap(50, false, 0), 50);
    assert.equal(effectiveDailyCap(null, false, 999), null);
    // Place count is irrelevant for a non-place service even if one is passed.
    assert.equal(effectiveDailyCap(50, false, 4), 50);
  });
});

describe('firstUnavailablePlace', () => {
  const free = new Set(['p1', 'p2', 'p3']);

  it('returns null when every requested place is free', () => {
    assert.equal(firstUnavailablePlace(['p1', 'p3'], free), null);
    assert.equal(firstUnavailablePlace([], free), null);
  });

  it('returns the first taken place id', () => {
    assert.equal(firstUnavailablePlace(['p1', 'pX', 'p2'], free), 'pX');
    assert.equal(firstUnavailablePlace(['pZ'], free), 'pZ');
  });

  it('an empty free set means everything requested is unavailable', () => {
    assert.equal(firstUnavailablePlace(['p1'], new Set()), 'p1');
  });
});
