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
import {
  CHART_AXIS_LINE,
  CHART_AXIS_TICK,
  CHART_CARD_MARGIN,
  CHART_TOOLTIP_STYLE,
  ChartCardShell,
  formatChartTooltipValue,
  type ChartDatum,
  type ChartValueFormatter,
} from './ChartCardShell';

export type { ChartDatum } from './ChartCardShell';

type BarChartCardProps = Readonly<{
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  color?: string;
  valueFormatter?: ChartValueFormatter;
}>;

/**
 * Generic labeled-bar chart card, styled through this app's theme CSS
 * variables (not Tailwind `dark:` classes, which this codebase doesn't
 * use) so it matches light/dark mode automatically. Feed it any
 * `{label, value}[]` — nothing here is tied to any particular feature.
 */
export function BarChartCard(props: BarChartCardProps) {
  const { title, data, emptyLabel, color = 'var(--primary)', valueFormatter } = props;

  return (
    <ChartCardShell
      boundaryName="bar-chart-card"
      title={title}
      data={data}
      emptyLabel={emptyLabel}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={CHART_CARD_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={CHART_AXIS_TICK}
            axisLine={CHART_AXIS_LINE}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={CHART_AXIS_TICK}
            axisLine={CHART_AXIS_LINE}
            tickLine={false}
            width={32}
          />
          <Tooltip
            formatter={(value) => formatChartTooltipValue(value, valueFormatter)}
            contentStyle={CHART_TOOLTIP_STYLE}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCardShell>
  );
}
