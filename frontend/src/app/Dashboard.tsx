'use client';

import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

import { useAuth } from "@/contexts/AuthContext";
import { useDashboardStatistics } from "@/hooks/useDashboardStatistics";
import { useTranslations } from "next-intl";
import {
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  HeartIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';

import { Link } from '@/i18n/navigation';
import { apiService } from "@/services/api";
import { translateEnumValue } from "@/services/enumTranslations";
import { useLiveMonitoring } from "@/hooks/useLiveMonitoring";
import { usePredictiveHealth } from "@/hooks/usePredictiveHealth";

type Machine = {
  _id?: string;
  machine_id?: string;
  serial_no?: string;
  reference?: string;
  fabricant?: string;
  model?: string;
  status?: string;
};

type WorkOrder = {
  _id?: string;
  ot_id?: string;
  description?: string;
  status?: string;
  machine_id?: string | { _id?: string; machine_id?: string; reference?: string };
  date_created?: string;
  date_start?: string;
};

type OverviewCard = [
  label: string,
  value: string,
  href: string,
  accentClass: string,
  valueClass: string,
  Icon: ComponentType<SVGProps<SVGSVGElement>>,
];

function normalizeArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const items = (value as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

export default function Dashboard() {
  const tAdmin = useTranslations("dashboard.admin");
  const tEnums = useTranslations("common.enums");

  const { user, isLoading: authLoading } = useAuth();
  const { statistics } = useDashboardStatistics();
  const { statusByMachine } = useLiveMonitoring();
  const { healthByMachine } = usePredictiveHealth();
  const [recentWorkOrders, setRecentWorkOrders] = useState<WorkOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);

  useEffect(() => {
    if (authLoading || user?.role !== 'admin') return;

    (async () => {
      try {
        const [workOrdersRes, machinesRes] = await Promise.all([
          apiService.getWorkOrders({ page: 1, limit: 5 }),
          apiService.getMachines({ page: 1, limit: 200 }),
        ]);
        setRecentWorkOrders(normalizeArray<WorkOrder>(workOrdersRes.data));
        setMachines(normalizeArray<Machine>(machinesRes.data));
      } catch (error) {
        console.error('Error loading dashboard preview lists:', error);
      }
    })();
  }, [authLoading, user]);

  const workOrders = statistics?.workOrders;
  const overdueCount = workOrders?.overdueCount ?? 0;
  const dueTodayCount = workOrders?.dueTodayCount ?? 0;
  const waitingValidationCount = workOrders?.waitingValidationCount ?? 0;
  const completedTodayCount = workOrders?.completedTodayCount ?? 0;
  const openCount = workOrders?.openCount ?? 0;
  const inProgressCount = workOrders?.inProgressCount ?? 0;
  const machineCount = statistics?.totals.machines ?? machines.length;
  const userCount = statistics?.totals.users ?? 0;
  const availabilityPercent = statistics?.mttrMtbf.availabilityPercent ?? 0;
  const complianceRatePercent = statistics?.preventiveCompliance.ratePercent ?? 0;
  const stockAlertsCount = statistics?.stockAlerts.count ?? 0;
  const averageResponseHours = statistics?.correctiveResponseTime.averageResponseHours ?? 0;
  const mttrHours = statistics?.mttrMtbf.mttrHours ?? 0;
  const mtbfHours = statistics?.mttrMtbf.mtbfHours ?? 0;
  const healthyMachineCount = machines.filter((machine) => {
    const health = machine._id ? healthByMachine[machine._id] : undefined;
    return !health || health.riskLevel === 'low' || health.riskLevel === 'insufficient_data';
  }).length;
  const criticalAlerts = Object.values(statusByMachine).reduce(
    (total, status) => total + status.activeAlarmCount,
    0,
  ) + Object.values(healthByMachine).filter((health) => health.riskLevel === 'critical').length;
  const machineStatusCounts = machines.reduce<Record<string, number>>((counts, machine) => {
    const key = machine.status?.toLowerCase() || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const attentionMachines = machines
    .map((machine) => ({ machine, health: machine._id ? healthByMachine[machine._id] : undefined }))
    .filter(({ machine, health }) => health?.riskLevel === 'high' || health?.riskLevel === 'critical' || (machine._id ? (statusByMachine[machine._id]?.activeAlarmCount ?? 0) > 0 : false))
    .sort((left, right) => (left.health?.healthScore ?? 100) - (right.health?.healthScore ?? 100))
    .slice(0, 3);
  const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const activityDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const dashboardTitle = tAdmin('title');
  const overviewCards: OverviewCard[] = [
    ['machineHealth', `${healthyMachineCount} / ${machineCount}`, '/machines', 'border-s-4 border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20', 'text-emerald-700 dark:text-emerald-300', HeartIcon],
    ['openWorkOrders', String(openCount), '/work-orders', 'border-s-4 border-blue-500 bg-blue-50/60 dark:bg-blue-950/20', 'text-blue-700 dark:text-blue-300', ClipboardDocumentListIcon],
    ['criticalAlerts', String(criticalAlerts), '/pannes', 'border-s-4 border-red-500 bg-red-50/60 dark:bg-red-950/20', 'text-red-700 dark:text-red-300', ExclamationTriangleIcon],
    ['maintenanceDue', String(overdueCount + dueTodayCount), '/work-orders', 'border-s-4 border-amber-500 bg-amber-50/60 dark:bg-amber-950/20', 'text-amber-700 dark:text-amber-300', WrenchScrewdriverIcon],
  ];
  const kpiCards: OverviewCard[] = [
    ['fleetTotal', String(statistics?.totals.machines ?? 0), '/machines', 'border-s-4 border-cyan-500 bg-cyan-50/60 dark:bg-cyan-950/20', 'text-cyan-700 dark:text-cyan-300', WrenchScrewdriverIcon],
    ['totalUsers', String(userCount), '/users', 'border-s-4 border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20', 'text-indigo-700 dark:text-indigo-300', HeartIcon],
    ['openMaintenance', String(workOrders?.overdueCount ?? 0), '/work-orders', 'border-s-4 border-amber-500 bg-amber-50/60 dark:bg-amber-950/20', 'text-amber-700 dark:text-amber-300', ClipboardDocumentListIcon],
    ['completedToday', String(workOrders?.completedTodayCount ?? 0), '/work-orders', 'border-s-4 border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20', 'text-emerald-700 dark:text-emerald-300', CheckCircleIcon],
  ];
  const quickKpis: Array<[string, string]> = [
    ['stockAlerts', String(stockAlertsCount)],
    ['correctiveResponseTime', tAdmin('quickKpis.hoursValue', { hours: averageResponseHours.toFixed(1) })],
    ['mttr', tAdmin('quickKpis.hoursValue', { hours: mttrHours.toFixed(1) })],
    ['mtbf', tAdmin('quickKpis.hoursValue', { hours: mtbfHours.toFixed(1) })],
  ];
  const maintenanceActivityRows: Array<[string, number, string]> = [
    ['open', openCount, 'text-blue-600'],
    ['inProgress', inProgressCount, 'text-amber-600'],
    ['waitingValidation', waitingValidationCount, 'text-orange-600'],
    ['completedToday', completedTodayCount, 'text-emerald-600'],
  ];

  return (
    <ProtectedRoute requiredRole="admin">
      <DashboardLayout title={dashboardTitle}>
        <div className="bento-grid">
          <div className="col-span-full mb-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">{tAdmin("description")}</p>
          </div>
          <div className="stats-grid">
            {overviewCards.map(([label, value, href, accentClass, valueClass, Icon]) => (
              <Link key={label} href={href} className={`panel block p-6 no-underline text-inherit ${accentClass} focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2`}>
                <div className="card-title flex items-center gap-2"><Icon className={`h-5 w-5 ${valueClass}`} />{tAdmin(`overview.${label}`)}</div>
                <div className={`text-3xl font-bold ${valueClass}`}>{value}</div>
              </Link>
            ))}
          </div>
          <div className="stats-grid">
            {kpiCards.map(([label, value, href, accentClass, valueClass, Icon]) => (
              <Link key={label} href={href} className={`panel block p-5 no-underline text-inherit ${accentClass} focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2`}>
                <div className="card-title flex items-center gap-2"><Icon className={`h-5 w-5 ${valueClass}`} />{tAdmin(`stats.${label}`)}</div>
                <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
                {label === 'openMaintenance' && (
                  <p className="mt-2 text-xs text-slate-500">
                    {tAdmin('stats.openMaintenanceHint', { overdue: workOrders?.overdueCount ?? 0, dueToday: workOrders?.dueTodayCount ?? 0 })}
                  </p>
                )}
                {label === 'completedToday' && (
                  <p className="mt-2 text-xs text-slate-500">
                    {tAdmin('stats.outOfTotal', { total: workOrders?.totalCount ?? 0 })}
                  </p>
                )}
              </Link>
            ))}
          </div>
          <section className="col-span-full panel p-6">
            <h2 className="mb-4 text-lg font-semibold">{tAdmin('quickKpis.title')}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {quickKpis.map(([label, value]) => (
                <div key={label} className="rounded-md border border-slate-200 p-3">
                  <div className="text-sm text-slate-500">{tAdmin(`quickKpis.${label}`)}</div>
                  <div className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 p-3">
                <span className="text-slate-500">{tAdmin('machines.availabilityHint')}</span>
                <strong className="ms-2">{availabilityPercent}%</strong>
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <span className="text-slate-500">{tAdmin('workOrders.completionRateHint')}</span>
                <strong className="ms-2">{complianceRatePercent}%</strong>
              </div>
            </div>
          </section>
          {statistics && statistics.stockAlerts.count > 0 && (
            <section className="bento-item panel p-6 md:col-span-2">
              <h2 className="mb-4 text-lg font-semibold">{tAdmin('stockAlerts.title')}</h2>
              <div className="space-y-3">
                {statistics.stockAlerts.items.slice(0, 5).map((item) => (
                  <div key={item.stockId} className="flex justify-between gap-3 border-t pt-3 text-sm">
                    <span>{item.partLabel || item.stockCode}</span>
                    <strong>{tAdmin('stockAlerts.availableOf', { available: item.available, threshold: item.threshold })}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          {statistics && statistics.workload.length > 0 && (
            <section className="bento-item panel p-6 md:col-span-2">
              <h2 className="mb-4 text-lg font-semibold">{tAdmin('workload.title')}</h2>
              <div className="space-y-3">
                {statistics.workload.slice(0, 6).map((entry) => (
                  <div key={entry.technicianId} className="flex justify-between gap-3 border-t pt-3 text-sm">
                    <span>{entry.name}</span>
                    <strong>{tAdmin('workload.openCount', { count: entry.openCount })}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="col-span-full panel p-6">
            <div className="mb-4 flex items-center justify-between gap-4"><h2 className="flex items-center gap-2 text-lg font-semibold"><ExclamationTriangleIcon className="h-5 w-5 text-amber-600" />{tAdmin('overview.attention')}</h2><span className="text-sm text-slate-500">{todayLabel}</span></div>
            <div className="space-y-3">{attentionMachines.length ? attentionMachines.map(({ machine, health }) => <div key={machine._id} className={`flex flex-wrap items-center justify-between gap-3 border-s-4 border-t px-3 pt-3 ${health?.riskLevel === 'critical' ? 'border-s-red-500' : 'border-s-amber-500'}`}><div><div className="font-semibold">{machine.reference || machine.machine_id || machine.serial_no}</div><div className={`text-sm ${health?.riskLevel === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>{health ? tAdmin('overview.healthValue', { value: Math.round(health.healthScore) }) : tAdmin('overview.activeAlert')}</div></div><Link href={`/machines/${machine._id}`} className="text-sm font-medium text-blue-600">{tAdmin('overview.viewMachine')}</Link></div>) : <p className="text-sm text-slate-500">{tAdmin('overview.noAttention')}</p>}</div>
          </section>
          <section className="bento-item panel p-6 md:col-span-2"><h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><ClipboardDocumentListIcon className="h-5 w-5 text-blue-600" />{tAdmin('overview.maintenanceActivity')}</h2>{maintenanceActivityRows.map(([label, value, colorClass]) => <div key={label} className="flex justify-between border-t py-2 text-sm"><span>{tAdmin(`overview.${label}`)}</span><strong className={colorClass}>{value}</strong></div>)}</section>
          <section className="bento-item panel p-6 md:col-span-2"><h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><WrenchScrewdriverIcon className="h-5 w-5 text-emerald-600" />{tAdmin('overview.factoryStatus')}</h2>{[['running', machineStatusCounts.operational ?? machineStatusCounts.running ?? 0], ['maintenance', machineStatusCounts.maintenance ?? 0], ['stopped', machineStatusCounts.stopped ?? machineStatusCounts.out_of_service ?? 0]].map(([label, value]) => <div key={label} className="flex justify-between border-t py-2 text-sm"><span>{tAdmin(`overview.${label}`)}</span><strong>{value}</strong></div>)}</section>
          <section className="col-span-full panel p-6"><h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><CheckCircleIcon className="h-5 w-5 text-blue-600" />{tAdmin('overview.recentActivity')}</h2><div className="space-y-3">{recentWorkOrders.map((wo) => <div key={wo._id} className="flex gap-4 border-t pt-3 text-sm"><time className="text-slate-500">{wo.date_start || wo.date_created ? activityDateFormatter.format(new Date(wo.date_start || wo.date_created!)) : '--:--'}</time><span>{wo.ot_id || wo.description || tAdmin('overview.workOrder')}</span>{wo.status && <span className="text-slate-500">{translateEnumValue(tEnums, 'workOrderStatuses', wo.status)}</span>}</div>)}</div></section>

        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
