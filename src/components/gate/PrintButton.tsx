'use client';

/** Print trigger for the reception invoice. Hidden in the printed output. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="no-print"
      onClick={() => window.print()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 46,
        padding: '0 24px',
        borderRadius: 12,
        background: '#c2a14e',
        color: '#ffffff',
        border: 'none',
        fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      🖨 {label}
    </button>
  );
}
