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
import { ChartContainer, ChartTooltip } from '@/components/ui/Chart';
import type { ChartConfig } from '@/components/ui/Chart';

interface RevenueChartProps {
  data: { date: string; amount: number }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  const config: ChartConfig = {
    amount: {
      label: 'Revenue',
      color: '#d4a557',
    },
  };

  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <AreaChart data={data} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-amount)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-amount)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(212,165,87,0.1)" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          stroke="#9aa6b6"
          fontSize={10}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          stroke="#9aa6b6"
          fontSize={10}
          tickFormatter={(v) => `${v} ج.م`}
        />
        <ChartTooltip />
        <Area
          dataKey="amount"
          type="monotone"
          fill="url(#fillRevenue)"
          stroke="var(--color-amount)"
          strokeWidth={2}
          stackId="a"
        />
      </AreaChart>
    </ChartContainer>
  );
}

interface CategoryChartProps {
  data: { name: string; count: number }[];
}

export function CategoryChart({ data }: CategoryChartProps) {
  const config: ChartConfig = {
    count: {
      label: 'Bookings',
      color: '#e8c47f',
    },
  };

  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <BarChart data={data} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(212,165,87,0.1)" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          stroke="#9aa6b6"
          fontSize={10}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          stroke="#9aa6b6"
          fontSize={10}
        />
        <ChartTooltip />
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          radius={[4, 4, 0, 0]}
          barSize={40}
        />
      </BarChart>
    </ChartContainer>
  );
}

interface StatusChartProps {
  data: { status: string; count: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: '#3ea968',
  PENDING_PAYMENT: '#d4a557',
  CANCELLED: '#dc2626',
  EXPIRED: '#9aa6b6',
  FAILED: '#7f1d1d',
};

export function StatusChart({ data }: StatusChartProps) {
  const config: ChartConfig = {};
  data.forEach((d) => {
    config[d.status] = {
      label: d.status,
      color: STATUS_COLORS[d.status] ?? '#9aa6b6',
    };
  });

  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <PieChart>
        <ChartTooltip />
        <Pie
          data={data}
          dataKey="count"
          nameKey="status"
          innerRadius={60}
          outerRadius={80}
          paddingAngle={5}
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={STATUS_COLORS[entry.status] ?? '#9aa6b6'}
              stroke="none"
            />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
