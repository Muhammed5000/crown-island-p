/**
 * Magic-byte sniffing tests for image uploads.
 *
 *   npx tsx --test src/lib/file-signature-core.test.ts
 *
 * Guards the upload routes' defence against renamed scripts/HTML posing as
 * images (the client-declared Content-Type is attacker-controlled).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { imageSignatureMatches } from './file-signature-core';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = Buffer.from('GIF89a\x01\x00', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);
const AVIF = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1c]),
  Buffer.from('ftypavif', 'latin1'),
  Buffer.alloc(16),
]);

describe('imageSignatureMatches — real signatures pass', () => {
  it('accepts each format under its own MIME', () => {
    assert.equal(imageSignatureMatches(JPEG, 'image/jpeg'), true);
    assert.equal(imageSignatureMatches(JPEG, 'image/jpg'), true);
    assert.equal(imageSignatureMatches(PNG, 'image/png'), true);
    assert.equal(imageSignatureMatches(GIF, 'image/gif'), true);
    assert.equal(imageSignatureMatches(WEBP, 'image/webp'), true);
    assert.equal(imageSignatureMatches(AVIF, 'image/avif'), true);
  });

  it('accepts SVG shapes: bare root, doctype, xml prolog, leading comment', () => {
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ""><svg></svg>',
      '<?xml version="1.0"?><svg></svg>',
      '<!-- exported --><svg></svg>',
    ]) {
      assert.equal(imageSignatureMatches(Buffer.from(svg, 'utf8'), 'image/svg+xml'), true, svg);
    }
  });
});

describe('imageSignatureMatches — spoofed content fails', () => {
  it('rejects HTML/script bytes declared as an image', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']) {
      assert.equal(imageSignatureMatches(html, mime), false, mime);
    }
  });

  it('rejects a real image declared as a DIFFERENT image type', () => {
    assert.equal(imageSignatureMatches(PNG, 'image/jpeg'), false);
    assert.equal(imageSignatureMatches(JPEG, 'image/png'), false);
    assert.equal(imageSignatureMatches(GIF, 'image/webp'), false);
  });

  it('rejects a PDF declared as an image', () => {
    const pdf = Buffer.from('%PDF-1.7 …', 'latin1');
    assert.equal(imageSignatureMatches(pdf, 'image/png'), false);
    assert.equal(imageSignatureMatches(pdf, 'image/jpeg'), false);
  });

  it('rejects truncated buffers', () => {
    assert.equal(imageSignatureMatches(Buffer.from([0xff, 0xd8]), 'image/jpeg'), false);
    assert.equal(imageSignatureMatches(PNG.subarray(0, 4), 'image/png'), false);
    assert.equal(imageSignatureMatches(Buffer.alloc(0), 'image/webp'), false);
  });

  it('rejects a renamed mp4 posing as image/avif (ftyp without avif brand)', () => {
    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypisom', 'latin1'),
      Buffer.alloc(16),
    ]);
    assert.equal(imageSignatureMatches(mp4, 'image/avif'), false);
  });

  it('returns false for non-image MIME types (caller contract)', () => {
    assert.equal(imageSignatureMatches(JPEG, 'application/pdf'), false);
    assert.equal(imageSignatureMatches(JPEG, 'text/html'), false);
    assert.equal(imageSignatureMatches(JPEG, 'application/octet-stream'), false);
  });

  it('rejects HTML posing as SVG only when no svg tag opens the head', () => {
    assert.equal(
      imageSignatureMatches(Buffer.from('<html><body>hi</body></html>', 'utf8'), 'image/svg+xml'),
      false,
    );
  });
});
