import type { SVGProps } from 'react';

/**
 * Field icons for the Complete Profile screen — ported from the Crown Island
 * design package (`profile-shared.jsx` → `Ico`). Stroke uses `currentColor`
 * so the colour is controlled by the parent's text colour (champagne gold on
 * focus, faint cream at rest).
 */
export type FieldIconName = 'user' | 'phone' | 'mail' | 'age' | 'shield' | 'id' | 'pin';

const stroke: SVGProps<SVGSVGElement> = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function FieldIcon({ name, className }: { name: FieldIconName; className?: string }) {
  switch (name) {
    case 'user':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5 19.5c.7-3.8 3.4-5.8 7-5.8s6.3 2 7 5.8" />
        </svg>
      );
    case 'phone':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
          <path d="M6.5 3h3l1.4 4-2 1.4a12 12 0 0 0 5.2 5.2l1.4-2 4 1.4v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z" />
        </svg>
      );
    case 'mail':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M4 7l8 5.5L20 7" />
        </svg>
      );
    case 'age':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
          <path d="M5 10.5h14V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-8.5z" />
          <path d="M4 10.5h16M9 10.5V8a3 3 0 0 1 6 0v2.5" />
          <path d="M9 4.2c0 .8-.5 1.2-1 1.6M15 4.2c0 .8-.5 1.2-1 1.6M12 3.6c0 .9-.6 1.3-1 1.8" />
        </svg>
      );
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
          <path d="M12 3l7 3v5c0 4.5-3 8-7 9.5C8 19 5 15.5 5 11V6l7-3z" />
          <path d="M9.5 11.8l1.8 1.8L15 9.6" />
        </svg>
      );
    case 'id':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="8.5" cy="11" r="2" />
          <path d="M5.5 16.5c.4-1.6 1.5-2.4 3-2.4s2.6.8 3 2.4M14 9.5h4M14 12.5h4M14 15.5h2.5" />
        </svg>
      );
    case 'pin':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden {...stroke}>
          <path d="M12 21c4-4.5 6-7.6 6-10.5A6 6 0 0 0 6 10.5C6 13.4 8 16.5 12 21z" />
          <circle cx="12" cy="10.5" r="2.2" />
        </svg>
      );
    default:
      return null;
  }
}
