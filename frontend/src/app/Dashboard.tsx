'use client';

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

import { useAuth } from "@/contexts/AuthContext";
import { useDashboardStatistics } from "@/hooks/useDashboardStatistics";
import { useTranslations } from "next-intl";

import {
  WrenchScrewdriverIcon,
  UsersIcon,
  ClipboardDocumentListIcon,
  CheckCircleIcon,
  CommandLineIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { apiService } from "@/services/api";
import ProfileAvatar from "@/components/ProfileAvatar";
import { translateEnumValue } from "@/services/enumTranslations";

type MinimalUser = {
  _id?: string;
  is_active?: boolean;
  nom_complet?: string;
  photo?: string;
};

type WorkOrder = {
  _id?: string;
  title?: string;
  description?: string;
  status?: string;
};

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

  // These two lists are for on-screen display only (a handful of avatars,
  // a short "recent work orders" feed) — never used to derive a count or
  // percentage. Every KPI number on this page comes from `statistics`
  // (`GET /dashboard/admin`), computed by the shared `KpiService`.
  const [recentWorkOrders, setRecentWorkOrders] = useState<WorkOrder[]>([]);
  const [activeUsersPreview, setActiveUsersPreview] = useState<MinimalUser[]>([]);

  useEffect(() => {
    if (authLoading || user?.role !== 'admin') return;

    (async () => {
      try {
        const [workOrdersRes, usersRes] = await Promise.all([
          apiService.getWorkOrders({ page: 1, limit: 5 }),
          apiService.getUsers({ page: 1, limit: 5 }),
        ]);
        setRecentWorkOrders(normalizeArray<WorkOrder>(workOrdersRes.data));
        setActiveUsersPreview(
          normalizeArray<MinimalUser>(usersRes.data).filter((u) => u.is_active),
        );
      } catch (error) {
        console.error('Error loading dashboard preview lists:', error);
      }
    })();
  }, [authLoading, user]);

  const getStatusBadge = (status: string) => {
    const statusClasses: Record<string, string> = {
      pending: 'status-pending',
      in_progress: 'status-active',
      completed: 'status-completed',
      validated: 'status-completed',
      cancelled: 'status-pending',
    };

    return statusClasses[status] || 'status-pending';
  };

  const workOrders = statistics?.workOrders;
  const totalCount = workOrders?.totalCount ?? 0;
  const overdueCount = workOrders?.overdueCount ?? 0;
  const dueTodayCount = workOrders?.dueTodayCount ?? 0;
  const waitingValidationCount = workOrders?.waitingValidationCount ?? 0;
  const completedTodayCount = workOrders?.completedTodayCount ?? 0;
  const openMaintenanceCount = overdueCount + dueTodayCount;

  const availabilityPercent = statistics?.mttrMtbf.availabilityPercent ?? 0;
  const complianceRate = statistics?.preventiveCompliance.ratePercent ?? 0;

  const distributionBar = (count: number) =>
    totalCount > 0 ? `${(count / totalCount) * 100}%` : '0%';

  const dashboardTitle = tAdmin('title');

  return (
    <ProtectedRoute requiredRole="admin">
      <DashboardLayout title={dashboardTitle}>
        <div className="bento-grid">
          {/* Search Bar */}
          <div className="col-span-full mb-6 bento-item">
            <div className="search-bar">
              <input
                type="text"
                placeholder={tAdmin("searchPlaceholder")}
                className="search-input"
              />
              <div className="search-shortcut">
                <CommandLineIcon className="w-3 h-3 inline mr-1" />
                F
              </div>
            </div>
          </div>

          {/* Stats Cards Row */}
          <div className="stats-grid">
            <div className="featured-card">
              <div className="card-title">{tAdmin("stats.totalMachines")}</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-4xl font-bold mb-2">{statistics?.totals.machines ?? 0}</div>
                  <div className="text-blue-200 text-sm">{tAdmin("stats.fleetTotal")}</div>
                </div>
                <WrenchScrewdriverIcon className="w-16 h-16 text-blue-200 opacity-80" />
              </div>
            </div>
            <div className="panel group">
              <div className="card-title">{tAdmin("stats.totalUsers")}</div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="text-3xl font-bold text-slate-800">{statistics?.totals.users ?? 0}</div>
                  <div className="mini-avatar-stack" style={{ gap: '0.25rem' }}>
                    {activeUsersPreview.slice(0, 3).map((u, index: number) => (
                      <div key={u._id || index} className="mini-avatar" style={{ zIndex: 30 - index }}>
                        <ProfileAvatar name={u.nom_complet} photo={u.photo} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
                <UsersIcon className="w-12 h-12 text-blue-600 card-icon" />
              </div>
            </div>
            <div className="panel group">
              <div className="card-title flex items-center">
                <div className="pulse-dot"></div>
                {tAdmin("stats.openMaintenance")}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-800 mb-1">{openMaintenanceCount}</div>
                  <div className="text-amber-600 text-sm">
                    {tAdmin("stats.openMaintenanceHint", { overdue: overdueCount, dueToday: dueTodayCount })}
                  </div>
                </div>
                <ClipboardDocumentListIcon className="w-12 h-12 text-amber-600 card-icon" />
              </div>
            </div>
            <div className="panel group relative">
              <div className="success-badge">
                <CheckCircleIcon className="w-3 h-3 text-white" />
              </div>
              <div className="card-title">{tAdmin("stats.completedToday")}</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-800 mb-1">{completedTodayCount}</div>
                  <div className="text-emerald-600 text-sm">{tAdmin("stats.outOfTotal", { total: totalCount })}</div>
                </div>
                <CheckCircleIcon className="w-12 h-12 text-emerald-600 card-icon" />
              </div>
            </div>
          </div>

          <div className="bento-item panel md:col-span-2">
            <div className="card-title">{tAdmin("workOrders.recent")}</div>
            <div className="space-y-3">
              {recentWorkOrders.slice(0, 5).map((wo) => (
                <div key={wo._id} className="flex min-w-0 items-center justify-between gap-3 border-b pb-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" title={wo.title || wo.description || ''}>
                      {wo.title || wo.description}
                    </div>
                    <div className="truncate text-xs text-slate-500" title={wo.status}>
                      {translateEnumValue(tEnums, 'workOrderStatuses', wo.status)}
                    </div>
                  </div>
                  <div className={`status-badge ${getStatusBadge(wo.status ?? 'pending')}`}>
                    {translateEnumValue(tEnums, 'workOrderStatuses', wo.status)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bento-item panel">
            <div className="card-title">{tAdmin("machines.availability")}</div>
            <div className="text-5xl font-bold text-green-600">{availabilityPercent}%</div>
            <div className="mt-4">
              <div className="w-full h-3 bg-slate-200 rounded-full">
                <div className="h-3 bg-green-500 rounded-full" style={{ width: `${availabilityPercent}%` }} />
              </div>
            </div>
            <div className="text-sm text-slate-500 mt-3">{tAdmin("machines.availabilityHint")}</div>
          </div>

          <div className="bento-item panel">
            <div className="card-title">{tAdmin("workOrders.completionRate")}</div>
            <div className="text-5xl font-bold text-blue-600">{complianceRate}%</div>
            <div className="mt-4">
              <div className="w-full h-3 bg-slate-200 rounded-full">
                <div className="h-3 bg-blue-500 rounded-full" style={{ width: `${complianceRate}%` }} />
              </div>
            </div>
            <div className="text-sm text-slate-500 mt-3">{tAdmin("workOrders.completionRateHint")}</div>
          </div>

          <div className="bento-item panel md:col-span-2">
            <div className="card-title">{tAdmin("workOrders.distribution")}</div>
            <div className="space-y-5">
              <div>
                <div className="flex justify-between mb-2">
                  <span>{tAdmin("workOrders.overdue")}</span>
                  <span>{overdueCount}</span>
                </div>
                <div className="w-full bg-slate-200 h-3 rounded-full">
                  <div className="bg-red-500 h-3 rounded-full" style={{ width: distributionBar(overdueCount) }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span>{tAdmin("workOrders.dueToday")}</span>
                  <span>{dueTodayCount}</span>
                </div>
                <div className="w-full bg-slate-200 h-3 rounded-full">
                  <div className="bg-amber-500 h-3 rounded-full" style={{ width: distributionBar(dueTodayCount) }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span>{tAdmin("workOrders.waitingValidation")}</span>
                  <span>{waitingValidationCount}</span>
                </div>
                <div className="w-full bg-slate-200 h-3 rounded-full">
                  <div className="bg-purple-500 h-3 rounded-full" style={{ width: distributionBar(waitingValidationCount) }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span>{tAdmin("workOrders.completedTodayLabel")}</span>
                  <span>{completedTodayCount}</span>
                </div>
                <div className="w-full bg-slate-200 h-3 rounded-full">
                  <div className="bg-green-500 h-3 rounded-full" style={{ width: distributionBar(completedTodayCount) }} />
                </div>
              </div>
            </div>
          </div>

          <div className="bento-item panel md:col-span-2">
            <div className="card-title">{tAdmin("quickKpis.title")}</div>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.machineAvailability")}</span>
                <span>{availabilityPercent}%</span>
              </div>
              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.completionRate")}</span>
                <span>{complianceRate}%</span>
              </div>
              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.stockAlerts")}</span>
                <span className={statistics && statistics.stockAlerts.count > 0 ? 'text-amber-600 font-semibold' : ''}>
                  {statistics?.stockAlerts.count ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.correctiveResponseTime")}</span>
                <span>{tAdmin("quickKpis.hoursValue", { hours: statistics?.correctiveResponseTime.averageResponseHours ?? 0 })}</span>
              </div>
              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.mttr")}</span>
                <span>{tAdmin("quickKpis.hoursValue", { hours: statistics?.mttrMtbf.mttrHours ?? 0 })}</span>
              </div>
              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.mtbf")}</span>
                <span>{tAdmin("quickKpis.hoursValue", { hours: statistics?.mttrMtbf.mtbfHours ?? 0 })}</span>
              </div>
            </div>
          </div>

          {statistics && statistics.stockAlerts.count > 0 && (
            <div className="col-span-full bento-item panel border border-amber-200 bg-amber-50">
              <div className="card-title flex items-center gap-2 text-amber-800">
                <ExclamationTriangleIcon className="w-5 h-5" />
                {tAdmin("stockAlerts.title", { default: "Stock Alerts" })}
              </div>
              <div className="space-y-2 mt-2">
                {statistics.stockAlerts.items.slice(0, 5).map((item) => (
                  <div key={item.stockId} className="flex items-center justify-between text-sm">
                    <span>{item.partLabel || item.stockCode}</span>
                    <span className="text-amber-700 font-medium">
                      {tAdmin("stockAlerts.availableOf", { available: item.available, threshold: item.threshold })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {statistics && statistics.workload.length > 0 && (
            <div className="col-span-full bento-item panel">
              <div className="card-title">{tAdmin("workload.title")}</div>
              <div className="space-y-3 mt-2">
                {statistics.workload.slice(0, 6).map((entry) => (
                  <div key={entry.technicianId}>
                    <div className="flex justify-between mb-1 text-sm">
                      <span>{entry.name}</span>
                      <span>{tAdmin("workload.openCount", { count: entry.openCount })}</span>
                    </div>
                    <div className="w-full bg-slate-200 h-2 rounded-full">
                      <div
                        className="bg-indigo-500 h-2 rounded-full"
                        style={{
                          width: `${Math.min(100, (entry.openCount / statistics.workload[0].openCount) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
