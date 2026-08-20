'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { renderWidgetErrorFallback } from '@/components/WidgetErrorFallback';

export type ChartDatum = Readonly<{
  label: string;
  value: number;
}>;

interface LineChartCardProps extends Readonly<{
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  color?: string;
  valueFormatter?: (value: number) => string;
}> {}

/**
 * Generic single-series trend chart card, styled through this app's theme
 * CSS variables so it matches light/dark mode automatically. Feed it any
 * `{label, value}[]` (e.g. a period label paired with a metric) — nothing
 * here is tied to any particular feature.
 */
export function LineChartCard(props: LineChartCardProps) {
  return (
    <ErrorBoundary boundaryName="line-chart-card" fallback={renderWidgetErrorFallback}>
      <LineChartCardInner {...props} />
    </ErrorBoundary>
  );
}

function LineChartCardInner({
  title,
  data,
  emptyLabel,
  color = 'var(--primary)',
  valueFormatter,
}: LineChartCardProps) {
  return (
    <div className="panel">
      <h3 className="card-title mb-3">{title}</h3>
      {data.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {emptyLabel}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              width={32}
            />
            <Tooltip
              formatter={(value) =>
                valueFormatter && typeof value === 'number' ? valueFormatter(value) : value
              }
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-primary)',
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, fill: color }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
