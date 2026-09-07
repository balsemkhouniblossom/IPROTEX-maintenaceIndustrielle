"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import {
  CheckCircleIcon,
  ClockIcon,
  ArrowRightIcon,
  ClipboardDocumentListIcon,
  ExclamationTriangleIcon,
  CogIcon,
} from "@heroicons/react/24/outline";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";
import { fetchAllPaginated, normalizeApiItems } from "@/services/pagination";

interface OperatorKpiCounts {
  overdueCount: number;
  dueTodayCount: number;
  waitingValidationCount: number;
  completedTodayCount: number;
}

const emptyKpiCounts: OperatorKpiCounts = {
  overdueCount: 0,
  dueTodayCount: 0,
  waitingValidationCount: 0,
  completedTodayCount: 0,
};

interface WorkOrderItem {
  _id: string;
  ot_id?: string;
  status?: string;
  type_maintenance?: string;
  date_created?: string;
  date_start?: string;
  priorite?: string;
  machine_id?: string | { _id?: string; machine_id?: string };
  description?: string;
  technician_id?: string | { _id?: string; nom_complet?: string };
}

interface InterventionReportItem {
  _id: string;
  report_id?: string;
  ot_id?: string | { _id?: string };
  description_action?: string;
  validation_responsable?: string;
  date_debut?: string;
  date_fin?: string;
}

interface CalendarEventItem {
  id: string;
  workOrderId?: string;
  title: string;
  type?: string;
  status: string;
  dueDate: string;
  priority?: string;
  machine?: { id?: string; code?: string };
  frequency?: { label?: string };
}

interface OperatorTaskItem {
  id: string;
  workOrderId: string;
  machineId: string;
  machineCode: string;
  maintenanceType: string;
  priority: string;
  status: string;
  dueDate: string;
  isOverdue: boolean;
}

interface MachineItem {
  _id: string;
  machine_id: string;
  serial_no: string;
  model?: string;
  status: string;
  type_id?: string | { name?: string };
}

interface NotificationItem {
  _id: string;
  notification_id: string;
  type: string;
  title: string;
  message?: string;
  translationKey?: string;
  translationParams?: Record<string, string | number | boolean | null>;
  is_read: boolean;
  createdAt: string;
}

function extractId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const objectValue = value as { _id?: string; id?: string };
    return objectValue._id || objectValue.id || "";
  }
  return "";
}

function extractMachineLabel(value: WorkOrderItem["machine_id"]): string {
  if (!value) return "-";
  if (typeof value === "string") return displayText(value, "-");
  return displayText(value.machine_id, "-");
}

function isSameDay(date: Date, reference: Date): boolean {
  return (
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function isCompletedStatus(status?: string): boolean {
  const normalized = (status || "").toLowerCase();
  return normalized === "completed" || normalized === "validated";
}

function formatMaintenanceType(
  type: string | undefined,
  tOperator: ReturnType<typeof useTranslations>,
): string {
  return (type || "").toLowerCase().includes("correct")
    ? tOperator("correctiveMaintenance")
    : tOperator("preventiveMaintenance");
}

function formatPriority(priority: string | undefined): string {
  if (!priority) return "Medium";
  const normalized = priority.toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatReportStatus(
  status: string | undefined,
  tOperator: ReturnType<typeof useTranslations>,
): string {
  const normalized = (status || "").toLowerCase();
  if (normalized === "validated" || normalized === "completed") return tOperator("dashboard.statusCompleted");
  if (normalized === "rejected" || normalized === "cancelled" || normalized === "canceled") return tOperator("dashboard.statusCancelled");
  if (normalized === "in_progress" || normalized === "in-progress") return tOperator("dashboard.statusInProgress");
  if (normalized === "waiting_parts" || normalized === "waiting-for-parts") return tOperator("dashboard.statusWaitingParts");
  if (normalized === "waiting_validation" || normalized === "technician_required") return tOperator("dashboard.statusAwaitingReview");
  return tOperator("dashboard.statusSubmitted");
}

function notificationTranslationParams(
  params?: Record<string, string | number | boolean | null>,
): Record<string, string | number> {
  if (!params) return {};
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [
        key,
        typeof value === "boolean" ? String(value) : value,
      ]),
  ) as Record<string, string | number>;
}

function machineStatusBadge(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "operational") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  }
  if (normalized === "maintenance") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  }
  return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
}

function renderNotificationTitle(
  item: NotificationItem,
  tNotification: ReturnType<typeof useTranslations>,
): string {
  const key = item.translationKey
    ? `templates.${item.translationKey.replace(/^templates\./, "")}`
    : "";
  if (key && tNotification.has(key)) {
    return tNotification(key, notificationTranslationParams(item.translationParams));
  }
  return item.title;
}

export default function OperatorDashboard() {
  const tOperator = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
  const tNotification = useTranslations("notificationCenter");
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const locale = Array.isArray(params?.locale)
    ? params.locale[0]
    : params?.locale || "en";

  const [workOrders, setWorkOrders] = useState<WorkOrderItem[]>([]);
  const [reports, setReports] = useState<InterventionReportItem[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventItem[]>([]);
  const [kpiCounts, setKpiCounts] = useState<OperatorKpiCounts>(emptyKpiCounts);
  const [loading, setLoading] = useState(true);
  const [sectionErrors, setSectionErrors] = useState<Record<string, boolean>>({});
  const now = useMemo(() => new Date(), []);

  const [machines, setMachines] = useState<MachineItem[]>([]);
  const [recentNotifications, setRecentNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const activeWorkOrders = useMemo(
    () =>
      workOrders.filter(
        (order) =>
          order.technician_id && extractId(order.technician_id) === user?._id,
      ),
    [user?._id, workOrders],
  );

  const eventByWorkOrderId = useMemo(() => {
    return new Map(
      calendarEvents
        .filter((event) => event.workOrderId)
        .map((event) => [event.workOrderId as string, event]),
    );
  }, [calendarEvents]);

  const operatorTasks = useMemo<OperatorTaskItem[]>(() => {
    return activeWorkOrders
      .filter((order) => {
        const event = eventByWorkOrderId.get(order._id);
        return ![order.type_maintenance, event?.type]
          .filter(Boolean)
          .some((type) => String(type).toLowerCase().includes("correct"));
      })
      .map((order) => {
        const event = eventByWorkOrderId.get(order._id);
        const dueDate =
          event?.dueDate ||
          order.date_start ||
          order.date_created ||
          new Date().toISOString();
        const due = new Date(dueDate);
        const overdue =
          event?.status === "overdue" ||
          (!isCompletedStatus(order.status) && due.getTime() < now.getTime());

        return {
          id: event?.id || order._id,
          workOrderId: order._id,
          machineId: event?.machine?.id || extractId(order.machine_id),
          machineCode:
            event?.machine?.code || extractMachineLabel(order.machine_id),
          maintenanceType:
            order.type_maintenance || event?.type || "preventive",
          priority: event?.priority || order.priorite || "medium",
          status: order.status || event?.status || "assigned",
          dueDate,
          isOverdue: overdue,
        };
      })
      .filter((task) => !isCompletedStatus(task.status))
      .filter((task) => {
        const due = new Date(task.dueDate);
        return task.isOverdue || isSameDay(due, now);
      })
      .sort((left, right) => {
        if (left.isOverdue !== right.isOverdue) {
          return left.isOverdue ? -1 : 1;
        }
        return (
          new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime()
        );
      });
  }, [activeWorkOrders, eventByWorkOrderId, now]);


  const recentReports = useMemo(() => {
    return reports
      .filter((report) => {
        const workOrder = workOrders.find(
          (order) => order._id === extractId(report.ot_id),
        );
        return (
          !workOrder ||
          !user?._id ||
          extractId(workOrder.technician_id) === user._id
        );
      })
      .slice()
      .sort(
        (left, right) =>
          new Date(right.date_fin || right.date_debut || 0).getTime() -
          new Date(left.date_fin || left.date_debut || 0).getTime(),
      )
      .slice(0, 5);
  }, [reports, workOrders, user?._id]);

  const openReportsCount = useMemo(
    () =>
      reports.filter(
        (report) =>
          !isCompletedStatus(report.validation_responsable) &&
          report.validation_responsable !== "rejected",
      ).length,
    [recentReports],
  );

  const summaryCards = [
    {
      label: tOperator("dashboard.machinesAvailable"),
      value: machines.length,
      icon: CogIcon,
      accent: "from-cyan-700 via-sky-700 to-blue-800",
      textTone: "text-[var(--text-primary)]",
    },
    {
      label: tOperator("stats.dueToday"),
      value: kpiCounts.dueTodayCount,
      icon: ClockIcon,
      accent: "from-cyan-700 via-sky-700 to-blue-800",
      textTone: "text-[var(--text-primary)]",
    },
    {
      label: tOperator("dashboard.openReports"),
      value: openReportsCount,
      icon: ClipboardDocumentListIcon,
      accent: "from-cyan-700 via-sky-700 to-indigo-800",
      textTone: "text-[var(--text-primary)]",
    },
    {
      label: tOperator("dashboard.unreadNotifications"),
      value: unreadCount,
      icon: ExclamationTriangleIcon,
      accent: "from-cyan-700 via-sky-700 to-blue-800",
      textTone:
        unreadCount > 0 ? "text-rose-500" : "text-[var(--text-primary)]",
    },
  ];

  const softCardClassName = "operator-frost-card";
  const centeredMetricCardClassName = `${softCardClassName} rounded-3xl p-5 text-center`;
  const actionButtonClassName =
    "inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-700/55 bg-linear-to-r from-[#1E3A8A] via-[#1D4ED8] to-[#155E75] px-4 py-2.5 text-sm font-semibold text-slate-50 shadow-[0_14px_30px_rgba(6,78,59,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(6,78,59,0.45)]";
  const secondaryButtonClassName =
    "inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-(--surface-elevated) px-4 py-2.5 text-sm font-semibold text-text-primary transition hover:border-cyan-700/55";

  const getTaskRoute = (maintenanceType: string) => {
    return maintenanceType.toLowerCase().includes("correct")
      ? `/${locale}/operator/corrective`
      : `/${locale}/operator/preventive`;
  };

  const handleStartTask = (task: OperatorTaskItem) => {
    const params = new URLSearchParams();
    if (task.workOrderId) params.set("workOrder", task.workOrderId);
    if (task.machineId) params.set("machine", task.machineId);
    router.push(`${getTaskRoute(task.maintenanceType)}?${params.toString()}`);
  };

  const handleViewMachine = (machineId: string) => {
    router.push(`/${locale}/operator/machines/${machineId}`);
  };

  const handleReportProblem = (machineId?: string) => {
    const query = machineId ? `?machine=${machineId}` : "";
    router.push(`/${locale}/operator/corrective${query}`);
  };

  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user?._id) {
      return;
    }

    let cancelled = false;

    const loadOperatorData = async () => {
      try {
        const [
          workOrdersResult,
          reportsResult,
          calendarResult,
          dashboardResult,
          machinesResult,
          notificationsResult,
        ] = await Promise.allSettled([
          fetchAllPaginated<WorkOrderItem>((pagination) =>
            apiService.getMyWorkOrders(pagination),
          ),
          fetchAllPaginated<InterventionReportItem>((pagination) =>
            apiService.getMyInterventionReports(pagination),
          ),
          apiService.getMyCalendarEvents({
            view: "week",
            date: new Date().toISOString().slice(0, 10),
          }),
          apiService.getOperatorDashboard(),
          fetchAllPaginated<MachineItem>((pagination) =>
            apiService.getMyMachines(pagination),
          ),
          apiService.getNotifications({ page: 1, limit: 5 }),
        ]);

        if (cancelled) {
          return;
        }

        const failures: Record<string, boolean> = {};
        if (workOrdersResult.status === "fulfilled") setWorkOrders(workOrdersResult.value);
        else failures.tasks = true;
        if (reportsResult.status === "fulfilled") setReports(reportsResult.value);
        else failures.reports = true;
        if (calendarResult.status === "fulfilled") {
          const calendarPayload =
            (calendarResult.value.data as { items?: unknown } | undefined)?.items ??
            calendarResult.value.data;
          setCalendarEvents(normalizeApiItems<CalendarEventItem>(calendarPayload));
        } else failures.tasks = true;
        if (machinesResult.status === "fulfilled") setMachines(machinesResult.value);
        else failures.machines = true;
        if (notificationsResult.status === "fulfilled") {
          const fetchedNotifications = normalizeApiItems<NotificationItem>(notificationsResult.value.data);
          setRecentNotifications(fetchedNotifications.slice(0, 5));
          setUnreadCount(
            (notificationsResult.value.data as { unreadCount?: number } | undefined)?.unreadCount ??
              fetchedNotifications.filter((item) => !item.is_read).length,
          );
        } else failures.notifications = true;
        if (dashboardResult.status === "fulfilled") {
          const dashboard = dashboardResult.value.data as OperatorKpiCounts;
          setKpiCounts({
            overdueCount: dashboard.overdueCount,
            dueTodayCount: dashboard.dueTodayCount,
            waitingValidationCount: dashboard.waitingValidationCount,
            completedTodayCount: dashboard.completedTodayCount,
          });
        } else {
          failures.stats = true;
        }
        setSectionErrors(failures);

      } catch (error) {
        console.error("Error loading operator dashboard", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadOperatorData();

    return () => {
      cancelled = true;
    };
  }, [user?._id, authLoading]);

  if (loading) {
    return (
      <div className="operator-dashboard-theme flex min-h-screen items-center justify-center bg-background px-4">
        <div className="rounded-3xl border border-border bg-(--surface-elevated) px-8 py-10 text-center backdrop-blur-xl shadow-(--shadow-lg)">
          <div className="mx-auto h-14 w-14 animate-spin rounded-full border-b-2 border-cyan-700"></div>
          <div className="mt-4 text-sm font-medium text-text-secondary">
            {tCommon("loading")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={tOperator("title")}>
        <div className="operator-dashboard-theme space-y-6 p-4 md:p-6 lg:p-8">
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className={`${centeredMetricCardClassName} flex min-h-28 flex-col items-center justify-center`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-700/25 bg-cyan-900/12 text-cyan-700 dark:text-cyan-500">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                    {card.label}
                  </div>
                  <div
                    className={`mt-1 text-2xl font-semibold tracking-[-0.03em] ${card.textTone}`}
                  >
                    {card.value}
                  </div>
                </div>
              );
            })}
          </section>

          <section className={`rounded-3xl p-5 md:p-6 ${softCardClassName}`}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">
                {tOperator("dashboard.machinesAvailable")}
              </h2>
              <button
                type="button"
                onClick={() => router.push(`/${locale}/operator/machines`)}
                className={secondaryButtonClassName}
              >
                {tOperator("dashboard.viewAllMachines")}
              </button>
            </div>

            {sectionErrors.machines ? (
              <div className={`${centeredMetricCardClassName} py-10`}>
                <div className="text-sm font-semibold text-rose-700">{tCommon("loadFailed", { defaultValue: "Machines could not be loaded." })}</div>
                <div className="mt-1 text-xs text-text-secondary">{tCommon("retryLater", { defaultValue: "Try again shortly." })}</div>
              </div>
            ) : machines.length === 0 ? (
              <div className={`${centeredMetricCardClassName} py-10`}>
                <div className="text-sm text-text-secondary">
                  {tOperator("dashboard.noMachinesAvailable")}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {machines.slice(0, 6).map((machine) => (
                  <div
                    key={machine._id}
                    className={`rounded-2xl border border-border bg-(--surface-secondary) p-4`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary">
                          {machine.machine_id || displayText(machine._id, "-")}
                        </div>
                        <div className="mt-1 text-xs text-text-secondary">
                          {machine.model || machine.serial_no || ""}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semib capitalize ${machineStatusBadge(machine.status)}`}
                      >
                        {machine.status || tOperator("dashboard.unknownStatus")}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleViewMachine(machine._id)}
                        className={secondaryButtonClassName}
                      >
                        {tOperator("dashboard.viewMachine")}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReportProblem(machine._id)}
                        className={actionButtonClassName}
                      >
                        {tOperator("dashboard.reportProblem")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={`rounded-3xl p-5 md:p-6 ${softCardClassName}`}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">
                {tOperator("dashboard.todaysPreventiveTasks")}
              </h2>
              <button
                type="button"
                onClick={() => router.push(`/${locale}/operator/preventive`)}
                className={secondaryButtonClassName}
              >
                {tOperator("dashboard.viewAllTasks")}
              </button>
            </div>

            {sectionErrors.tasks ? (
              <div className={`${centeredMetricCardClassName} py-10 text-sm text-rose-700`}>{tCommon("loadFailed", { defaultValue: "Preventive tasks could not be loaded." })}</div>
            ) : operatorTasks.length === 0 ? (
              <div className={`${centeredMetricCardClassName} py-10`}>
                <div className="text-sm font-semibold text-text-primary">
                  {tOperator("dashboard.noPreventiveTasksTitle")}
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {tOperator("dashboard.noPreventiveTasksDescription")}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {operatorTasks.slice(0, 5).map((task) => {
                  const dueDate = new Date(task.dueDate);
                  const dueLabel = task.isOverdue
                    ? tCommon("now")
                    : new Intl.DateTimeFormat(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(dueDate);

                  return (
                    <div
                      key={task.id}
                      className={`flex flex-col gap-3 rounded-2xl border border-border bg-(--surface-secondary) p-4 md:flex-row md:items-center md:justify-between`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary">
                          {task.machineCode}
                        </div>
                        <div className="mt-1 text-xs text-text-secondary">
                          {formatMaintenanceType(task.maintenanceType, tOperator)}
                          <span className="mx-2 text-text-muted">•</span>
                          {tOperator("dashboard.due")}: {dueLabel}
                          <span className="mx-2 text-text-muted">•</span>
                          {tOperator("dashboard.status")}: {formatReportStatus(task.status, tOperator)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStartTask(task)}
                        className={`shrink-0 ${actionButtonClassName}`}
                      >
                        {tOperator("dashboard.openTask")}
                        <ArrowRightIcon className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className={`rounded-3xl p-5 md:p-6 ${softCardClassName}`}>
            <div className="flex flex-col items-center justify-center gap-4 text-center md:flex-row md:justify-between md:text-start">
              <div className="max-w-xl">
                <h2 className="text-lg font-semibold text-text-primary">
                  {tOperator("dashboard.quickActionTitle")}
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  {tOperator("dashboard.quickActionDescription")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleReportProblem()}
                className={`shrink-0 ${actionButtonClassName}`}
              >
                {tOperator("dashboard.reportProblem")}
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className={`rounded-3xl p-5 md:p-6 ${softCardClassName}`}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text-primary">
                  {tOperator("dashboard.recentReports")}
                </h2>
                <button
                  type="button"
                  onClick={() => router.push(`/${locale}/operator/my-reports`)}
                  className={secondaryButtonClassName}
                >
                  {tOperator("dashboard.viewAllReports")}
                </button>
              </div>

              {sectionErrors.reports ? (
                <div className={`${centeredMetricCardClassName} py-10 text-sm text-rose-700`}>{tCommon("loadFailed", { defaultValue: "Reports could not be loaded." })}</div>
              ) : recentReports.length === 0 ? (
                <div className={`${centeredMetricCardClassName} py-10`}>
                  <div className="text-sm font-semibold text-text-primary">
                    {tOperator("dashboard.noReportsTitle")}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    {tOperator("dashboard.noReportsDescription")}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentReports.slice(0, 4).map((report) => {
                    const workOrder = workOrders.find(
                      (order) => order._id === extractId(report.ot_id),
                    );
                    const machineLabel = workOrder
                      ? extractMachineLabel(workOrder.machine_id)
                      : tOperator("dashboard.emptyValue");
                    const maintenanceType = formatMaintenanceType(
                      workOrder?.type_maintenance,
                      tOperator,
                    );
                    const submittedAt =
                      report.date_fin || report.date_debut;

                    return (
                      <div
                        key={report._id}
                        className={`rounded-2xl border border-border bg-(--surface-secondary) p-4`}
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text-primary">
                              {workOrder?.ot_id || report.report_id || report._id}
                            </div>
                            <div className="mt-1 text-xs text-text-secondary">
                              {machineLabel}
                              <span className="mx-2 text-text-muted">•</span>
                              {report.description_action || maintenanceType || ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                                report.validation_responsable === "validated"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : report.validation_responsable === "rejected"
                                    ? "border-rose-200 bg-rose-50 text-rose-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700"
                              }`}
                            >
                              {formatReportStatus(report.validation_responsable, tOperator)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const reportId = report._id || report.report_id;
                                const workOrderId = workOrder?._id || "";
                                const query = reportId
                                  ? `?reportId=${encodeURIComponent(reportId)}${workOrderId ? `&workOrderId=${encodeURIComponent(workOrderId)}` : ""}`
                                  : "";
                                router.push(`/${locale}/operator/my-reports${query}`);
                              }}
                              className={secondaryButtonClassName}
                            >
                              {tOperator("dashboard.viewStatus")}
                            </button>
                          </div>
                        </div>
                        {submittedAt ? (
                          <div className="mt-2 text-[10px] text-text-muted">
                            {new Intl.DateTimeFormat(locale, {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(submittedAt))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={`rounded-3xl p-5 md:p-6 ${softCardClassName}`}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-text-primary">
                  {tOperator("dashboard.recentNotifications")}
                </h2>
                <button
                  type="button"
                  onClick={() => router.push(`/${locale}/operator/notifications`)}
                  className={secondaryButtonClassName}
                >
                  {tOperator("dashboard.viewAllNotifications")}
                </button>
              </div>

              {recentNotifications.length === 0 ? (
                <div className={`${centeredMetricCardClassName} py-10`}>
                  <div className="text-sm text-text-secondary">
                    {tNotification("empty")}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentNotifications.map((item) => (
                    <div
                      key={item._id}
                      className={`rounded-2xl border px-4 py-3 text-sm ${
                        item.is_read
                          ? "border-border bg-(--surface-secondary)"
                          : "border-cyan-700/40 bg-cyan-900/10"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-medium text-text-primary">
                          {renderNotificationTitle(item, tNotification)}
                        </span>
                        <span className="shrink-0 text-[10px] text-text-muted">
                          {new Date(item.createdAt).toLocaleString(locale, {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {item.message ? (
                        <div className="mt-1 text-xs text-text-secondary">
                          {item.message}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
