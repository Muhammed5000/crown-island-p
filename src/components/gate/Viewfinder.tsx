'use client';

import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  MultiFormatReader,
  DecodeHintType,
  BarcodeFormat,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} from '@zxing/library';
import { CROWN } from './tokens';

interface Props {
  size: number;
  /** Camera should be live and decoding. */
  active: boolean;
  /** A pass has been detected — freeze the frame and turn brackets green. */
  detected: boolean;
  /** Fired once per detection with the decoded QR / barcode string. */
  onResult: (data: string) => void;
  /** Bubble up camera-permission / hardware errors so the shell can fall back. */
  onCameraError?: (message: string) => void;
}

// ── Native BarcodeDetector typings (not yet in TS DOM lib) ────────────────
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

// Formats the gate accepts: the legacy QR pass and the Code 128 ticket barcode.
const WANTED_FORMATS = ['qr_code', 'code_128'];

// ── ZXing multi-format fallback (browsers without BarcodeDetector, e.g. iOS) ──
// One reader, reused across frames. It decodes both QR and Code 128 from a
// canvas snapshot so the camera path works everywhere the native detector is
// missing.
let zxingReader: MultiFormatReader | null = null;
let zxingHints: Map<DecodeHintType, unknown> | null = null;

function decodeWithZxing(img: ImageData): string | null {
  if (!zxingReader) {
    zxingReader = new MultiFormatReader();
    zxingHints = new Map<DecodeHintType, unknown>();
    zxingHints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]);
    zxingHints.set(DecodeHintType.TRY_HARDER, true);
  }
  const { data, width, height } = img;
  // RGBA → single-byte luminance (green-favoured), which RGBLuminanceSource
  // consumes directly.
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i]! * 306 + data[i + 1]! * 601 + data[i + 2]! * 117) >> 10;
  }
  try {
    const source = new RGBLuminanceSource(gray, width, height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    return zxingReader.decode(bitmap, zxingHints ?? undefined).getText();
  } catch {
    return null; // nothing decodable in this frame
  } finally {
    zxingReader.reset();
  }
}

/**
 * Live camera viewfinder with real QR + Code 128 decoding.
 *
 * Streams the rear camera into a rounded frame styled to match the Crown Island
 * design — gold corner brackets, a sweeping scan line while searching, and a
 * green lock when a pass is detected.
 *
 * Decoding strategy (robust against both the dense signed-token QR and its long
 * Code 128 barcode equivalent):
 *  1. Prefer the native `BarcodeDetector` (Chrome/Edge, incl. Android kiosks) —
 *     hardware-accelerated and far more tolerant of focus/angle/glare. We ask it
 *     for both `qr_code` and `code_128`.
 *  2. Fall back to a canvas snapshot at up to 1280px (not 640px, which blurred
 *     the dense token below threshold): jsQR for QR with `attemptBoth`
 *     inversion, then ZXing's multi-format reader for Code 128 (this also covers
 *     browsers with no `BarcodeDetector`, such as iOS Safari).
 * The first successful decode fires `onResult`; the loop idles until the parent
 * clears `detected`.
 */
export function Viewfinder({ size, active, detected, onResult, onCameraError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Scratch canvas for the 90°-rotated ZXing retry (1D barcodes held vertically).
  const rotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const firedRef = useRef(false);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const inFlightRef = useRef(false);
  const lastScanRef = useRef(0);
  // Mirror `detected` into a ref so the rAF loop (closed over once per `active`
  // change) always reads the current value rather than a stale capture.
  const detectedRef = useRef(detected);
  const [ready, setReady] = useState(false);

  const stroke = detected ? CROWN.ok : CROWN.gold;

  // Reset the one-shot guard whenever we leave the detected state.
  useEffect(() => {
    detectedRef.current = detected;
    if (!detected) firedRef.current = false;
  }, [detected]);

  useEffect(() => {
    let cancelled = false;

    async function makeDetector(): Promise<BarcodeDetectorLike | null> {
      const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!Ctor) return null;
      try {
        const supported = (await Ctor.getSupportedFormats?.()) ?? WANTED_FORMATS;
        const formats = WANTED_FORMATS.filter((f) => supported.includes(f));
        if (formats.length === 0) return null;
        return new Ctor({ formats });
      } catch {
        return null;
      }
    }

    async function start() {
      if (!active) return;
      // getUserMedia only exists in a secure context (https: or http://localhost).
      // Gate phones often hit the dev/LAN server over http://<ip>, where it's
      // undefined — surface the real cause instead of a generic "unavailable".
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        onCameraError?.('Camera needs HTTPS — open this page over https:// or localhost');
        return;
      }
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        onCameraError?.('Camera not available on this device');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            // A sharper frame lets jsQR/BarcodeDetector resolve the dense token —
            // 1080p so the centre-square ROI still has plenty of pixels/module.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        // Best-effort autofocus, but only where the track advertises it —
        // applying a blind constraint can silently no-op and leave a close-held
        // QR blurred. Where supported, also nudge focus to its nearest distance
        // (gate QRs are held close), which a generic continuous-AF often hunts past.
        const track = stream.getVideoTracks()[0];
        try {
          const caps = (track?.getCapabilities?.() ?? {}) as {
            focusMode?: string[];
            focusDistance?: { min: number };
          };
          const advanced: MediaTrackConstraintSet[] = [];
          if (caps.focusMode?.includes('continuous')) {
            advanced.push({ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet);
          }
          if (caps.focusDistance) {
            advanced.push({ focusDistance: caps.focusDistance.min } as unknown as MediaTrackConstraintSet);
          }
          if (advanced.length) await track?.applyConstraints({ advanced });
        } catch {
          /* focus control not supported — fine */
        }

        detectorRef.current = await makeDetector();

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          await video.play().catch(() => {});
          setReady(true);
          rafRef.current = requestAnimationFrame(tick);
        }
      } catch {
        if (!cancelled) onCameraError?.('Camera permission denied');
      }
    }

    async function tick(now: number) {
      rafRef.current = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!video || video.readyState < 2) return;
      if (detectedRef.current || firedRef.current) return;
      // Throttle decoding to ~12/s — plenty for scanning, and avoids piling up
      // async BarcodeDetector calls or thrashing the CPU on full-res frames.
      if (now - lastScanRef.current < 80) return;
      // One decode in flight at a time, across BOTH the native and canvas paths.
      if (inFlightRef.current) return;
      lastScanRef.current = now;

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;

      const fire = (value: string | null | undefined) => {
        if (value && !firedRef.current && !detectedRef.current) {
          firedRef.current = true;
          onResult(value);
        }
      };

      // Decode only the CENTER SQUARE the operator actually sees — the <video>
      // is objectFit:cover into a square frame, so the visible (and aimed-at)
      // region is the centre min(w,h)×min(w,h) crop. Scanning that ROI at near
      // source resolution, instead of the whole landscape frame, multiplies the
      // pixels-per-module on a dense signed-token QR (the old code scanned the
      // full frame, leaving the code too small to resolve reliably on phones).
      const side = Math.min(w, h);
      const sx = (w - side) / 2;
      const sy = (h - side) / 2;
      const target = Math.min(side, 1024);

      let canvas = canvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvasRef.current = canvas;
      }
      canvas.width = target;
      canvas.height = target;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      inFlightRef.current = true;
      try {
        ctx.drawImage(video, sx, sy, side, side, 0, 0, target, target);

        // 1. Native BarcodeDetector (Android/Chrome) on the cropped ROI. An EMPTY
        //    result does NOT throw — fall through to jsQR/ZXing instead of getting
        //    permanently stuck on a fast path that can't resolve the dense token.
        const detector = detectorRef.current;
        if (detector) {
          try {
            const codes = await detector.detect(canvas);
            const value = codes?.[0]?.rawValue;
            if (value) {
              fire(value);
              return;
            }
          } catch {
            // Native path failed — drop to jsQR/ZXing for the rest of the session.
            detectorRef.current = null;
          }
        }

        // 2. QR via jsQR (rotation-invariant), with both inversion polarities.
        const img = ctx.getImageData(0, 0, target, target);
        const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (qr?.data) {
          fire(qr.data);
          return;
        }

        // 3. Code 128 (and QR) via ZXing on the upright ROI…
        const upright = decodeWithZxing(img);
        if (upright) {
          fire(upright);
          return;
        }

        // 4. …then a 90°-rotated copy: ZXing scans only horizontal rows, so a 1D
        //    bracelet barcode held vertically in a portrait frame never decodes
        //    upright. QR is already rotation-invariant, so this only adds Code-128
        //    orientation coverage, and only runs once the upright pass has failed.
        let rot = rotCanvasRef.current;
        if (!rot) {
          rot = document.createElement('canvas');
          rotCanvasRef.current = rot;
        }
        rot.width = target;
        rot.height = target;
        const rctx = rot.getContext('2d', { willReadFrequently: true });
        if (rctx) {
          rctx.save();
          rctx.translate(target / 2, target / 2);
          rctx.rotate(Math.PI / 2);
          rctx.drawImage(canvas, -target / 2, -target / 2);
          rctx.restore();
          fire(decodeWithZxing(rctx.getImageData(0, 0, target, target)));
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    if (active) start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      detectorRef.current = null;
      inFlightRef.current = false;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        borderRadius: 28,
        overflow: 'hidden',
        background: 'radial-gradient(ellipse at 40% 30%, #eef1f4 0%, #e3e8ec 70%, #d7dde2 100%)',
        boxShadow: 'inset 0 0 60px rgba(28,43,64,0.10)',
      }}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: ready ? (detected ? 1 : 0.92) : 0,
          transition: 'opacity 0.4s ease, transform 0.4s ease',
          transform: detected ? 'scale(1.02)' : 'scale(1)',
        }}
      />

      {/* idle scrim before the camera is live */}
      {!ready && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: CROWN.faint,
            fontFamily: CROWN.sans,
            fontSize: 12,
            letterSpacing: 0.5,
          }}
        >
          {active ? 'Starting camera…' : 'Camera off'}
        </div>
      )}

      {/* corner brackets */}
      {[
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([rx, ry], i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            [ry ? 'bottom' : 'top']: 18,
            [rx ? 'right' : 'left']: 18,
            width: 34,
            height: 34,
            borderTop: !ry ? `3px solid ${stroke}` : 'none',
            borderBottom: ry ? `3px solid ${stroke}` : 'none',
            borderLeft: !rx ? `3px solid ${stroke}` : 'none',
            borderRight: rx ? `3px solid ${stroke}` : 'none',
            borderTopLeftRadius: !rx && !ry ? 10 : 0,
            borderTopRightRadius: rx && !ry ? 10 : 0,
            borderBottomLeftRadius: !rx && ry ? 10 : 0,
            borderBottomRightRadius: rx && ry ? 10 : 0,
            transition: 'border-color 0.3s',
            filter: detected ? `drop-shadow(0 0 8px ${stroke})` : 'none',
          }}
        />
      ))}

      {/* scan line while searching */}
      {active && !detected && ready && (
        <div
          style={{
            position: 'absolute',
            left: 18,
            right: 18,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${CROWN.gold}, transparent)`,
            boxShadow: `0 0 14px ${CROWN.gold}`,
            animation: 'crown-scanline 1.4s ease-in-out infinite',
          }}
        />
      )}
    </div>
  );
}
