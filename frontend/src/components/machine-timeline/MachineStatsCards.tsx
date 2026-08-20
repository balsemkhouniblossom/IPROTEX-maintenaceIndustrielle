'use client';

import {
  ClockIcon,
  Cog6ToothIcon,
  CubeIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import { useTranslations } from 'next-intl';
import type { MachineTimelineSummary } from './types';

type MachineStatsCardsProps = Readonly<{
  stats: MachineTimelineSummary['stats'] | undefined;
  loading: boolean;
}>;

export default function MachineStatsCards({ stats, loading }: MachineStatsCardsProps) {
  const t = useTranslations('machineTimeline');
  const label = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);

  const cards: Array<{
    label: string;
    value: string | number;
    context: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
  }> = [
    {
      label: t('stats.totalInterventions'),
      value: stats?.totalInterventions ?? 0,
      context: label('statsContext.totalInterventions', 'All work orders'),
      icon: WrenchScrewdriverIcon,
    },
    {
      label: t('stats.preventiveCompleted'),
      value: stats?.preventiveCompleted ?? 0,
      context: label('statsContext.preventiveCompleted', 'Completed preventive WOs'),
      icon: ShieldCheckIcon,
    },
    {
      label: t('stats.correctiveCompleted'),
      value: stats?.correctiveCompleted ?? 0,
      context: label('statsContext.correctiveCompleted', 'Completed corrective WOs'),
      icon: Cog6ToothIcon,
    },
    {
      label: t('stats.openWorkOrders'),
      value: stats?.openWorkOrders ?? 0,
      context: label('statsContext.openWorkOrders', 'Currently active'),
      icon: ClockIcon,
    },
    {
      label: t('stats.closedWorkOrders'),
      value: stats?.closedWorkOrders ?? 0,
      context: label('statsContext.closedWorkOrders', 'Closed or archived'),
      icon: LockClosedIcon,
    },
    {
      label: t('stats.downtimeHours'),
      value: stats ? stats.downtimeHours.toFixed(1) : '0.0',
      context: label('statsContext.downtimeHours', 'Start to end duration'),
      icon: ClockIcon,
    },
    {
      label: t('stats.averageRepairTime'),
      value: stats?.averageRepairTimeHours != null ? stats.averageRepairTimeHours.toFixed(1) : t('header.none'),
      context: label('statsContext.averageRepairTime', 'Across timed work orders'),
      icon: Cog6ToothIcon,
    },
    {
      label: t('stats.partsConsumed'),
      value: stats?.partsConsumed ?? 0,
      context: label('statsContext.partsConsumed', 'Consumed stock quantity'),
      icon: CubeIcon,
    },
  ];

  if (loading && !stats) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-2xl border border-(--border) bg-(--surface)"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="min-h-28 rounded-2xl border border-(--border) bg-(--surface) p-4 shadow-(--shadow-sm)"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-(--text-secondary)">{card.label}</p>
                <p className="mt-2 text-3xl font-bold leading-none text-(--text-primary)">{card.value}</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-(--border) bg-(--surface-secondary)">
                <Icon className="h-5 w-5 text-(--primary)" aria-hidden="true" />
              </div>
            </div>
            <p className="mt-3 text-sm leading-5 text-(--text-secondary)">{card.context}</p>
          </div>
        );
      })}
    </div>
  );
}
