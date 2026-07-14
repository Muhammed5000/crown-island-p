'use client';

import * as React from 'react';
import { ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/cn';

/** Minimal shape of a Recharts tooltip payload entry, as consumed below. */
interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { fill?: string };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: React.ReactNode;
  content?: React.ReactNode;
  [key: string]: unknown;
}

/**
 * Simplified shadcn-like Chart UI for Crown Island.
 * Wraps Recharts components with project-specific styling and tooltips.
 */

export interface ChartConfig {
  [key: string]: {
    label: string;
    color?: string;
  };
}

interface ChartContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  config: ChartConfig;
  children: React.ReactElement;
}

/**
 * Active locale for number formatting, read from the `<html lang>` next-intl
 * sets — deliberately hook-free so it's safe inside a Recharts `content` render
 * regardless of how Recharts invokes the tooltip component.
 */
function chartLocale(): string {
  if (typeof document === 'undefined') return 'en-US';
  return document.documentElement.lang === 'ar' ? 'ar-EG' : 'en-US';
}

export function ChartContainer({
  config,
  children,
  className,
  ...props
}: ChartContainerProps) {
  // Inject CSS variables for colors if provided in config
  const style = React.useMemo(() => {
    const vars: Record<string, string> = {};
    Object.entries(config).forEach(([key, val]) => {
      if (val.color) {
        vars[`--color-${key}`] = val.color;
      }
    });
    return vars;
  }, [config]);

  return (
    <div
      className={cn('flex aspect-video justify-center text-xs', className)}
      style={style as React.CSSProperties}
      {...props}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export function ChartTooltip({
  active,
  payload,
  label,
  content,
  ...props
}: ChartTooltipProps) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  if (content) {
    return React.cloneElement(content as React.ReactElement<Record<string, unknown>>, {
      active,
      payload,
      label,
      ...props,
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card/95 p-3 shadow-soft backdrop-blur-md">
      <p className="mb-2 font-display text-xs font-semibold text-foreground">{label}</p>
      <div className="space-y-1.5">
        {payload.map((entry: TooltipEntry, index: number) => (
          <div key={index} className="flex items-center gap-2">
            <div
              className="size-2 rounded-full"
              style={{ backgroundColor: entry.color ?? entry.payload?.fill }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium text-foreground">
              {entry.value?.toLocaleString(chartLocale())}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export { ResponsiveContainer, Tooltip, XAxis, YAxis };
