/**
 * Verify an uploaded file's leading bytes match its declared image MIME type.
 *
 * Clients can lie about `Content-Type` / file extension, so every image uploader
 * sniffs the real signature before persisting (mirrors the restaurant PDF
 * `%PDF-` check). This stops a renamed script / HTML / executable from being
 * stored under an image extension. Call ONLY for image MIME types — anything
 * else returns false.
 *
 * SVG has no binary magic number (it is text/XML), so it is matched
 * structurally: the head must open an `<svg` (or XML/doctype that contains one).
 */
export function imageSignatureMatches(buffer: Buffer, mime: string): boolean {
  const b = buffer;
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return (
        b.length >= 8 &&
        b[0] === 0x89 &&
        b[1] === 0x50 &&
        b[2] === 0x4e &&
        b[3] === 0x47 &&
        b[4] === 0x0d &&
        b[5] === 0x0a &&
        b[6] === 0x1a &&
        b[7] === 0x0a
      );
    case 'image/gif':
      // "GIF87a" / "GIF89a"
      return b.length >= 6 && b.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'image/webp':
      // "RIFF" .... "WEBP"
      return (
        b.length >= 12 &&
        b.subarray(0, 4).toString('latin1') === 'RIFF' &&
        b.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'image/avif': {
      // ISO-BMFF container: an "ftyp" box at offset 4 (shared by AVIF/HEIF/MP4).
      // Require an AVIF brand ("avif"/"avis", as major OR compatible brand inside
      // the ftyp box) so a renamed mp4/mov/heic can't pose as image/avif.
      if (b.length < 12 || b.subarray(4, 8).toString('latin1') !== 'ftyp') return false;
      const ftyp = b.subarray(8, 64).toString('latin1');
      return ftyp.includes('avif') || ftyp.includes('avis');
    }
    case 'image/svg+xml': {
      const head = b
        .subarray(0, 1024)
        .toString('utf8')
        .replace(/^﻿/, '')
        .trimStart()
        .toLowerCase();
      return (
        head.startsWith('<svg') ||
        head.startsWith('<!doctype svg') ||
        // Some exporters (e.g. Illustrator) lead with an XML prolog and/or a
        // comment before the <svg> root — accept as long as it opens with markup
        // and an <svg> tag appears in the head.
        ((head.startsWith('<?xml') || head.startsWith('<!--')) && head.includes('<svg'))
      );
    }
    default:
      return false;
  }
}
