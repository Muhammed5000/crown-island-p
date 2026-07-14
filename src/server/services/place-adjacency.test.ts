/**
 * Unit tests for the pure place-adjacency recommendation.
 *   npx tsx --test src/server/services/place-adjacency.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickAdjacent, type PlaceLite } from './place-adjacency';

const zoneNorth: PlaceLite[] = [
  { id: 'n1', zone: 'North', position: 1 },
  { id: 'n2', zone: 'North', position: 2 },
  { id: 'n3', zone: 'North', position: 3 },
];
const zoneSouth: PlaceLite[] = [
  { id: 's1', zone: 'South', position: 1 },
  { id: 's2', zone: 'South', position: 2 },
];

test('pickAdjacent: returns all when availability ≤ count', () => {
  assert.deepEqual(pickAdjacent(zoneSouth, 5), ['s1', 's2']);
});

test('pickAdjacent: prefers a consecutive run in one zone', () => {
  // North has a gap at 2 (removed), South is consecutive 1,2 → should pick South.
  const places: PlaceLite[] = [
    { id: 'n1', zone: 'North', position: 1 },
    { id: 'n3', zone: 'North', position: 3 },
    ...zoneSouth,
  ];
  assert.deepEqual(pickAdjacent(places, 2), ['s1', 's2']);
});

test('pickAdjacent: consecutive run within the same zone, earliest first', () => {
  assert.deepEqual(pickAdjacent(zoneNorth.concat(zoneSouth), 2), ['n1', 'n2']);
});

test('pickAdjacent: falls back to densest zone when no consecutive run', () => {
  const places: PlaceLite[] = [
    { id: 'n1', zone: 'North', position: 1 },
    { id: 'n5', zone: 'North', position: 5 },
    { id: 'n9', zone: 'North', position: 9 },
    { id: 's1', zone: 'South', position: 1 },
  ];
  // No consecutive run of 3; densest zone is North with 3 → its first 3.
  assert.deepEqual(pickAdjacent(places, 3), ['n1', 'n5', 'n9']);
});

test('pickAdjacent: count 0 → empty', () => {
  assert.deepEqual(pickAdjacent(zoneNorth, 0), []);
});
