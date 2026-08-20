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

type LineChartCardProps = Readonly<{
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  color?: string;
  valueFormatter?: ChartValueFormatter;
}>;

/**
 * Generic single-series trend chart card, styled through this app's theme
 * CSS variables so it matches light/dark mode automatically. Feed it any
 * `{label, value}[]` (e.g. a period label paired with a metric) — nothing
 * here is tied to any particular feature.
 */
export function LineChartCard(props: LineChartCardProps) {
  const { title, data, emptyLabel, color = 'var(--primary)', valueFormatter } = props;

  return (
    <ChartCardShell
      boundaryName="line-chart-card"
      title={title}
      data={data}
      emptyLabel={emptyLabel}
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={CHART_CARD_MARGIN}>
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
    </ChartCardShell>
  );
}
