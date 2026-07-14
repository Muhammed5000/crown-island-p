/**
 * Bounded request-body helpers for the sync HTTP routes. Route Handlers are NOT
 * covered by next.config's `serverActions.bodySizeLimit`, so without an explicit
 * cap `request.json()` / `request.arrayBuffer()` buffer however many bytes the
 * peer sends — an OOM lever on both nodes. Pure (Web Request API only, no
 * Next/Prisma imports) so the caps are unit-testable.
 */

export const KIB = 1024;
export const MIB = 1024 * KIB;

export type BoundedBytesResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: 'too_large' };

/**
 * Read a raw byte body enforcing `maxBytes`:
 *  1. a declared `content-length` over the cap fails FAST (no body read);
 *  2. the stream is read chunk-by-chunk and CANCELLED the moment it crosses the
 *     cap — a chunked / header-less (or lying) sender never gets the whole body
 *     buffered, which is the actual OOM defence.
 */
export async function readBytesBounded(
  request: Request,
  maxBytes: number,
): Promise<BoundedBytesResult> {
  const declared = request.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    return { ok: false, reason: 'too_large' };
  }
  const body = request.body;
  if (!body) return { ok: true, bytes: Buffer.alloc(0) };
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(Buffer.from(value));
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}

export type BoundedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: 'too_large' | 'bad_json' };

/** Read + parse a JSON body under the same streaming byte cap. */
export async function readJsonBounded(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  let raw: BoundedBytesResult;
  try {
    raw = await readBytesBounded(request, maxBytes);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  if (!raw.ok) return raw;
  try {
    return { ok: true, body: JSON.parse(raw.bytes.toString('utf8')) };
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
}
