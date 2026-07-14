import { open, stat } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { syncSecretOk, isOnline } from '@/server/sync/config';
import { resolveSensitiveUpload } from '@/lib/upload-paths';
import { imageSignatureMatches } from '@/lib/file-signature-core';
import { mimeForExt, SIGNATURE_HEAD_BYTES, type OnlineFileStat } from '@/server/sync/file-integrity-core';
import { readJsonBounded, KIB } from '@/server/sync/http-core';

/**
 * POST /api/sync/file-stat  (ONLINE)
 *
 * Batched integrity probe the LOCAL mirror uses to decide whether a venue-authored
 * (secure) file it holds needs re-pushing — i.e. whether online's copy is missing,
 * a different size, or fails the image signature. Body `{ urls: string[] }` (≤200);
 * per url returns `{ url, exists, size, signatureOk }` where `signatureOk` runs
 * `imageSignatureMatches` on the FIRST 1024 bytes only (open/read-head/close — never
 * the whole file), or null for a non-image ext.
 *
 * v1 detection scope: this catches the observed failure modes — a file MISSING,
 * TRUNCATED (size drift), or MANGLED FROM BYTE 0 (broken signature). It does NOT
 * detect mid-file bitrot with an intact head and unchanged length; a full-hash
 * compare is deliberately omitted to keep the probe cheap.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_URLS = 200;

type StatResult = OnlineFileStat & { url: string };

const MISSING = (url: string): StatResult => ({ url, exists: false, size: null, signatureOk: null });

async function statOne(url: string): Promise<StatResult> {
  const resolved = resolveSensitiveUpload(url);
  if (!resolved) return MISSING(url); // external / malformed — nothing to stat
  let info;
  try {
    info = await stat(resolved.diskPath);
  } catch {
    return MISSING(url);
  }
  if (!info.isFile()) return MISSING(url);

  const mime = mimeForExt(resolved.ext);
  let signatureOk: boolean | null = null;
  if (mime) {
    const head = Buffer.alloc(Math.min(SIGNATURE_HEAD_BYTES, info.size));
    if (head.length > 0) {
      const fh = await open(resolved.diskPath, 'r');
      try {
        await fh.read(head, 0, head.length, 0);
      } finally {
        await fh.close();
      }
    }
    signatureOk = imageSignatureMatches(head, mime);
  }
  return { url, exists: true, size: info.size, signatureOk };
}

export async function POST(request: Request) {
  if (!syncSecretOk(request, 'read')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!isOnline()) {
    return NextResponse.json({ ok: false, error: 'not_online_node' }, { status: 409 });
  }

  // ≤200 urls of ~60 chars each — 256 KiB is generous; the cap runs BEFORE the
  // array is materialised, so a giant body can't be parsed just to be rejected.
  const parsed = await readJsonBounded(request, 256 * KIB);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason === 'too_large' ? 'too_large' : 'bad_request' },
      { status: parsed.reason === 'too_large' ? 413 : 400 },
    );
  }
  const urls = (parsed.body as { urls?: unknown })?.urls;
  if (!Array.isArray(urls)) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  if (urls.length > MAX_URLS) {
    return NextResponse.json({ ok: false, error: 'too_many' }, { status: 400 });
  }

  const results: StatResult[] = [];
  for (const u of urls) {
    if (typeof u !== 'string') {
      results.push(MISSING(String(u)));
      continue;
    }
    try {
      results.push(await statOne(u));
    } catch {
      results.push(MISSING(u)); // a per-file read error → treat as missing (safe)
    }
  }
  return NextResponse.json({ ok: true, results }, { headers: { 'Cache-Control': 'no-store' } });
}
