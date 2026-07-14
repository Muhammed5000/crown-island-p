import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Atomic file writes for the sync layer, shared by the push receiver
 * (/api/sync/upload-file) and the mirror sweep (file-sync.ts).
 *
 * The invariant: a reader (e.g. the secure-media serving route, or the walk's
 * own `access()`/`stat()`) must NEVER observe a half-written file. We get that
 * by writing to a sibling temp file and `rename`-ing it onto the final path —
 * `rename` is atomic on the same filesystem.
 */

/**
 * Replace `dest` with `tmp` atomically. On POSIX (prod is Linux) a single
 * `rename` is an atomic swap even when `dest` already exists. On Windows (dev
 * only) `rename` ONTO an existing file — especially one another handle has open,
 * e.g. secure-media streaming it or AV scanning it — can throw EPERM/EEXIST;
 * fall back to unlink-then-rename. That fallback has a brief non-atomic window,
 * but it exists solely on the dev OS; production keeps the atomic guarantee.
 */
export async function replaceFile(tmp: string, dest: string): Promise<void> {
  try {
    await rename(tmp, dest);
  } catch {
    await unlink(dest).catch(() => {});
    await rename(tmp, dest);
  }
}

/**
 * Write `buf` to `diskPath` atomically (parent dirs created). A crash or a
 * truncated write can only ever leave an orphan `.tmp-*` file, never a partial
 * file at the real path that a later existence check would treat as complete.
 */
export async function atomicWrite(diskPath: string, buf: Buffer): Promise<void> {
  await mkdir(path.dirname(diskPath), { recursive: true });
  const tmp = `${diskPath}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, buf);
    await replaceFile(tmp, diskPath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
