/**
 * Unit tests for string-format helpers.
 *
 * Run: npx tsx --test src/lib/string-format.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanizeLine } from './string-format';

test('humanizeLine strips known namespace prefixes and Title-Cases', () => {
  assert.equal(humanizeLine('services.dayUse'), 'Day Use');
  assert.equal(humanizeLine('booking.maxPeople'), 'Max People');
});

test('humanizeLine splits separators and camelCase', () => {
  assert.equal(humanizeLine('extra_person'), 'Extra person');
  assert.equal(humanizeLine('umbrellaCount'), 'Umbrella Count');
  assert.equal(humanizeLine('plain'), 'Plain');
});
