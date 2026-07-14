/**
 * Unit tests for classifyScan (gate-scan-core.ts).
 *
 * Pins the scan-shape precedence the gate relies on: a valid signed token always
 * wins (visit vs booking), then the raw "V-…" visit-code pattern, then a bare
 * booking reference. A reorder here would silently break bracelet/QR admission.
 *
 * Run:  npx tsx --test src/server/services/gate-scan-core.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyScan } from './gate-scan-core';

// A well-formed visit code: "V-" + 12 chars from the unambiguous alphabet.
const VISIT_CODE = 'V-3K9TQ2M8WXAB';

test('a valid visit token classifies as visitToken (wins over any pattern match)', () => {
  // Even a value that also looks like a visit code is a token first when signed.
  assert.equal(classifyScan(VISIT_CODE, { isVisit: true }), 'visitToken');
  assert.equal(classifyScan('anything', { isVisit: true }), 'visitToken');
});

test('a valid booking token classifies as bookingToken', () => {
  assert.equal(classifyScan('CI-20260101-ABCD12', { isVisit: false }), 'bookingToken');
});

test('an unsigned value matching the visit-code pattern classifies as visitCode', () => {
  assert.equal(classifyScan(VISIT_CODE, null), 'visitCode');
  assert.equal(classifyScan(VISIT_CODE.toLowerCase(), null), 'visitCode'); // matcher upper-cases
});

test('an unsigned value that is not a well-formed visit code falls back to reference', () => {
  assert.equal(classifyScan('CI-20260525-LM8T3J', null), 'reference'); // booking reference shape
  assert.equal(classifyScan('V-20260525-LM8T3J', null), 'reference'); // "V-" but wrong length + illegal chars
  assert.equal(classifyScan('random-manual-entry', null), 'reference');
});

test('empty / whitespace-only input classifies as unknown', () => {
  assert.equal(classifyScan('', null), 'unknown');
  assert.equal(classifyScan('   ', null), 'unknown');
  // Even an (implausible) empty value with a token is unknown — nothing to resolve.
  assert.equal(classifyScan('', { isVisit: true }), 'unknown');
});

test('surrounding whitespace does not change the classification', () => {
  assert.equal(classifyScan(`  ${VISIT_CODE}  `, null), 'visitCode');
});
