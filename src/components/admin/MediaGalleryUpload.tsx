'use client';

import { useId, useRef, useState } from 'react';
import {
  GripVerticalIcon,
  ImageIcon,
  Loader2Icon,
  TrashIcon,
  UploadCloudIcon,
} from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/cn';

/**
 * Drop-in replacement for the old "one URL per line" textarea used to
 * collect about-page gallery images. The submitted value is still a
 * newline-delimited URL list — the server-side `readLines()` parser does
 * not have to change.
 *
 * Behaviour:
 *  - admin picks multiple files at once → each one is compressed (image) and
 *    POSTed to /api/admin/upload in parallel (max 3 in-flight to avoid
 *    saturating the dev server).
 *  - per-file progress + error state is shown in the tile.
 *  - admin can re-order tiles by drag (HTML5 DnD) and remove individuals.
 */

interface Props {
  name: string;
  label?: string;
  /** Existing URLs, one per line, when editing a record. */
  defaultValue?: string;
  /** Inline error from the server-side parser. */
  error?: string | null;
  hint?: string;
  /** Hard cap on the number of images. Matches the Zod limit on the server. */
  max?: number;
}

interface Item {
  /** Stable id used for React keys + drag/drop bookkeeping. */
  id: string;
  url: string;
  status: 'done' | 'compressing' | 'uploading' | 'error';
  progress: number | null;
  error?: string | null;
}

const MAX_CONCURRENT = 3;

export function MediaGalleryUpload({
  name,
  label,
  defaultValue,
  error,
  hint,
  max = 20,
}: Props) {
  const fieldId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Seed from saved URLs (each is its own "done" item).
  const [items, setItems] = useState<Item[]>(() => {
    const seeded = (defaultValue ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return seeded.map((url, i) => ({
      id: `seed-${i}-${url}`,
      url,
      status: 'done' as const,
      progress: null,
    }));
  });

  // For drag-and-drop reordering.
  const dragId = useRef<string | null>(null);

  /** Persist a list mutation, keeping the hidden textarea in sync. */
  function commit(updater: (prev: Item[]) => Item[]) {
    setItems((prev) => updater(prev));
  }

  function updateItem(id: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  /** Pool runner — never run more than MAX_CONCURRENT uploads at once. */
  async function runPool<T>(tasks: Array<() => Promise<T>>): Promise<void> {
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        if (!task) continue;
        try {
          await task();
        } catch {
          // Errors are surfaced per-item via state; pool keeps draining.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MAX_CONCURRENT, tasks.length) }, worker),
    );
  }

  async function uploadOne(item: Item, file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      updateItem(item.id, {
        status: 'error',
        error: 'Not an image — skipped.',
      });
      return;
    }

    let toUpload: File = file;
    try {
      updateItem(item.id, { status: 'compressing' });
      const compressed = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        fileType: file.type,
      });
      toUpload = compressed.size < file.size ? compressed : file;
    } catch {
      toUpload = file;
    }

    if (toUpload.size > 10 * 1024 * 1024) {
      updateItem(item.id, {
        status: 'error',
        error: `Still ${(toUpload.size / (1024 * 1024)).toFixed(1)}MB after compression — limit 10MB.`,
      });
      return;
    }

    updateItem(item.id, { status: 'uploading', progress: 0 });

    try {
      const formData = new FormData();
      formData.append('file', toUpload);

      const result = await new Promise<{ ok: boolean; url?: string; detail?: string }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/admin/upload');
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              updateItem(item.id, {
                progress: Math.round((e.loaded / e.total) * 100),
              });
            }
          });
          xhr.onerror = () => reject(new Error('Network error.'));
          xhr.onload = () => {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error(`Server returned ${xhr.status}.`));
            }
          };
          xhr.send(formData);
        },
      );

      if (!result.ok || !result.url) {
        updateItem(item.id, {
          status: 'error',
          error: result.detail ?? 'Upload failed.',
        });
        return;
      }
      updateItem(item.id, { status: 'done', url: result.url, progress: null });
    } catch (err) {
      updateItem(item.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed.',
      });
    }
  }

  async function onPickMany(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const remainingSlots = Math.max(0, max - items.length);
    const accepted = files.slice(0, remainingSlots);
    const rejectedCount = files.length - accepted.length;

    // Seed placeholder items so previews appear immediately.
    const placeholders: Item[] = accepted.map((f, i) => ({
      id: `up-${Date.now()}-${i}-${f.name}`,
      url: URL.createObjectURL(f),
      status: 'compressing',
      progress: null,
    }));
    commit((prev) => [...prev, ...placeholders]);

    if (rejectedCount > 0) {
      // Surface a one-shot error on the last placeholder (or as a transient
      // toast if we add one later). For now we just console-warn.
      console.warn(
        `${rejectedCount} file(s) skipped — gallery is capped at ${max} images.`,
      );
    }

    const tasks = placeholders.map((item, i) => {
      const file = accepted[i];
      if (!file) return () => Promise.resolve();
      return () => uploadOne(item, file);
    });
    await runPool(tasks);

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ───── Drag & drop reordering ─────
  function onDragStart(id: string) {
    return (e: React.DragEvent) => {
      dragId.current = id;
      e.dataTransfer.effectAllowed = 'move';
    };
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onDrop(targetId: string) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragId.current;
      if (!from || from === targetId) return;
      commit((prev) => {
        const fromIdx = prev.findIndex((it) => it.id === from);
        const toIdx = prev.findIndex((it) => it.id === targetId);
        if (fromIdx < 0 || toIdx < 0) return prev;
        const next = prev.slice();
        const [moved] = next.splice(fromIdx, 1);
        if (moved) next.splice(toIdx, 0, moved);
        return next;
      });
      dragId.current = null;
    };
  }

  // Only completed uploads end up in the submitted value.
  const submittableValue = items
    .filter((it) => it.status === 'done')
    .map((it) => it.url)
    .join('\n');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        {label ? <Label htmlFor={fieldId}>{label}</Label> : <span />}
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {items.filter((i) => i.status === 'done').length} / {max}
        </span>
      </div>

      {/* Tiles */}
      {items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {items.map((it) => (
            <li
              key={it.id}
              draggable={it.status === 'done'}
              onDragStart={onDragStart(it.id)}
              onDragOver={onDragOver}
              onDrop={onDrop(it.id)}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-2xl border bg-input',
                it.status === 'error' ? 'border-danger/60' : 'border-border/60',
                it.status === 'done' && 'cursor-grab active:cursor-grabbing',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={it.url}
                alt=""
                className={cn(
                  'h-full w-full object-cover',
                  it.status !== 'done' && 'opacity-50',
                )}
              />

              {/* Drag handle indicator */}
              {it.status === 'done' ? (
                <span className="absolute start-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-full bg-black/55 text-white/80 opacity-0 backdrop-blur-md transition group-hover:opacity-100">
                  <GripVerticalIcon className="size-4" strokeWidth={2} />
                </span>
              ) : null}

              {/* Status overlay */}
              {it.status !== 'done' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-navy-950/75 text-center">
                  {it.status === 'error' ? (
                    <p className="px-2 text-[11px] font-bold text-danger">
                      {it.error ?? 'Failed'}
                    </p>
                  ) : (
                    <>
                      <Loader2Icon className="size-5 animate-spin text-gold-300" />
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gold-200">
                        {it.status === 'compressing'
                          ? 'Compress'
                          : it.progress != null
                            ? `${it.progress}%`
                            : 'Upload'}
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeItem(it.id)}
                className="absolute end-1.5 top-1.5 inline-flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-md transition hover:bg-danger/80 group-hover:opacity-100"
                aria-label="Remove"
              >
                <TrashIcon className="size-3.5" strokeWidth={2.5} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Picker */}
      <label
        className={cn(
          'flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gold-400/40 bg-gold-400/10 text-[12px] font-bold uppercase tracking-widest text-gold-700 transition hover:bg-gold-400/20',
          items.length >= max && 'pointer-events-none opacity-50',
        )}
      >
        {items.length >= max ? (
          <span className="text-muted-foreground">Gallery is full</span>
        ) : (
          <>
            <UploadCloudIcon className="size-4" strokeWidth={2.5} />
            <span>Add images</span>
            <ImageIcon className="size-4 opacity-60" strokeWidth={2} />
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPickMany}
          className="sr-only"
          disabled={items.length >= max}
        />
      </label>

      {/* Hidden field that ACTUALLY submits — the server parser reads
          newline-separated URLs from this textarea via readLines(). */}
      <textarea
        id={fieldId}
        name={name}
        readOnly
        value={submittableValue}
        className="hidden"
        tabIndex={-1}
      />

      {error ? (
        <p className="text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
