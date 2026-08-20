'use client';

import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { renderWidgetErrorFallback } from '@/components/WidgetErrorFallback';

export type ChartDatum = Readonly<{
  label: string;
  value: number;
}>;

export type ChartValueFormatter = (value: number) => string;

export const CHART_CARD_MARGIN = { top: 4, right: 8, left: 0, bottom: 4 };
export const CHART_AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: 12 };
export const CHART_AXIS_LINE = { stroke: 'var(--border)' };
export const CHART_TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-primary)',
};

export function formatChartTooltipValue(
  value: unknown,
  valueFormatter?: ChartValueFormatter,
): string | number {
  if (valueFormatter && typeof value === 'number') return valueFormatter(value);
  if (typeof value === 'string' || typeof value === 'number') return value;
  return '';
}

type ChartCardShellProps = Readonly<{
  boundaryName: string;
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  children: ReactNode;
}>;

export function ChartCardShell({
  boundaryName,
  title,
  data,
  emptyLabel,
  children,
}: ChartCardShellProps) {
  return (
    <ErrorBoundary boundaryName={boundaryName} fallback={renderWidgetErrorFallback}>
      <div className="panel">
        <h3 className="card-title mb-3">{title}</h3>
        {data.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {emptyLabel}
          </p>
        ) : (
          children
        )}
      </div>
    </ErrorBoundary>
  );
}
