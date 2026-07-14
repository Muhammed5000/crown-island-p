'use client';

import { useEffect } from 'react';

/**
 * Root-level error boundary — the last resort when the ROOT layout itself
 * throws (a crash `[locale]/error.tsx` cannot catch because it lives inside
 * that layout). It replaces the entire document, so `globals.css`, fonts and
 * next-intl are unavailable here: everything is inline-styled and the copy is
 * hardcoded bilingual (EN + AR), mirroring the visual tone of
 * `[locale]/error.tsx` without its dependencies.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f6f9fc',
          color: '#0f2a43',
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Tajawal, Roboto, Arial, sans-serif",
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: '#ffffff',
            border: '1px solid #e3ecf5',
            borderRadius: 24,
            padding: '48px 32px',
            boxShadow: '0 12px 40px rgba(15, 42, 67, 0.08)',
          }}
        >
          <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 16 }}>⛈️</div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              margin: '0 0 8px',
            }}
          >
            Something went wrong
          </h1>
          <p dir="rtl" style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>
            حدث خطأ ما
          </p>
          <p style={{ fontSize: 13, color: '#5b7288', margin: '0 0 24px', lineHeight: 1.6 }}>
            An unexpected error occurred. Please try again.
            <br />
            <span dir="rtl">حدث خطأ غير متوقع، من فضلك حاول مرة أخرى.</span>
          </p>
          <button
            onClick={reset}
            style={{
              height: 48,
              padding: '0 40px',
              borderRadius: 16,
              border: 'none',
              cursor: 'pointer',
              background: '#0f2a43',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            Try again / حاول مرة أخرى
          </button>
        </div>
      </body>
    </html>
  );
}
