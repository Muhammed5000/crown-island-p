'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import { type ChartConfig, ChartContainer, ChartTooltip } from '@/components/ui/Chart';

/**
 * Reports chart kit — the dashboard chart recipes (DashboardCharts.tsx) reused
 * with parameterized labels and a locale-aware currency suffix instead of the
 * dashboard's hardcoded Arabic one.
 */

const GOLD = '#d4a557';
const GOLD_LIGHT = '#e8c47f';
const AXIS = '#9aa6b6';
const GRID = 'rgba(212,165,87,0.1)';

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: '#3ea968',
  PENDING_PAYMENT: '#d4a557',
  CANCELLED: '#dc2626',
  EXPIRED: '#9aa6b6',
  FAILED: '#7f1d1d',
};

export function ReportAreaChart({
  data,
  label,
  currencySuffix,
}: {
  data: { date: string; amount: number }[];
  label: string;
  currencySuffix?: string;
}) {
  const config: ChartConfig = { amount: { label, color: GOLD } };
  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <AreaChart data={data} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="fillReportArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-amount)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-amount)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} stroke={AXIS} fontSize={10} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          stroke={AXIS}
          fontSize={10}
          tickFormatter={(v) => (currencySuffix ? `${v} ${currencySuffix}` : String(v))}
        />
        <ChartTooltip />
        <Area dataKey="amount" type="monotone" fill="url(#fillReportArea)" stroke="var(--color-amount)" strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}

export function ReportBarChart({
  data,
  label,
  currencySuffix,
}: {
  data: { name: string; value: number }[];
  label: string;
  currencySuffix?: string;
}) {
  const config: ChartConfig = { value: { label, color: GOLD_LIGHT } };
  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <BarChart data={data} margin={{ left: -10, right: 10, top: 10, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} stroke={AXIS} fontSize={10} interval={0} angle={data.length > 8 ? -30 : 0} height={data.length > 8 ? 60 : 30} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          stroke={AXIS}
          fontSize={10}
          tickFormatter={(v) => (currencySuffix ? `${v} ${currencySuffix}` : String(v))}
        />
        <ChartTooltip />
        <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} barSize={32} />
      </BarChart>
    </ChartContainer>
  );
}

export function ReportStatusDonut({ data }: { data: { status: string; count: number; name: string }[] }) {
  const config: ChartConfig = {};
  data.forEach((d) => {
    config[d.name] = { label: d.name, color: STATUS_COLORS[d.status] ?? AXIS };
  });
  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <PieChart>
        <ChartTooltip />
        <Pie data={data} dataKey="count" nameKey="name" innerRadius={60} outerRadius={80} paddingAngle={5}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status] ?? AXIS} stroke="none" />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
