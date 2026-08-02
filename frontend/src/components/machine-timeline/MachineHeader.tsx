'use client';

import Link from 'next/link';
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  CpuChipIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCircleIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LiveStatusBadge from '@/components/device-monitoring/LiveStatusBadge';
import MachineHealthBadge from '@/components/predictive-maintenance/MachineHealthBadge';
import { useAuth } from '@/contexts/AuthContext';
import { useLiveMonitoring } from '@/hooks/useLiveMonitoring';
import { usePredictiveHealth } from '@/hooks/usePredictiveHealth';
import type { MachineTimelineSummary } from './types';

const STATUS_BADGE_CLASSES: Record<string, string> = {
  operational: 'bg-green-100 text-green-800 border-green-200',
  maintenance: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  out_of_service: 'bg-red-100 text-red-800 border-red-200',
  retired: 'bg-gray-100 text-gray-600 border-gray-200',
};
const DEFAULT_STATUS_BADGE_CLASS = 'bg-gray-100 text-gray-600 border-gray-200';

interface MachineHeaderProps {
  machineId: string;
  machine: MachineTimelineSummary['machine'] | undefined;
  stats: MachineTimelineSummary['stats'] | undefined;
  loading: boolean;
}

export default function MachineHeader({ machineId, machine, stats, loading }: MachineHeaderProps) {
  const t = useTranslations('machineTimeline');
  const locale = useLocale();
  const { user } = useAuth();
  const { statusByMachine, subscribeToMachine } = useLiveMonitoring();
  const { healthByMachine } = usePredictiveHealth();

  if (loading && !machine) {
    return (
      <section className="rounded-2xl border border-(--border) bg-(--surface) p-4 shadow-(--shadow-sm) sm:p-5">
        <div className="h-44 animate-pulse rounded-xl bg-(--surface-secondary)" />
      </section>
    );
  }

  if (!machine) return null;

  const statusClass = STATUS_BADGE_CLASSES[machine.status] ?? DEFAULT_STATUS_BADGE_CLASS;
  const label = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  const machineDetails = [machine.type?.name, machine.fabricant, machine.model].filter(Boolean).join(' / ');
  const quickActions =
    user?.role === 'technician'
      ? [{ href: `/${locale}/technician/work-orders`, label: label('actions.workOrders', 'Work orders'), icon: ClipboardDocumentListIcon }]
      : user?.role === 'operator'
        ? [
            { href: `/${locale}/operator/preventive`, label: label('filters.categories.preventive', 'Preventive'), icon: WrenchScrewdriverIcon },
            { href: `/${locale}/operator/corrective`, label: label('filters.categories.corrective', 'Corrective'), icon: ClipboardDocumentListIcon },
          ]
        : user?.role === 'admin'
          ? [
              { href: `/${locale}/work-orders`, label: label('actions.workOrders', 'Work orders'), icon: ClipboardDocumentListIcon },
              { href: `/${locale}/maintenance-plans`, label: label('filters.categories.plans', 'Plans'), icon: CalendarDaysIcon },
            ]
          : [];

  return (
    <section className="overflow-hidden rounded-2xl border border-(--border) bg-(--surface) shadow-(--shadow-sm)">
      <div className="grid gap-0 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <div className="relative min-h-56 border-b border-(--border) bg-(--surface-secondary) p-4 lg:border-b-0 lg:border-e">
          <Link
            href={`/${locale}/machines`}
            className="absolute start-4 top-4 z-10 inline-flex min-h-11 items-center gap-2 rounded-full border border-(--border) bg-(--surface)/90 px-3 text-sm font-semibold text-(--text-primary) shadow-(--shadow-sm) transition hover:border-(--border-hover) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)"
          >
            <ArrowLeftIcon className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            <span>{label('actions.back', 'Back')}</span>
          </Link>
          <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-(--border) bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.16),transparent_34%),linear-gradient(145deg,var(--surface),var(--surface-secondary))]">
            <div className="flex h-28 w-28 items-center justify-center rounded-2xl border border-(--border) bg-(--surface) shadow-(--shadow-sm)">
              <CpuChipIcon className="h-14 w-14 text-(--primary)" aria-hidden="true" />
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${statusClass}`}
                >
                  <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />
                  {t.has(`status.${machine.status}`) ? t(`status.${machine.status}`) : machine.status}
                </span>
                <LiveStatusBadge
                  machineId={machineId}
                  status={statusByMachine[machineId]}
                  onSubscribe={subscribeToMachine}
                />
                <MachineHealthBadge status={healthByMachine[machineId]} />
              </div>

              <h1 className="text-3xl font-bold leading-tight text-(--text-primary) sm:text-4xl">
                {machine.machineId}
              </h1>
              <p className="mt-2 text-base leading-7 text-(--text-secondary)">
                {machineDetails || t('header.noDetails')}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-(--text-secondary)">
                {machine.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPinIcon className="h-4 w-4" aria-hidden="true" />
                    {machine.location}
                  </span>
                )}
                {machine.serialNo && <span className="font-mono">{machine.serialNo}</span>}
              </div>
            </div>

            {quickActions.length > 0 && (
              <div className="flex flex-wrap gap-2 xl:justify-end">
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link
                      key={action.href}
                      href={action.href}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-(--border) bg-(--surface-secondary) px-3 text-sm font-semibold text-(--text-primary) transition hover:border-(--border-hover) hover:bg-(--surface) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)"
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {action.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HeaderFact
              label={t('header.lastMaintenance')}
              value={
                stats?.lastMaintenanceAt
                  ? new Date(stats.lastMaintenanceAt).toLocaleDateString(locale)
                  : t('header.none')
              }
              icon={WrenchScrewdriverIcon}
            />
            <HeaderFact
              label={t('header.nextMaintenance')}
              value={
                stats?.nextMaintenanceAt
                  ? new Date(stats.nextMaintenanceAt).toLocaleDateString(locale)
                  : t('header.none')
              }
              icon={CalendarDaysIcon}
            />
            <HeaderFact
              label={t('header.openWorkOrders')}
              value={String(stats?.openWorkOrders ?? 0)}
              icon={ClipboardDocumentListIcon}
            />
            <HeaderFact
              label={t('header.machineAge')}
              value={machine.ageDays !== null ? t('header.ageDays', { days: machine.ageDays }) : t('header.none')}
              icon={SparklesIcon}
            />
          </dl>

          <div className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-(--border) bg-(--surface-secondary) px-3 text-sm text-(--text-secondary)">
            <UserCircleIcon className="h-4 w-4" aria-hidden="true" />
            <span>{label('header.currentTechnician', 'Current technician')}</span>
            <span className="font-semibold text-(--text-primary)">{t('header.none')}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeaderFact({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="rounded-xl border border-(--border) bg-(--surface-secondary) p-3">
      <dt className="flex items-center gap-2 text-sm font-medium text-(--text-secondary)">
        <Icon className="h-4 w-4 text-(--primary)" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1 text-lg font-bold leading-snug text-(--text-primary)">{value}</dd>
    </div>
  );
}
