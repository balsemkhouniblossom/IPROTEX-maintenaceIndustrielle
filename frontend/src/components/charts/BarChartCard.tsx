'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
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

interface BarChartCardProps extends Readonly<{
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  color?: string;
  valueFormatter?: (value: number) => string;
}> {}

/**
 * Generic labeled-bar chart card, styled through this app's theme CSS
 * variables (not Tailwind `dark:` classes, which this codebase doesn't
 * use) so it matches light/dark mode automatically. Feed it any
 * `{label, value}[]` — nothing here is tied to any particular feature.
 */
export function BarChartCard(props: BarChartCardProps) {
  return (
    <ErrorBoundary boundaryName="bar-chart-card" fallback={renderWidgetErrorFallback}>
      <BarChartCardInner {...props} />
    </ErrorBoundary>
  );
}

function BarChartCardInner({
  title,
  data,
  emptyLabel,
  color = 'var(--primary)',
  valueFormatter,
}: BarChartCardProps) {
  return (
    <div className="panel">
      <h3 className="card-title mb-3">{title}</h3>
      {data.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {emptyLabel}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
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
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
