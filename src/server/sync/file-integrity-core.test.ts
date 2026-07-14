/**
 * Unit tests for the pure file-integrity helpers.
 *
 *   npx tsx --test src/server/sync/file-integrity-core.test.ts
 *
 * Locks the transfer-verification contract (size / sha256 / signature) and the
 * self-healing decision table (authority-by-prefix) that the receiver, the
 * download path, and the repair sweep all depend on.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  sha256Hex,
  mimeForExt,
  verifyFileIntegrity,
  planFileAction,
  planOverwrite,
  SYNC_UPLOAD_EXTS,
  type PlanFileInput,
} from './file-integrity-core';

// FF D8 FF … is a valid JPEG head; used as "good image bytes".
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const NOT_IMAGE = Buffer.from('<html>nope</html>', 'utf8');

describe('sha256Hex — known vectors', () => {
  it('hashes the empty buffer and "abc"', () => {
    assert.equal(
      sha256Hex(Buffer.alloc(0)),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.equal(
      sha256Hex(Buffer.from('abc', 'utf8')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('mimeForExt', () => {
  it('maps image exts (case-insensitive) and null for non-image', () => {
    assert.equal(mimeForExt('jpg'), 'image/jpeg');
    assert.equal(mimeForExt('JPEG'), 'image/jpeg');
    assert.equal(mimeForExt('png'), 'image/png');
    assert.equal(mimeForExt('svg'), 'image/svg+xml');
    assert.equal(mimeForExt('pdf'), null);
    assert.equal(mimeForExt('mp4'), null);
  });
});

describe('verifyFileIntegrity', () => {
  it('passes when expectations are absent (only non-empty enforced)', () => {
    assert.deepEqual(verifyFileIntegrity(JPEG, {}), { ok: true });
  });
  it('empty buffer → empty', () => {
    assert.deepEqual(verifyFileIntegrity(Buffer.alloc(0), {}), { ok: false, reason: 'empty' });
  });
  it('size mismatch → size_mismatch', () => {
    assert.deepEqual(verifyFileIntegrity(JPEG, { expectedSize: 999 }), {
      ok: false,
      reason: 'size_mismatch',
    });
    assert.deepEqual(verifyFileIntegrity(JPEG, { expectedSize: JPEG.length }), { ok: true });
  });
  it('sha256 mismatch → sha256_mismatch (case-insensitive match)', () => {
    assert.deepEqual(verifyFileIntegrity(JPEG, { expectedSha256: 'deadbeef' }), {
      ok: false,
      reason: 'sha256_mismatch',
    });
    assert.deepEqual(
      verifyFileIntegrity(JPEG, { expectedSha256: sha256Hex(JPEG).toUpperCase() }),
      { ok: true },
    );
  });
  it('image mime with wrong bytes → signature_mismatch; non-image mime skips it', () => {
    assert.deepEqual(verifyFileIntegrity(NOT_IMAGE, { mime: 'image/jpeg' }), {
      ok: false,
      reason: 'signature_mismatch',
    });
    // A non-image mime never triggers the signature branch.
    assert.deepEqual(verifyFileIntegrity(NOT_IMAGE, { mime: 'application/pdf' }), { ok: true });
    assert.deepEqual(verifyFileIntegrity(JPEG, { mime: 'image/jpeg' }), { ok: true });
  });
  it('checks in order: size before sha before signature', () => {
    // Wrong size AND wrong sha AND wrong signature → size wins (cheapest first).
    assert.deepEqual(
      verifyFileIntegrity(NOT_IMAGE, {
        expectedSize: 1,
        expectedSha256: 'deadbeef',
        mime: 'image/png',
      }),
      { ok: false, reason: 'size_mismatch' },
    );
  });
});

describe('planFileAction — authority-by-prefix decision table', () => {
  const base: PlanFileInput = {
    secure: true,
    localExists: true,
    localSize: 100,
    localSignatureOk: true,
    rowSizeBytes: 100,
    online: { exists: true, size: 100, signatureOk: true },
  };
  const plan = (o: Partial<PlanFileInput>) => planFileAction({ ...base, ...o });

  it('missing locally → download (both prefixes)', () => {
    assert.equal(plan({ secure: true, localExists: false }), 'download');
    assert.equal(plan({ secure: false, localExists: false }), 'download');
  });

  it('secure + locally corrupt → download (online may be intact)', () => {
    assert.equal(plan({ secure: true, localSignatureOk: false }), 'download');
  });

  it('secure + valid + online unavailable → none (never guess)', () => {
    assert.equal(plan({ secure: true, online: null }), 'none');
  });

  it('secure + valid + online missing/diverged/corrupt → repush', () => {
    assert.equal(plan({ online: { exists: false, size: null, signatureOk: null } }), 'repush');
    assert.equal(plan({ online: { exists: true, size: 99, signatureOk: true } }), 'repush');
    assert.equal(plan({ online: { exists: true, size: 100, signatureOk: false } }), 'repush');
  });

  it('secure + valid + online matches → none', () => {
    assert.equal(plan({ online: { exists: true, size: 100, signatureOk: true } }), 'none');
  });

  it('public + size matches row (or no row size) → none; never repushes', () => {
    assert.equal(plan({ secure: false, rowSizeBytes: 100, localSize: 100 }), 'none');
    assert.equal(plan({ secure: false, rowSizeBytes: null }), 'none');
    // A public file online reports corrupt is irrelevant — local never repushes it.
    assert.equal(
      plan({ secure: false, online: { exists: true, size: 5, signatureOk: false } }),
      'none',
    );
  });

  it('public + live size drifted from the row → download', () => {
    assert.equal(plan({ secure: false, rowSizeBytes: 100, localSize: 87 }), 'download');
  });
});

describe('planOverwrite — upload-file tamper guard', () => {
  const JPEG_A = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const JPEG_B = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x22, 0x45, 0x78]);

  it('nothing stored → write (first delivery)', () => {
    assert.equal(
      planOverwrite({ existing: null, incoming: JPEG_A, manifest: null, mime: 'image/jpeg' }),
      'write',
    );
  });

  it('identical bytes → skip_identical (idempotent re-push, no disk touch)', () => {
    assert.equal(
      planOverwrite({
        existing: JPEG_A,
        incoming: Buffer.from(JPEG_A),
        manifest: { sha256: sha256Hex(JPEG_A), sizeBytes: JPEG_A.length },
        mime: 'image/jpeg',
      }),
      'skip_identical',
    );
  });

  it('different bytes over a manifest-verified healthy file → refuse_healthy (tampering)', () => {
    assert.equal(
      planOverwrite({
        existing: JPEG_A,
        incoming: JPEG_B,
        manifest: { sha256: sha256Hex(JPEG_A), sizeBytes: JPEG_A.length },
        mime: 'image/jpeg',
      }),
      'refuse_healthy',
    );
  });

  it('different bytes over a signature-valid file with NO manifest hash → still refused', () => {
    // A legit re-push only happens when the probe saw the stored copy broken; a
    // legacy row without a hash but with an intact image head is healthy.
    assert.equal(
      planOverwrite({ existing: JPEG_A, incoming: JPEG_B, manifest: null, mime: 'image/jpeg' }),
      'refuse_healthy',
    );
  });

  it('stored copy fails the manifest sha → write (the repair path)', () => {
    assert.equal(
      planOverwrite({
        existing: JPEG_A,
        incoming: JPEG_B,
        manifest: { sha256: sha256Hex(JPEG_B), sizeBytes: JPEG_B.length },
        mime: 'image/jpeg',
      }),
      'write',
    );
  });

  it('stored copy with a broken image signature → write (repair)', () => {
    const garbage = Buffer.from('not an image at all', 'utf8');
    assert.equal(
      planOverwrite({ existing: garbage, incoming: JPEG_A, manifest: null, mime: 'image/jpeg' }),
      'write',
    );
  });

  it('stored EMPTY file → write (verify rejects empty, so repair applies)', () => {
    assert.equal(
      planOverwrite({ existing: Buffer.alloc(0), incoming: JPEG_A, manifest: null, mime: 'image/jpeg' }),
      'write',
    );
  });
});

describe('SYNC_UPLOAD_EXTS — the push-lane extension allow-list', () => {
  it('accepts exactly the photo formats the venue upload routes produce', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']) {
      assert.equal(SYNC_UPLOAD_EXTS.has(ext), true, ext);
    }
  });
  it('excludes svg (active-content, legacy-only) and every non-image ext', () => {
    assert.equal(SYNC_UPLOAD_EXTS.has('svg'), false);
    assert.equal(SYNC_UPLOAD_EXTS.has('pdf'), false);
    assert.equal(SYNC_UPLOAD_EXTS.has('mp4'), false);
    assert.equal(SYNC_UPLOAD_EXTS.has('html'), false);
  });
});
