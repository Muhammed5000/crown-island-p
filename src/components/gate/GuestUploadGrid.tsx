'use client';

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { CROWN } from './tokens';

/**
 * Reusable guest-ID upload grid — one responsive card per guest (1 / 2 / 4
 * columns), drag-drop + click + mobile camera + gallery, client-side
 * compression, live XHR progress, preview and replace/remove.
 *
 * It owns only the transient per-slot UI state; the *canonical* "which guest has
 * a document" lives with the parent via `onChange`. Two modes via callbacks:
 *   • collect (reception desk, deferred commit) — no `onPersist`; the parent
 *     just holds the uploaded URLs until the final confirm.
 *   • persist (gate / existing booking) — `onPersist` writes the row immediately
 *     and may reject with an error code to surface on the card.
 */

// ── CROWN tokens — single source of truth in ./tokens ──
const { cream, dim, faint, gold, panel, line, ok, bad, serif, sans } = CROWN;

const ACCEPT = 'image/jpeg,image/png,image/webp';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;
const COMPRESS_ABOVE = 1.2 * 1024 * 1024;

export interface GuestUploadCopy {
  guest: string;
  browse: string;
  camera: string;
  replace: string;
  remove: string;
  retry: string;
  uploaded: string;
  uploading: string;
  pending: string;
  failed: string;
  dropHere: string;
  accepted: string;
  /** Label for a child guest card (e.g. "Child"). */
  child: string;
  /** Sub-label clarifying children need no ID (e.g. "No ID image required"). */
  childNoId: string;
  /** Status label for a slot reusing a saved ID from a prior visit. Optional —
   *  falls back to the `uploaded` label for callers that don't set it. */
  reused?: string;
  /** Word for the guest-name field, used in the name input placeholder/aria
   *  (e.g. "name"). Optional — falls back to "name" for callers that don't set it. */
  nameLabel?: string;
  errors: Record<string, string>;
}

export interface GuestDoc {
  seq: number;
  url: string;
  fileName: string;
  /** Reception-entered guest name (so staff can pick who enters at the gate). */
  name?: string;
  /**
   * Returning-guest reuse: the prior booking's GuestIdDocument.id whose photo
   * this slot reuses. Seeded via `initial`, kept while the photo is untouched,
   * and DROPPED the moment the slot gets a fresh upload or is cleared — a new
   * photo is a new document, not a reuse.
   */
  sourceDocumentId?: string;
}

interface Props {
  /** Number of ADULT slots — each renders an ID upload card (slots 1 … count). */
  count: number;
  /**
   * Number of CHILD slots — each renders a display-only child card (icon + name,
   * NO ID upload), occupying slots count+1 … count+childrenCount. Children are
   * never part of `onChange` (no document) and never block the parent's gating.
   */
  childrenCount?: number;
  t: GuestUploadCopy;
  initial?: GuestDoc[];
  /** Immediate persistence (gate mode). Reject with a `.code` for card errors. */
  onPersist?: (doc: GuestDoc) => Promise<void>;
  onRemovePersist?: (seq: number) => Promise<void>;
  /** Reports the full set of uploaded docs whenever it changes (gating + finalize). */
  onChange?: (docs: GuestDoc[]) => void;
  /**
   * Optional: validate the typed ID/passport NUMBER on blur (e.g. an identity
   * blocklist check) once a photo is uploaded. Resolve `{ blocked: true }` to
   * flag the card with the `errors.blocked` copy. Used in collect mode where no
   * persisted row exists yet — the authoritative stop lives server-side.
   */
  onNameCommit?: (seq: number, name: string | null) => Promise<{ blocked?: boolean } | void>;
}

type SlotState = 'empty' | 'uploading' | 'uploaded' | 'error';
interface Slot {
  seq: number;
  state: SlotState;
  url?: string;
  previewUrl?: string;
  fileName?: string;
  name?: string;
  /** Reuse handle carried from `initial`; cleared on any fresh upload/remove. */
  sourceDocumentId?: string;
  progress: number;
  error?: string;
}

class UploadError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function uploadWithProgress(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/reception/upload');
    if (typeof window !== 'undefined' && window.location.hostname.includes('ngrok')) {
      xhr.setRequestHeader('ngrok-skip-browser-warning', 'true');
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let body: { url?: string; code?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body.url);
      else reject(new UploadError(body.code ?? 'upload_failed'));
    };
    xhr.onerror = () => reject(new UploadError('network'));
    xhr.onabort = () => reject(new UploadError('network'));
    xhr.send(fd);
  });
}

async function maybeCompress(file: File): Promise<File> {
  if (file.size <= COMPRESS_ABOVE) return file;
  try {
    const { default: imageCompression } = await import('browser-image-compression');
    const out = await imageCompression(file, {
      maxSizeMB: 1.5,
      maxWidthOrHeight: 2200,
      useWebWorker: true,
      fileType: file.type,
    });
    return out.size < file.size ? new File([out], file.name, { type: out.type || file.type }) : file;
  } catch {
    return file;
  }
}

export function GuestUploadGrid({ count, childrenCount = 0, t, initial, onPersist, onRemovePersist, onChange, onNameCommit }: Props) {
  const [slots, setSlots] = useState<Slot[]>(() => {
    const bySeq = new Map((initial ?? []).map((d) => [d.seq, d]));
    return Array.from({ length: count }, (_, i) => {
      const seq = i + 1;
      const doc = bySeq.get(seq);
      return doc
        ? {
            seq,
            state: 'uploaded' as const,
            url: doc.url,
            fileName: doc.fileName,
            name: doc.name,
            sourceDocumentId: doc.sourceDocumentId,
            progress: 100,
          }
        : { seq, state: 'empty' as const, progress: 0 };
    });
  });

  const errMsg = useCallback((code: string) => t.errors[code] ?? t.errors.unknown ?? 'Error', [t]);

  // Latest slots, readable inside the async blur callback without a stale closure.
  const slotsRef = useRef<Slot[]>(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  // Report the uploaded set up to the parent AFTER commit (never inside the
  // setSlots updater — that runs during render and would update the parent
  // mid-render). The setter passed by the parent is stable, so this can't loop.
  useEffect(() => {
    onChange?.(
      slots
        .filter((s) => s.state === 'uploaded' && s.url)
        .map((s) => ({
          seq: s.seq,
          url: s.url!,
          fileName: s.fileName ?? `guest-${s.seq}`,
          name: s.name?.trim() || undefined,
          sourceDocumentId: s.sourceDocumentId,
        })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  const patch = useCallback((seq: number, p: Partial<Slot>) => {
    setSlots((prev) => prev.map((s) => (s.seq === seq ? { ...s, ...p } : s)));
  }, []);

  const handleFile = useCallback(
    async (seq: number, file: File) => {
      if (file.size === 0) return patch(seq, { state: 'error', error: errMsg('empty_file') });
      if (!ALLOWED_TYPES.has(file.type)) return patch(seq, { state: 'error', error: errMsg('unsupported_type') });
      if (file.size > MAX_BYTES) return patch(seq, { state: 'error', error: errMsg('too_large') });

      const previewUrl = URL.createObjectURL(file);
      // A fresh upload replaces any reused prior-visit photo — drop the handle.
      patch(seq, { state: 'uploading', progress: 0, error: undefined, previewUrl, fileName: file.name, sourceDocumentId: undefined });
      try {
        const compressed = await maybeCompress(file);
        const url = await uploadWithProgress(compressed, (pct) => patch(seq, { progress: pct }));
        if (onPersist) await onPersist({ seq, url, fileName: file.name });
        patch(seq, { state: 'uploaded', url, fileName: file.name, progress: 100, error: undefined, sourceDocumentId: undefined });
      } catch (err) {
        const code = err instanceof UploadError ? err.code : (err as { code?: string })?.code ?? 'unknown';
        patch(seq, { state: 'error', error: errMsg(code) });
      }
    },
    [patch, errMsg, onPersist],
  );

  const handleRemove = useCallback(
    async (seq: number) => {
      patch(seq, { state: 'empty', url: undefined, previewUrl: undefined, fileName: undefined, progress: 0, error: undefined, sourceDocumentId: undefined });
      if (onRemovePersist) {
        try {
          await onRemovePersist(seq);
        } catch {
          /* best-effort */
        }
      }
    },
    [patch, onRemovePersist],
  );

  const setName = useCallback((seq: number, name: string) => patch(seq, { name }), [patch]);

  // On blur, run the optional ID/passport-number check (e.g. blocklist) once a
  // photo exists, and flag the card if it comes back blocked. Best-effort — the
  // server re-enforces at booking creation, so a failed check never blocks input.
  const commitName = useCallback(
    (seq: number) => {
      if (!onNameCommit) return;
      const slot = slotsRef.current.find((s) => s.seq === seq);
      if (!slot || slot.state !== 'uploaded') return;
      const value = (slot.name ?? '').trim() || null;
      void (async () => {
        try {
          const res = await onNameCommit(seq, value);
          patch(seq, { error: res && res.blocked ? errMsg('blocked') : undefined });
        } catch {
          /* best-effort — final create still enforces server-side */
        }
      })();
    },
    [onNameCommit, patch, errMsg],
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {slots.map((slot) => (
        <GuestCard key={slot.seq} slot={slot} t={t} onFile={handleFile} onRemove={handleRemove} onName={setName} onNameBlur={onNameCommit ? commitName : undefined} />
      ))}
      {/* Children — shown clearly in the same grid, but with a child icon and NO
          ID upload (no document is required or collected for them). */}
      {Array.from({ length: Math.max(0, childrenCount) }, (_, i) => (
        <ChildCard key={`child-${count + i + 1}`} seq={count + i + 1} t={t} />
      ))}
    </div>
  );
}

/** A friendly child avatar (no ID photo) — used for child guest cards. */
function ChildAvatar() {
  return (
    <span
      aria-hidden
      style={{
        width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center',
        background: 'rgba(194,161,78,0.12)', border: `1px solid ${gold}55`,
      }}
    >
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="6" r="3" />
        <path d="M12 9v6" /><path d="M8 12h8" /><path d="M9 21l3-6 3 6" />
      </svg>
    </span>
  );
}

/** Display-only child guest card: child icon + label, never an ID upload. */
const ChildCard = memo(function ChildCard({ seq, t }: { seq: number; t: GuestUploadCopy }) {
  return (
    <div
      style={{
        borderRadius: 18, background: panel, border: `1px solid ${line}`,
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${line}` }}>
        <span style={{ fontFamily: serif, fontSize: 16, color: cream }}>{t.child} {seq}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: gold }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: gold }} />
          {t.child}
        </span>
      </div>
      <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 150, textAlign: 'center' }}>
        <ChildAvatar />
        <span style={{ fontFamily: serif, fontSize: 17, color: cream }}>{t.child} {seq}</span>
        <span style={{ fontFamily: sans, fontSize: 11.5, color: faint }}>{t.childNoId}</span>
      </div>
    </div>
  );
});

interface CardProps {
  slot: Slot;
  t: GuestUploadCopy;
  onFile: (seq: number, file: File) => void;
  onRemove: (seq: number) => void;
  onName: (seq: number, name: string) => void;
  /** Optional commit-on-blur for the ID/passport number (e.g. blocklist check). */
  onNameBlur?: (seq: number) => void;
}

const GuestCard = memo(function GuestCard({ slot, t, onFile, onRemove, onName, onNameBlur }: CardProps) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (file?: File | null) => {
    if (file) onFile(slot.seq, file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const stateColor = slot.state === 'uploaded' ? ok : slot.state === 'error' ? bad : slot.state === 'uploading' ? gold : faint;
  const stateLabel =
    slot.state === 'uploaded'
      ? slot.sourceDocumentId
        ? t.reused ?? t.uploaded
        : t.uploaded
      : slot.state === 'error'
        ? t.failed
        : slot.state === 'uploading'
          ? t.uploading
          : t.pending;
  const preview = slot.url ?? slot.previewUrl;

  return (
    <div
      style={{
        borderRadius: 18, background: panel, border: `1px solid ${dragOver ? gold : line}`,
        boxShadow: dragOver ? `0 0 0 3px rgba(194,161,78,0.20)` : 'none',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${line}` }}>
        <span style={{ fontFamily: serif, fontSize: 16, color: cream }}>{t.guest} {slot.seq}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: stateColor }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: stateColor, boxShadow: `0 0 8px ${stateColor}` }} />
          {stateLabel}
        </span>
      </div>

      <div style={{ padding: 14, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <input
          value={slot.name ?? ''}
          onChange={(e) => onName(slot.seq, e.target.value)}
          onBlur={() => onNameBlur?.(slot.seq)}
          placeholder={`${t.guest} ${slot.seq} — ${t.nameLabel ?? 'name'}`}
          maxLength={80}
          aria-label={`${t.guest} ${slot.seq} ${t.nameLabel ?? 'name'}`}
          style={{
            width: '100%', height: 40, borderRadius: 10, background: 'rgba(28,43,64,0.04)',
            border: `1px solid ${line}`, color: cream, padding: '0 12px', fontSize: 14,
            fontFamily: sans, outline: 'none', marginBottom: 12,
          }}
        />
        {preview ? (
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', aspectRatio: '4 / 3', background: '#e3e8ec' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={`${t.guest} ${slot.seq}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: slot.state === 'uploading' ? 0.55 : 1 }} />
            {slot.state === 'uploading' && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                <div style={{ width: '72%' }}>
                  <div style={{ height: 6, borderRadius: 99, background: 'rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${slot.progress}%`, background: gold, transition: 'width 0.2s' }} />
                  </div>
                  <p style={{ textAlign: 'center', color: '#ffffff', fontSize: 12, marginTop: 8 }}>{slot.progress}%</p>
                </div>
              </div>
            )}
            {slot.state === 'uploaded' && (
              <span style={{ position: 'absolute', top: 8, insetInlineEnd: 8, width: 26, height: 26, borderRadius: '50%', background: ok, display: 'grid', placeItems: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
              flex: 1, minHeight: 150, width: '100%', cursor: 'pointer', borderRadius: 12,
              border: `1.5px dashed ${dragOver ? gold : 'rgba(28,43,64,0.22)'}`,
              background: dragOver ? 'rgba(194,161,78,0.08)' : 'rgba(28,43,64,0.02)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              color: dim, fontFamily: sans, transition: 'all 0.2s',
            }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v13" />
            </svg>
            <span style={{ fontSize: 13, color: cream }}>{t.dropHere}</span>
            <span style={{ fontSize: 11, color: faint }}>{t.accepted}</span>
          </button>
        )}

        {slot.error && <p style={{ color: bad, fontSize: 12, margin: '10px 0 0' }}>{slot.error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {slot.state === 'uploaded' || slot.state === 'error' ? (
            <>
              <button type="button" onClick={() => galleryRef.current?.click()} style={cardBtn}>
                {slot.state === 'error' ? t.retry : t.replace}
              </button>
              {slot.state === 'uploaded' && (
                <button type="button" onClick={() => onRemove(slot.seq)} style={{ ...cardBtn, color: bad, borderColor: 'rgba(192,57,43,0.4)' }}>
                  {t.remove}
                </button>
              )}
            </>
          ) : slot.state !== 'uploading' ? (
            <>
              <button type="button" onClick={() => galleryRef.current?.click()} style={cardBtn}>{t.browse}</button>
              <button type="button" onClick={() => cameraRef.current?.click()} style={cardBtn}>{t.camera}</button>
            </>
          ) : null}
        </div>
      </div>

      <input ref={galleryRef} type="file" accept={ACCEPT} hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
});

const cardBtn: CSSProperties = {
  flex: 1, height: 38, borderRadius: 10, border: `1px solid rgba(28,43,64,0.18)`,
  background: 'rgba(28,43,64,0.03)', color: cream, fontFamily: sans, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
