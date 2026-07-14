'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Shared UI primitives for the Housekeeping & Maintenance desk (`/gate/ops`).
 * CROWN midnight + gold staff design language (same family as the reception
 * desk), with per-status / per-priority accent colours.
 */

export const OPS = {
  bg: '#f4f6f7',
  panel: '#ffffff',
  panel2: 'rgba(28,43,64,0.04)',
  line: 'rgba(28,43,64,0.12)',
  cream: '#1c2b40',
  dim: 'rgba(28,43,64,0.65)',
  faint: 'rgba(28,43,64,0.5)',
  gold: '#9c7d34',
  ok: '#1b8a52',
  warn: '#b0790e',
  bad: '#c2410c',
  sky: '#1b727a',
  violet: '#7c4d96',
  serif: 'var(--font-aurelia-display), "Cormorant Garamond", serif',
  sans: 'var(--font-aurelia-sans), Manrope, system-ui, sans-serif',
} as const;

export const STATUS_META: Record<string, { c: string; label: string }> = {
  NEW: { c: OPS.gold, label: 'New' },
  OPEN: { c: OPS.dim, label: 'Open' },
  ASSIGNED: { c: OPS.sky, label: 'Assigned' },
  IN_PROGRESS: { c: OPS.warn, label: 'In progress' },
  WAITING: { c: OPS.violet, label: 'Waiting' },
  COMPLETED: { c: OPS.ok, label: 'Completed' },
  CANCELLED: { c: 'rgba(28,43,64,0.45)', label: 'Cancelled' },
  REOPENED: { c: OPS.bad, label: 'Reopened' },
};

export const PRIORITY_META: Record<string, { c: string; label: string }> = {
  LOW: { c: 'rgba(28,43,64,0.5)', label: 'Low' },
  MEDIUM: { c: OPS.gold, label: 'Medium' },
  HIGH: { c: OPS.warn, label: 'High' },
  URGENT: { c: OPS.bad, label: 'Urgent' },
};

export const TYPE_META: Record<string, { label: string; icon: string }> = {
  HOUSEKEEPING: { label: 'Housekeeping', icon: '🧹' },
  CLEANING: { label: 'Cleaning', icon: '🧼' },
  INSPECTION: { label: 'Inspection', icon: '🔍' },
  MAINTENANCE: { label: 'Maintenance', icon: '🔧' },
  REPAIR: { label: 'Repair', icon: '🛠️' },
  OUT_OF_SERVICE: { label: 'Out of service', icon: '⛔' },
  OTHER: { label: 'Other', icon: '📋' },
};

export function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        padding: '0 9px',
        borderRadius: 7,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
        color,
        fontFamily: OPS.sans,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const t = useTranslations('ops');
  const m = STATUS_META[status] ?? { c: OPS.dim, label: status };
  // Known statuses get a localized label; an unknown value falls back to itself.
  const label = STATUS_META[status] ? t(`status.${status}`) : status;
  return (
    <Pill color={m.c}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: m.c, display: 'inline-block' }} />
      {label}
    </Pill>
  );
}

export function PriorityPill({ priority }: { priority: string }) {
  const t = useTranslations('ops');
  const m = PRIORITY_META[priority] ?? { c: OPS.dim, label: priority };
  const label = PRIORITY_META[priority] ? t(`priority.${priority}`) : priority;
  return <Pill color={m.c}>{label}</Pill>;
}

export function btn(kind: 'gold' | 'ghost' | 'danger' | 'ok' = 'ghost', disabled = false): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 38,
    padding: '0 15px',
    borderRadius: 11,
    fontFamily: OPS.sans,
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    border: `1px solid ${OPS.line}`,
    background: OPS.panel2,
    color: OPS.dim,
    whiteSpace: 'nowrap',
  };
  if (kind === 'gold')
    return { ...base, background: 'linear-gradient(180deg, #1f4068, #16304f)', border: 'none', color: '#ffffff' };
  if (kind === 'danger') return { ...base, border: '1px solid rgba(194,65,12,0.4)', color: OPS.bad };
  if (kind === 'ok') return { ...base, border: '1px solid rgba(27,138,82,0.4)', color: OPS.ok };
  return base;
}

export const inputStyle: CSSProperties = {
  height: 42,
  width: '100%',
  borderRadius: 11,
  border: `1px solid ${OPS.line}`,
  background: '#ffffff',
  padding: '0 12px',
  color: OPS.cream,
  fontFamily: OPS.sans,
  fontSize: 14,
  outline: 'none',
};

export const selectStyle: CSSProperties = {
  ...inputStyle,
  appearance: 'auto',
  // Native dropdown panels follow the OS theme; hint a light colour-scheme so
  // the option list renders dark-text-on-light to match the page.
  colorScheme: 'light',
};

export const labelStyle: CSSProperties = {
  display: 'block',
  marginBottom: 6,
  color: OPS.faint,
  fontFamily: OPS.sans,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
};

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (ms < 60_000) return 'now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Localized relative time ("{n}m ago" etc.) — hook form so it can read the
 * active locale's `ops.time.*` messages. Mirrors {@link timeAgo} but translated.
 */
export function useTimeAgo() {
  const t = useTranslations('ops');
  return (iso: string, now: number): string => {
    const ms = now - Date.parse(iso);
    if (ms < 60_000) return t('time.now');
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return t('time.minutesAgo', { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('time.hoursAgo', { n: hrs });
    return t('time.daysAgo', { n: Math.floor(hrs / 24) });
  };
}

export function Note({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <div
      style={{
        padding: '22px 20px',
        borderRadius: 14,
        textAlign: 'center',
        fontFamily: OPS.sans,
        fontSize: 13.5,
        lineHeight: 1.5,
        background: tone === 'error' ? 'rgba(194,65,12,0.08)' : OPS.panel2,
        border: `1px solid ${tone === 'error' ? 'rgba(194,65,12,0.3)' : OPS.line}`,
        color: tone === 'error' ? OPS.bad : OPS.faint,
      }}
    >
      {children}
    </div>
  );
}
