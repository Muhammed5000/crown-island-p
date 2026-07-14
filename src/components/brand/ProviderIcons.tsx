/**
 * Brand-mark SVGs for the third-party providers shown on the login screen.
 * Kept inline (no extra assets) to ship fast on first paint.
 */

export function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.56-2.77c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.83z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export function FacebookIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12a12 12 0 1 0-13.88 11.85V15.47H7.08V12h3.04V9.36c0-3 1.79-4.66 4.53-4.66 1.3 0 2.66.23 2.66.23v2.93h-1.5c-1.49 0-1.95.92-1.95 1.86V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z"
      />
    </svg>
  );
}

export function AppleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.5 1.5c0 1.25-.47 2.45-1.4 3.31-.9.83-2.06 1.45-3.2 1.36-.13-1.18.43-2.4 1.32-3.25.94-.9 2.18-1.5 3.28-1.42zM21.5 17.4c-.55 1.25-.81 1.81-1.52 2.92-1 1.55-2.4 3.48-4.14 3.5-1.55.02-1.94-1-4.04-1-2.1 0-2.54 1-4.09 1.02C5.99 23.85 4.6 22 3.6 20.46c-2.78-4.3-3.08-9.35-1.36-12.04 1.22-1.92 3.14-3.04 5-3.04 1.88 0 3.07 1.05 4.63 1.05 1.5 0 2.42-1.05 4.6-1.05 1.74 0 3.58.95 4.89 2.6-4.3 2.36-3.6 8.5-.06 9.42z" />
    </svg>
  );
}

export function PhoneIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.36 1.85.6 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}
