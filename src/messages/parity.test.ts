import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * I18N-001: the Arabic and English message catalogs must expose the SAME set of
 * key paths. A key present in one but not the other renders as a raw key (or a
 * next-intl error) at runtime, so a divergence must fail CI rather than ship a
 * half-translated screen.
 */

type Json = Record<string, unknown>;

function keyPaths(obj: Json, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...keyPaths(v as Json, path));
    } else {
      out.push(path);
    }
  }
  return out.sort();
}

/** Map of path → length for every ARRAY value (keyPaths treats arrays as leaves). */
function arrayLengths(obj: Json, prefix = '', out: Record<string, number> = {}): Record<string, number> {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out[path] = v.length;
    else if (v && typeof v === 'object') arrayLengths(v as Json, path, out);
  }
  return out;
}

function load(name: string): Json {
  return JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')) as Json;
}

test('en.json and ar.json expose identical key sets', () => {
  const en = new Set(keyPaths(load('en.json')));
  const ar = new Set(keyPaths(load('ar.json')));
  const missingInEn = [...ar].filter((k) => !en.has(k));
  const missingInAr = [...en].filter((k) => !ar.has(k));
  assert.deepEqual(missingInEn, [], `present in ar.json but missing in en.json: ${missingInEn.join(', ')}`);
  assert.deepEqual(missingInAr, [], `present in en.json but missing in ar.json: ${missingInAr.join(', ')}`);
});

test('en.json and ar.json array values have matching lengths', () => {
  // keyPaths treats arrays as leaves, so a divergent array LENGTH (e.g. an 11th
  // privacy.sections entry in only one locale) would otherwise pass — catch it.
  const en = arrayLengths(load('en.json'));
  const ar = arrayLengths(load('ar.json'));
  const mismatches = Object.keys({ ...en, ...ar })
    .filter((k) => en[k] !== ar[k])
    .map((k) => `${k}: en=${en[k] ?? 'missing'} ar=${ar[k] ?? 'missing'}`);
  assert.deepEqual(mismatches, [], `array-length divergence: ${mismatches.join('; ')}`);
});
