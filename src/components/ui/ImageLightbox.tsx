'use client';

import { useEffect } from 'react';

/** Eye glyph for the "enlarge" affordance on a photo card. */
export function EyeGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Fullscreen image viewer for enlarging an uploaded guest ID. Self-contained
 * inline styles so it drops into both the inline-styled gate screens and the
 * Tailwind admin. Closes on backdrop click, the ✕ button, or Escape.
 */
export function ImageLightbox({
  src,
  alt = 'ID document',
  caption,
  onClose,
}: {
  src: string;
  alt?: string;
  caption?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(4,8,15,0.95)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 18,
          insetInlineEnd: 18,
          width: 44,
          height: 44,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.22)',
          background: 'rgba(0,0,0,0.45)',
          color: '#f5ead0',
          fontSize: 20,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        ✕
      </button>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: '95vw', maxHeight: '92vh' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: '95vw',
            maxHeight: caption ? '82vh' : '88vh',
            objectFit: 'contain',
            borderRadius: 12,
            boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        />
        {caption ? (
          <span style={{ color: '#f5ead0', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-aurelia-sans), Manrope, system-ui, sans-serif' }}>
            {caption}
          </span>
        ) : null}
      </div>
    </div>
  );
}
