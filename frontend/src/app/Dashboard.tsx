'use client';

import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

import { useAuth } from "@/contexts/AuthContext";
import { useDashboardStatistics } from "@/hooks/useDashboardStatistics";
import { useTranslations } from "next-intl";

import {
  WrenchScrewdriverIcon,
  UsersIcon,
  CogIcon,
  ClipboardDocumentListIcon,
  BuildingStorefrontIcon,
  CheckCircleIcon,
  CommandLineIcon,
  CubeIcon
} from '@heroicons/react/24/outline';
import { Link } from '@/i18n/navigation';
import { apiService } from "@/services/api";
import ProfileAvatar from "@/components/ProfileAvatar";
interface DashboardData {
  users: User[];
  machines: Machine[];
  machineTypes: unknown[];
  workOrders: WorkOrder[];
  catalogues: unknown[];
  moduleTypes: unknown[];
  capteurs: unknown[];
}

type MinimalUser = {
  _id?: string;
  is_active?: boolean;
  nom_complet?: string;
  photo?: string;
};

type Machine = {
  _id?: string;
  status?: 'ONLINE' | 'OFFLINE' | 'WARNING' | 'ERROR';
};

type WorkOrder = {
  _id?: string;
  title?: string;
  description?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
};

type User = {
  _id?: string;
  is_active?: boolean;
  nom_complet?: string;
  photo?: string;
};

export default function Dashboard({ locale: propLocale }: { locale?: string }) {
  const tAdmin = useTranslations("dashboard.admin");
  //const tHealth = useTranslations("health");
  const tCommon = useTranslations("common");
  //const tUsers = useTranslations('users');

  const { user, isLoading: authLoading } = useAuth();
  const locale = propLocale || 'en';
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    users: [],
    machines: [],
    machineTypes: [],
    workOrders: [],
    catalogues: [],
    moduleTypes: [],
    capteurs: []
  });

  const normalizeArray = (v: any) =>
    Array.isArray(v) ? v : v?.items ?? [];

  const machines = normalizeArray(dashboardData.machines) as Machine[];
  const workOrders = normalizeArray(dashboardData.workOrders) as WorkOrder[];
  const users = normalizeArray(dashboardData.users) as User[];
  const { statistics } = useDashboardStatistics();

  async function loadDashboardData() {
    try {
      const data = await apiService.getDashboardData();
      setDashboardData(data);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  }

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      return;
    }

    loadDashboardData();
  }, [authLoading, user]);


  const getStatusBadge = (status: string) => {
    const statusClasses = {
      pending: 'status-pending',
      in_progress: 'status-active',
      completed: 'status-completed',
      cancelled: 'status-pending',
    };

    return statusClasses[status as keyof typeof statusClasses] || 'status-pending';
  };



  const totalMachines = machines?.length ?? 0;
  const onlineMachines = machines.filter(m => m?.status === 'ONLINE').length;

  const machineAvailability =
    totalMachines > 0
      ? Number(((onlineMachines / totalMachines) * 100).toFixed(1))
      : 0;

  const totalWorkOrders = workOrders?.length ?? 0;
  const completedWorkOrders = workOrders.filter(wo => (wo?.status ?? '') === 'completed').length;
  const completionRate =
    totalWorkOrders > 0
      ? Number(((completedWorkOrders / totalWorkOrders) * 100).toFixed(1))
      : 0;

  const pendingCount = workOrders.filter(wo => (wo?.status ?? '') === 'pending').length;

  const inProgressCount = workOrders.filter(wo => (wo?.status ?? '') === 'in_progress').length;

  const formatPercentChange = (value: number) =>
    tAdmin("fromLastMonth", { value: value >= 0 ? `+${value}` : `${value}` });


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
                  <div className="text-4xl font-bold mb-2">{statistics?.totalMachines || 0}</div>
                  <div className="text-blue-200 text-sm">
                    {statistics
                      ? formatPercentChange(statistics.machinesPercentageChange)
                      : tAdmin("fromLastMonth", { value: "+12" })}
                  </div>
                </div>
                <WrenchScrewdriverIcon className="w-16 h-16 text-blue-200 opacity-80" />
              </div>
            </div>
            <div className="panel group">
              <div className="card-title">{tAdmin("stats.activeUsers")}</div>
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className="text-3xl font-bold text-slate-800">{statistics?.activeUsers || 0}</div>
                  <div className="mini-avatar-stack" style={{ gap: '0.25rem' }}>
                    {users.filter((u) => u?.is_active === true)
                      .slice(0, 3)
                      .map((u, index: number) => (
                        <div
                          key={(u as MinimalUser)._id || index}
                          className="mini-avatar"
                          style={{ zIndex: 30 - index }}
                        >
                          <ProfileAvatar
                            name={(u as MinimalUser).nom_complet}
                            photo={(u as MinimalUser).photo}
                            size="sm"
                          />
                        </div>
                      ))}
                  </div>

                </div>
                <UsersIcon className="w-12 h-12 text-blue-600 card-icon" />
              </div>
              <div className="text-slate-500 text-sm mt-1">
                {statistics ? (
                  statistics.usersPercentageChange >= 0 ? (
                    formatPercentChange(statistics.usersPercentageChange)
                  ) : (
                    formatPercentChange(statistics.usersPercentageChange)
                  )
                ) : tAdmin("fromLastMonth", { value: "+8" })}
              </div>
            </div>
            <div className="panel group">
              <div className="card-title flex items-center">
                <div className="pulse-dot"></div>
                {tAdmin("stats.activeWorkOrders")}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-800 mb-1">{statistics?.activeWorkOrders || 0}</div>
                  <div className="text-amber-600 text-sm">
                    {statistics ? (
                      statistics.workOrdersPercentageChange >= 0 ? (
                        formatPercentChange(statistics.workOrdersPercentageChange)
                      ) : (
                        formatPercentChange(statistics.workOrdersPercentageChange)
                      )
                    ) : tAdmin("fromLastMonth", { value: "-5" })}
                  </div>
                </div>
                <ClipboardDocumentListIcon className="w-12 h-12 text-amber-600 card-icon" />
              </div>
            </div>
            <div className="panel group relative">
              <div className="success-badge">
                <CheckCircleIcon className="w-3 h-3 text-white" />
              </div>
              <div className="card-title">{tAdmin("stats.completedThisMonth")}</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-3xl font-bold text-slate-800 mb-1">{statistics?.completedThisMonth || 0}</div>
                  <div className="text-emerald-600 text-sm">
                    {statistics ? (
                      statistics.completedPercentageChange >= 0 ? (
                        formatPercentChange(statistics.completedPercentageChange)
                      ) : (
                        formatPercentChange(statistics.completedPercentageChange)
                      )
                    ) : tAdmin("fromLastMonth", { value: "+23" })}
                  </div>
                </div>
                <CheckCircleIcon className="w-12 h-12 text-emerald-600 card-icon" />
              </div>
            </div>
          </div>


          <div className="bento-item panel" style={{ gridColumn: '1 / 3' }}>

            <div className="card-title">
              {tAdmin("workOrders.recent")}
            </div>
            <div className="space-y-3">
              {workOrders.slice(0, 5)
                .map((wo) => (
                  <div
                    key={wo._id}
                    className="flex justify-between items-center border-b pb-2"
                  >
                    <div>
                      <div className="font-semibold">
                        {wo.title || wo.description}
                      </div>

                      <div className="text-xs text-slate-500">
                        {wo.status}
                      </div>
                    </div>

                    <div
                      className={`status-badge ${getStatusBadge(
                        wo.status ?? 'pending'
                      )}`}
                    >
                      {wo.status}
                    </div>
                  </div>
                ))}
            </div>


          </div>
          <div className="bento-item panel">
            <div className="card-title">
              {tAdmin("machines.availability")}
            </div>

            <div className="text-5xl font-bold text-green-600">
              {machineAvailability}%
            </div>

            <div className="mt-4">
              <div className="w-full h-3 bg-slate-200 rounded-full">
                <div
                  className="h-3 bg-green-500 rounded-full"
                  style={{
                    width: `${machineAvailability}%`
                  }}
                />
              </div>
            </div>

            <div className="text-sm text-slate-500 mt-3">
              {onlineMachines} / {totalMachines} {tAdmin("machines.online")}
            </div>
          </div>

          <div className="bento-item panel">
            <div className="card-title">
              {tAdmin("workOrders.completionRate")}
            </div>

            <div className="text-5xl font-bold text-blue-600">
              {completionRate}%
            </div>

            <div className="mt-4">
              <div className="w-full h-3 bg-slate-200 rounded-full">
                <div
                  className="h-3 bg-blue-500 rounded-full"
                  style={{
                    width: `${completionRate}%`
                  }}
                />
              </div>
            </div>

            <div className="text-sm text-slate-500 mt-3">
              {completedWorkOrders} {tCommon("status.completed")} {tAdmin("workOrders.outOf")} {totalWorkOrders}
            </div>
          </div>


          <div
            className="bento-item panel"
            style={{ gridColumn: '1 / 3' }}
          >
            <div className="card-title">
              {tAdmin("workOrders.distribution")}
            </div>

            <div className="space-y-5">

              <div>
                <div className="flex justify-between mb-2">
                  <span>{tCommon("status.pending")}</span>
                  <span>{pendingCount}</span>
                </div>

                <div className="w-full bg-slate-200 h-3 rounded-full">
                  <div
                    className="bg-amber-500 h-3 rounded-full"
                    style={{
                      width: `${totalWorkOrders ? (pendingCount / totalWorkOrders) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <span>{tCommon("status.inProgress")}</span>
                  <span>{inProgressCount}</span>
                </div>

                <div className="w-full bg-slate-200 h-3 rounded-full">
                  <div
                    className="bg-blue-500 h-3 rounded-full"
                    style={{
                      width: `${totalWorkOrders ? (inProgressCount / totalWorkOrders) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <span>{tCommon("status.completed")}</span>
                  <span>{completedWorkOrders}</span>
                </div>

                <div className="w-full bg-slate-200 h-3 rounded-full">
                  <div
                    className="bg-green-500 h-3 rounded-full"
                    style={{
                      width: `${totalWorkOrders ? (completedWorkOrders / totalWorkOrders) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>

            </div>
          </div>



          <div
            className="bento-item panel"
            style={{ gridColumn: '3 / 5' }}
          >
            <div className="card-title">
              {tAdmin("quickKpis.title")}
            </div>

            <div className="space-y-4">

              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.machineAvailability")}</span>
                <span>{machineAvailability}%</span>
              </div>

              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.completionRate")}</span>
                <span>{completionRate}%</span>
              </div>

              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.activeWorkOrders")}</span>
                <span>{statistics?.activeWorkOrders || 0}</span>
              </div>

              <div className="flex justify-between">
                <span>{tAdmin("quickKpis.activeUsers")}</span>
                <span>{statistics?.activeUsers || 0}</span>
              </div>

            </div>
          </div>


          {/* Quick Access Cards */}
          <div className="col-span-full bento-item panel">
            <div className="card-title">{tAdmin("quickAccess.title")}</div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <Link href={`/${locale}/users`} className="app-icon">
                <div className="app-icon-icon">
                  <UsersIcon className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-sm font-semibold text-slate-700 text-center">
                  {tAdmin("quickAccess.users")}
                </span>
              </Link>

              <Link href={`/${locale}/machines`} className="app-icon">
                <div className="app-icon-icon">
                  <CogIcon className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-sm font-semibold text-slate-700 text-center">
                  {tAdmin("quickAccess.machines")}
                </span>
              </Link>

              <Link href={`/${locale}/work-orders`} className="app-icon">
                <div className="app-icon-icon">
                  <ClipboardDocumentListIcon className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-sm font-semibold text-slate-700 text-center">
                  {tAdmin("quickAccess.workOrders")}
                </span>
              </Link>

              <Link href={`/${locale}/catalogues`} className="app-icon">
                <div className="app-icon-icon">
                  <BuildingStorefrontIcon className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-sm font-semibold text-slate-700 text-center">
                  {tAdmin("quickAccess.catalogues")}
                </span>
              </Link>

              <Link href={`/${locale}/machine-types`} className="app-icon">
                <div className="app-icon-icon">
                  <CubeIcon className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-sm font-semibold text-slate-700 text-center">
                  {tAdmin("quickAccess.types")}
                </span>
              </Link>
            </div>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
