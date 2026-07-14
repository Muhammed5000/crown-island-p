/**
 * Unit tests for isStoredMediaUrl (upload-paths.ts).
 *
 * These guard the anti-XSS invariant on user-supplied image-URL fields (ops
 * proofs, reception ID/proof images): only OUR stored media paths are accepted,
 * so a `javascript:`/`data:`/external/traversal value can never be stored and
 * later rendered as <a href>/<img src>.
 *
 * Run:  npx tsx --test src/lib/upload-paths.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStoredMediaUrl } from './upload-paths';

test('accepts the exact secure-media + legacy uploads shapes', () => {
  assert.equal(isStoredMediaUrl('/api/secure-media/2026/07/0123456789abcdef01234567.jpg'), true);
  assert.equal(isStoredMediaUrl('/uploads/2026/07/0123456789abcdef01234567.png'), true);
  assert.equal(isStoredMediaUrl('  /api/secure-media/2026/07/0123456789abcdef01234567.webp  '), true);
});

test('rejects dangerous or non-stored URLs', () => {
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://evil.example/x.jpg',
    '//evil.example/x.jpg',
    '/api/secure-media/../../etc/passwd',
    '/api/secure-media/2026/07/notallowed.exe/../x.jpg',
    '/uploads/2026/07/short.jpg', // hash not 24 hex
    '/random/path.jpg',
    '',
    '   ',
  ]) {
    assert.equal(isStoredMediaUrl(bad), false, `should reject: ${bad}`);
  }
});
