'use client';

import { useId, useRef, useState } from 'react';
import {
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  TrashIcon,
  UploadCloudIcon,
  VideoIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { cn } from '@/lib/cn';

/**
 * Drop-in replacement for the old URL `<Input>` we used for cover photos,
 * promo videos, etc. The form still serialises a single string under
 * `props.name` — so the server-side parsers don't need to change — but the
 * admin now picks a local file, watches it compress, and sees a preview.
 *
 * Compression strategy:
 *  - images: `browser-image-compression` resizes to ≤1920px on the long edge
 *    and re-encodes to ≤1MB (target). Output is JPEG/WebP depending on input.
 *  - videos: NO browser-side transcoding — that needs ffmpeg.wasm (~30MB
 *    bundle) which would dwarf the rest of the app. We instead enforce a
 *    100MB cap and surface the size to the admin so they can re-export.
 *
 * Errors:
 *  - validation problems (size, mime) come back as JSON `{ ok:false, detail }`
 *    and are rendered inline; the upload UI never silently swallows failures.
 */

type Accept = 'image' | 'video' | 'pdf';

interface Props {
  /** Form field name — what the server action reads. */
  name: string;
  /** Optional human label shown above the control. */
  label?: string;
  /** Pre-filled URL when editing an existing record. */
  defaultValue?: string;
  /** Restrict the file picker to images, videos or PDF documents. */
  accept: Accept;
  /** Inline error from a server-side validation pass. */
  error?: string | null;
  /** Optional helper text under the field. */
  hint?: string;
  /** Force `dir="ltr"` on the URL input (URLs always render LTR). */
  dir?: 'ltr' | 'rtl';
  /**
   * Upload endpoint. Defaults to the admin uploader; role-specific forms
   * (e.g. the restaurant partner dashboard) point at their own gated route.
   */
  endpoint?: string;
  /**
   * When false, the free-text URL input is replaced by a hidden field — for
   * forms whose server action only accepts our own `/uploads/…` paths, where
   * pasting an external URL could never validate anyway.
   */
  allowUrlInput?: boolean;
  /**
   * Optional extra form field carrying the picked file's ORIGINAL name
   * (display metadata, e.g. the menu PDF's filename). Submitted alongside
   * `name`; pre-filled from `defaultFileName` when editing.
   */
  fileNameField?: string;
  defaultFileName?: string;
  /** Optional extra form field carrying the uploaded file's size in bytes. */
  fileSizeField?: string;
  defaultFileSize?: number;
}

interface UploadOk {
  ok: true;
  url: string;
  mediaId?: string | null;
  mimeType: string;
  sizeBytes: number;
  kind: 'image' | 'video' | 'pdf';
}
interface UploadErr {
  ok: false;
  code: string;
  detail?: string;
}

export function MediaUploadInput({
  name,
  label,
  defaultValue,
  accept,
  error,
  hint,
  dir = 'ltr',
  endpoint = '/api/admin/upload',
  allowUrlInput = true,
  fileNameField,
  defaultFileName,
  fileSizeField,
  defaultFileSize,
}: Props) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [url, setUrl] = useState(defaultValue ?? '');
  const [fileName, setFileName] = useState(defaultFileName ?? '');
  const [fileSize, setFileSize] = useState<number | null>(defaultFileSize ?? null);
  const [isUploading, setUploading] = useState(false);
  const [stage, setStage] = useState<'idle' | 'compressing' | 'uploading'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const acceptAttr =
    accept === 'image' ? 'image/*' : accept === 'video' ? 'video/*' : 'application/pdf,.pdf';
  const Icon = accept === 'image' ? ImageIcon : accept === 'video' ? VideoIcon : FileTextIcon;

  async function handleFile(file: File) {
    setUploadError(null);
    setProgress(null);

    let toUpload: File = file;

    // Client-side compression — only meaningful for RASTER images. SVG is a
    // vector format (browser-image-compression would rasterise it and destroy
    // the scalability), and videos need ffmpeg.wasm; both skip compression and
    // rely on size validation instead.
    if (
      accept === 'image' &&
      file.type.startsWith('image/') &&
      file.type !== 'image/svg+xml'
    ) {
      try {
        setStage('compressing');
        setUploading(true);
        // Lazy-load the compressor (~50KB gz) only when a file is actually
        // picked — keeps it out of the admin form bundles entirely.
        const { default: imageCompression } = await import('browser-image-compression');
        const compressed = await imageCompression(file, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
          // Re-encode as the same format the input was. JPEG/PNG/WebP all
          // gain from the resize step even when re-encoded to themselves.
          fileType: file.type,
          // Don't let an over-eager compressor produce a bigger file than
          // the source — fall back to the original in that case.
          alwaysKeepResolution: false,
        });
        // If the "compressed" file is actually larger (rare, but happens on
        // tiny PNGs), keep the original.
        toUpload = compressed.size < file.size ? compressed : file;
      } catch (err) {
        // Don't fail the whole flow — upload the original file and surface
        // a non-blocking warning in the console.
        console.warn('image compression failed; uploading original', err);
        toUpload = file;
      }
    }

    // Hard size guards mirror the server, so we fail fast without round-trip.
    const isImage = toUpload.type.startsWith('image/');
    const isVideo = toUpload.type.startsWith('video/');
    const isPdf = toUpload.type === 'application/pdf';
    const typeOk = accept === 'pdf' ? isPdf : isImage || isVideo;
    if (!typeOk) {
      setUploadError(
        accept === 'pdf'
          ? 'Unsupported file type — the menu must be a PDF.'
          : 'Unsupported file type — pick an image or video.',
      );
      setUploading(false);
      setStage('idle');
      return;
    }
    const cap = isPdf ? 15 : isImage ? 10 : 100; // MB
    if (toUpload.size > cap * 1024 * 1024) {
      setUploadError(
        `File is ${(toUpload.size / (1024 * 1024)).toFixed(1)}MB — limit is ${cap}MB for ${isPdf ? 'PDFs' : isImage ? 'images' : 'videos'}.`,
      );
      setUploading(false);
      setStage('idle');
      return;
    }

    // POST to the upload endpoint. We use XMLHttpRequest (rather than fetch)
    // because it exposes upload-progress events, which large videos need.
    setStage('uploading');
    setUploading(true);
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', toUpload);

      const result = await new Promise<UploadOk | UploadErr>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint);
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });
        xhr.onerror = () => reject(new Error('Network error — check your connection.'));
        xhr.ontimeout = () => reject(new Error('Upload timed out — file may be too large.'));
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText);
            resolve(json);
          } catch {
            reject(new Error(`Server returned ${xhr.status} — check the dev console.`));
          }
        };
        xhr.send(formData);
      });

      if (!result.ok) {
        setUploadError(result.detail ?? mapErrorCode(result.code));
        return;
      }
      setUrl(result.url);
      // Original picked name + real stored size — display metadata only; the
      // server never uses the client name for storage paths.
      setFileName(file.name);
      setFileSize(result.sizeBytes);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      setStage('idle');
      setProgress(null);
      // Always clear the file input so picking the same file twice re-fires.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function clear() {
    setUrl('');
    setFileName('');
    setFileSize(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const isVideoUrl = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?.*)?$/i.test(url);

  return (
    <div className="space-y-2">
      {label ? <Label htmlFor={inputId}>{label}</Label> : null}

      {/* Preview / drop zone */}
      <div
        className={cn(
          'group relative flex min-h-[160px] items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed bg-input/40 p-4 transition',
          uploadError
            ? 'border-danger/60'
            : url
              ? 'border-gold-400/40'
              : 'border-border/60 hover:border-gold-400/40',
        )}
      >
        {url && accept === 'pdf' ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <FileTextIcon className="size-9 text-gold-600" strokeWidth={1.5} />
            <p className="max-w-[320px] truncate text-[13px] font-semibold text-foreground" dir="ltr">
              {fileName || url.split('/').pop()}
            </p>
            {fileSize != null ? (
              <p className="text-[11px] text-muted-foreground">
                {(fileSize / (1024 * 1024)).toFixed(1)} MB · PDF
              </p>
            ) : null}
          </div>
        ) : url && accept === 'image' && !isVideoUrl ? (
          // Plain <img> on purpose — next/image needs build-time domain config
          // and admin previews don't justify routing through the optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="max-h-[260px] w-auto rounded-xl object-contain shadow"
          />
        ) : url && (accept === 'video' || isVideoUrl) ? (
          <video
            src={url}
            controls
            className="max-h-[260px] w-full rounded-xl bg-black"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
            <Icon className="size-8 text-gold-500" strokeWidth={1.5} />
            <p className="text-[13px] font-medium">
              {accept === 'image'
                ? 'Drop an image, or pick a file'
                : accept === 'video'
                  ? 'Drop a video, or pick a file'
                  : 'Drop a PDF, or pick a file'}
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              {accept === 'image'
                ? 'JPG, PNG, WebP, GIF, AVIF — compressed to ≤1MB. SVG also accepted (kept as-is)'
                : accept === 'video'
                  ? 'MP4, WebM, MOV — up to 100MB'
                  : 'PDF only — up to 15MB'}
            </p>
          </div>
        )}

        {/* Overlay button when a preview is showing */}
        {url ? (
          <button
            type="button"
            onClick={clear}
            disabled={isUploading}
            className="absolute end-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-cream backdrop-blur-md transition hover:border-danger/60 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
          >
            <TrashIcon className="size-3.5" strokeWidth={2.5} />
            Remove
          </button>
        ) : null}

        {/* Progress overlay */}
        {isUploading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy-950/85 backdrop-blur-sm">
            <Loader2Icon className="size-7 animate-spin text-gold-300" />
            <p className="text-[12px] font-bold uppercase tracking-widest text-gold-200">
              {stage === 'compressing' ? 'Compressing…' : 'Uploading…'}
              {progress != null ? ` ${progress}%` : null}
            </p>
            {progress != null ? (
              <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gold-400 transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* File input + URL input row */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label
          className={cn(
            'group relative inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-gold-400/40 bg-gold-400/10 px-5 text-[12px] font-bold uppercase tracking-widest text-gold-700 transition hover:bg-gold-400/20',
            isUploading && 'pointer-events-none opacity-60',
          )}
        >
          <UploadCloudIcon className="size-4" strokeWidth={2.5} />
          {url ? 'Replace file' : 'Upload file'}
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptAttr}
            onChange={onPick}
            className="sr-only"
            disabled={isUploading}
          />
        </label>
        {allowUrlInput ? (
          <Input
            id={inputId}
            name={name}
            // Plain text, NOT type="url": the field also holds app-relative upload
            // paths (e.g. /uploads/2026/06/x.jpg) which the browser's native
            // type="url" check rejects, blocking submit before our JS/Zod runs.
            // Validity is enforced server-side by the mediaUrl() schema instead.
            type="text"
            inputMode="url"
            dir={dir}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… or upload a file"
            invalid={!!error}
            className="flex-1"
          />
        ) : (
          // Upload-only mode: the value still submits under `name`, but the
          // user can't paste arbitrary URLs (the action only accepts our own
          // /uploads/… paths anyway).
          <input type="hidden" name={name} value={url} />
        )}
        {fileNameField ? <input type="hidden" name={fileNameField} value={fileName} /> : null}
        {fileSizeField ? (
          <input type="hidden" name={fileSizeField} value={fileSize ?? ''} />
        ) : null}
      </div>

      {uploadError ? (
        <p className="text-[12px] font-medium text-danger">{uploadError}</p>
      ) : error ? (
        <p className="text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function mapErrorCode(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Your account is not allowed to upload here.';
    case 'no_file':
      return 'No file was attached — please pick one.';
    case 'unsupported_type':
      return 'That file type is not supported.';
    case 'too_large':
      return 'File is over the size limit.';
    case 'bad_request':
      return 'The upload request was malformed — please try again.';
    default:
      return 'Upload failed — please try again.';
  }
}
