"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useTranslations } from "next-intl";
import {
  ArrowPathIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { apiService } from "@/services/api";
import { fetchAllPaginated, normalizeApiItems } from "@/services/pagination";

type MachineTab = "overview" | "preventive" | "activity";

interface PreventiveTaskItem {
  plan: {
    maintenance_code?: string;
    instruction?: string;
    plan_id?: string;
  };
  module: { name?: string } | null;
  currentOccurrence: {
    _id: string;
    ot_id?: string;
    status?: string;
    date_start?: string;
    priorite?: string;
  } | null;
  currentState: string;
  lastCompletedDate: string | null;
  nextDueDate: string | null;
  frequency: {
    label?: string;
    frequency_type?: string;
  };
}

interface TimelineEventItem {
  _id: string;
  type: string;
  description?: string;
  date?: string;
  createdAt?: string;
  machine_id?: string | { machine_id?: string };
  work_order_id?: string | { _id?: string; ot_id?: string };
}

interface OperatorWorkOrder {
  _id: string;
  machine_id?: string | { _id?: string };
  type_maintenance?: string;
  status?: string;
}

interface MachineSummary {
  machine: {
    id: string;
    machineId: string;
    serialNo: string;
    reference?: string;
    type: { id: string; name: string } | null;
    fabricant?: string;
    model?: string;
    location?: string;
    status: string;
    installationDate?: string;
    createdAt?: string;
    ageDays: number | null;
  };
  stats: {
    totalInterventions: number;
    preventiveCompleted: number;
    correctiveCompleted: number;
    openWorkOrders: number;
    closedWorkOrders: number;
    downtimeHours: number;
    averageRepairTimeHours: number | null;
    partsConsumed: number;
    lastMaintenanceAt: string | null;
    nextMaintenanceAt: string | null;
    lastInspectionAt: string | null;
    lastLubricationAt: string | null;
  };
}

function stringId(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "_id" in value) {
    return stringId((value as { _id?: unknown })._id);
  }
  return "";
}

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
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

function isCompletedStatus(status?: string): boolean {
  const normalized = (status || "").toLowerCase();
  return normalized === "completed" || normalized === "validated";
}

export default function OperatorMachineDetailPage() {
  const t = useTranslations("operatorMachines");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const params = useParams();
  const locale = Array.isArray(params?.locale)
    ? params.locale[0]
    : params?.locale || "en";
  const machineId = Array.isArray(params?.id)
    ? params.id[0]
    : params?.id;

  const [activeTab, setActiveTab] = useState<MachineTab>("overview");
  const [summary, setSummary] = useState<MachineSummary | null>(null);
  const [preventiveTasks, setPreventiveTasks] = useState<PreventiveTaskItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIssueWorkOrderId, setCurrentIssueWorkOrderId] = useState<string | null>(null);
  const [currentIssueStatus, setCurrentIssueStatus] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (!machineId) return;
    try {
      const response = await apiService.getMachineTimelineSummary(machineId);
      setSummary(response.data as MachineSummary);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || t("errors.loadSummary", { defaultValue: "Failed to load machine details" });
      setError(message);
    }
  }, [machineId, t]);

  const loadPreventiveTasks = useCallback(async () => {
    if (!machineId) return;
    try {
      const response = await apiService.getOperatorPreventiveStates({
        machineId,
      });
      const data = response.data as {
        sections: Record<string, PreventiveTaskItem[]>;
      };
      const items = [
        ...(data.sections.dueToday || []),
        ...(data.sections.overdue || []),
        ...(data.sections.waitingValidation || []),
        ...(data.sections.returned || []),
        ...(data.sections.preventivePlan || []),
      ];
      setPreventiveTasks(items);
    } catch {
      // Preventive states may not be available for all machines
      setPreventiveTasks([]);
    }
  }, [machineId]);

  const loadTimeline = useCallback(async () => {
    if (!machineId) return;
    try {
      const response = await apiService.getMachineTimeline(machineId, {
        limit: 20,
      });
      const payload = response.data;
      const items = normalizeApiItems<TimelineEventItem>(payload);
      setTimeline(items.slice(0, 10));
    } catch {
      setTimeline([]);
    }
  }, [machineId]);

  const loadCurrentIssue = useCallback(async () => {
    if (!machineId) return;
    try {
      const workOrders = await fetchAllPaginated<OperatorWorkOrder>((params) => apiService.getMyWorkOrders(params));
      const active = workOrders.find((workOrder) => {
        const targetMachine = typeof workOrder.machine_id === "string" ? workOrder.machine_id : workOrder.machine_id?._id;
        return targetMachine === machineId && !isCompletedStatus(workOrder.status);
      });
      setCurrentIssueWorkOrderId(active?._id || null);
      setCurrentIssueStatus(active?.status || null);
    } catch {
      setCurrentIssueWorkOrderId(null);
      setCurrentIssueStatus(null);
    }
  }, [machineId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        await Promise.all([
          loadSummary(),
          loadPreventiveTasks(),
          loadTimeline(),
          loadCurrentIssue(),
        ]);
      } catch {
        // Individual loaders handle their own errors
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    if (machineId) {
      void load();
    }
    return () => {
      cancelled = true;
    };
  }, [machineId, loadSummary, loadPreventiveTasks, loadTimeline, loadCurrentIssue]);

  const hasCurrentIssue = Boolean(currentIssueWorkOrderId);
  const nextMaintenance = summary?.stats.nextMaintenanceAt
    ? formatDate(summary.stats.nextMaintenanceAt, locale)
    : null;

  const recentActivity = useMemo(() => {
    return timeline
      .filter((event) => {
        const type = event.type.toLowerCase();
        return (
          type.includes("work_order") ||
          type.includes("preventive") ||
          type.includes("corrective") ||
          type.includes("report") ||
          type.includes("fault")
        );
      })
      .slice(0, 6);
  }, [timeline]);

  const tabs: Array<{ key: MachineTab; label: string }> = [
    { key: "overview", label: t("tabs.overview", { defaultValue: "Overview" }) },
    { key: "preventive", label: t("tabs.preventive", { defaultValue: "Preventive Tasks" }) },
    { key: "activity", label: t("tabs.activity", { defaultValue: "Recent Activity" }) },
  ];

  const handleReportProblem = () => {
    if (machineId) {
      router.push(`/${locale}/operator/corrective?machine=${machineId}&intent=report-issue`);
    }
  };

  const handleOpenTask = (task: PreventiveTaskItem) => {
    if (task.currentOccurrence?._id) {
      router.push(`/${locale}/operator/preventive?workOrder=${task.currentOccurrence._id}`);
    }
  };

  const handleViewWorkOrder = (workOrderId: string) => {
    if (workOrderId) {
      router.push(`/${locale}/operator/my-reports?workOrderId=${encodeURIComponent(workOrderId)}`);
    } else {
      router.push(`/${locale}/operator/my-reports`);
    }
  };

  if (loading) {
    return (
      <div className="operator-dashboard-theme flex justify-center items-center h-100">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!machineId || error) {
    return (
      <DashboardLayout title={t("pageTitle")}>
        <div className="operator-dashboard-theme rounded-3xl border border-border bg-(--surface-elevated) px-4 py-12 text-center text-sm text-text-secondary">
          {error || t("errors.notFound", { defaultValue: "Machine not found." })}
        </div>
      </DashboardLayout>
    );
  }

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout
        title={
          summary?.machine.machineId
            ? `${t("pageTitle")} / ${summary.machine.machineId}`
            : t("pageTitle")
        }
      >
        <div className="operator-dashboard-theme space-y-6 p-4 md:p-6 lg:p-8">
          <button
            type="button"
            onClick={() => router.push(`/${locale}/operator/machines`)}
            className="inline-flex items-center rounded-xl border border-border bg-(--surface-elevated) px-4 py-2 text-sm font-semibold text-text-secondary transition hover:text-text-primary"
          >
            {t("backToMachines", { defaultValue: "Back to Machines" })}
          </button>
          <div className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-(--surface-elevated) p-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.key
                    ? "bg-cyan-900/15 text-cyan-700"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div className="space-y-6">
              <section className="rounded-3xl border border-border bg-(--surface-secondary) p-5 md:p-6">
                <h2 className="text-lg font-semibold text-text-primary">
                  {t("overview.status", { defaultValue: "Status" })}
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      {t("overview.currentStatus", { defaultValue: "Current Status" })}
                    </div>
                    <div className="mt-1">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semib capitalize ${machineStatusBadge(summary?.machine.status || "")}`}
                      >
                        {t(`status.${summary?.machine.status}`, {
                          defaultValue: summary?.machine.status || tCommon("notAvailable"),
                        })}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      {t("overview.machine", { defaultValue: "Machine" })}
                    </div>
                    <div className="mt-1 text-sm font-medium text-text-primary">
                      {summary?.machine.machineId || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      {t("overview.type", { defaultValue: "Type" })}
                    </div>
                    <div className="mt-1 text-sm font-medium text-text-primary">
                      {summary?.machine.type?.name || summary?.machine.model || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      {t("overview.serialNumber", { defaultValue: "Serial Number" })}
                    </div>
                    <div className="mt-1 text-sm font-medium text-text-primary">
                      {summary?.machine.serialNo || "—"}
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-border bg-(--surface-secondary) p-5 md:p-6">
                <h2 className="text-lg font-semibold text-text-primary">
                  {t("overview.maintenanceState", { defaultValue: "Maintenance State" })}
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      {t("overview.openIssue", { defaultValue: "Open Issue" })}
                    </div>
                    <div className="mt-1 text-sm font-medium text-text-primary">
                      {hasCurrentIssue
                        ? t("overview.hasOpenIssue", { defaultValue: "Open report" })
                        : t("overview.noOpenIssue", { defaultValue: "None" })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      {t("overview.nextPreventiveTask", { defaultValue: "Next Preventive Task" })}
                    </div>
                    <div className="mt-1 text-sm font-medium text-text-primary">
                      {nextMaintenance || "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-5">
                  <button
                    type="button"
                    onClick={handleReportProblem}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-700/55 bg-linear-to-r from-[#1E3A8A] via-[#1D4ED8] to-[#155E75] px-5 py-2.5 text-sm font-semibold text-slate-50 shadow-[0_14px_30px_rgba(6,78,59,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(6,78,59,0.45)]"
                  >
                    <PlusIcon className="h-4 w-4" />
                    {t("overview.reportProblem", { defaultValue: "Report a Problem" })}
                  </button>
                </div>
              </section>

              {hasCurrentIssue && (
                <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 md:p-6">
                  <h2 className="text-lg font-semibold text-amber-950">
                    {t("overview.currentIssue", { defaultValue: "Current Issue" })}
                  </h2>
                  <p className="mt-2 text-sm text-amber-800">
                    {currentIssueStatus === "in_progress"
                      ? t("overview.issueInProgress", { defaultValue: "A technician is working on this report." })
                      : t("overview.issueReported", { defaultValue: "This report is open and awaiting the next maintenance update." })}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleViewWorkOrder(currentIssueWorkOrderId || "")}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-700/40 bg-amber-900/10 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-900/20"
                  >
                    {t("overview.viewStatus", { defaultValue: "View Status" })}
                  </button>
                </section>
              )}
            </div>
          )}

          {activeTab === "preventive" && (
            <section className="rounded-3xl border border-border bg-(--surface-secondary) p-5 md:p-6">
              <h2 className="text-lg font-semibold text-text-primary">
                {t("preventive.title", { defaultValue: "Preventive Tasks" })}
              </h2>
              {preventiveTasks.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
                  {t("preventive.empty", { defaultValue: "No preventive tasks available." })}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {preventiveTasks.map((task, index) => {
                    const workOrder = task.currentOccurrence;
                    const isCompleted = isCompletedStatus(workOrder?.status);
                    const dueLabel = task.nextDueDate
                      ? formatDate(task.nextDueDate, locale)
                      : "—";

                    return (
                      <div
                        key={`${task.plan.plan_id || index}-${task.currentState}`}
                        className="rounded-2xl border border-border bg-(--surface-elevated) p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text-primary">
                              {task.plan.instruction || task.plan.maintenance_code || "—"}
                            </div>
                            <div className="mt-1 text-xs text-text-secondary">
                              {task.module?.name || ""}
                              {task.frequency.label
                                ? ` • ${task.frequency.label}`
                                : ""}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-text-muted">
                              <span>
                                {t("preventive.due", { defaultValue: "Due" })}: {dueLabel}
                              </span>
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semib ${
                                  isCompleted
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700"
                                }`}
                              >
                                {isCompleted
                                  ? t("preventive.completed", { defaultValue: "Completed" })
                                  : t("preventive.pending", { defaultValue: "Pending" })}
                              </span>
                            </div>
                          </div>
                          {!isCompleted && workOrder?._id && (
                            <button
                              type="button"
                              onClick={() => handleOpenTask(task)}
                              className="shrink-0 inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-700/55 bg-linear-to-r from-[#1E3A8A] via-[#1D4ED8] to-[#155E75] px-4 py-2 text-sm font-semibold text-slate-50 shadow-[0_14px_30px_rgba(6,78,59,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(6,78,59,0.45)]"
                            >
                              {t("preventive.openTask", { defaultValue: "Open Task" })}
                              <ArrowPathIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === "activity" && (
            <section className="rounded-3xl border border-border bg-(--surface-secondary) p-5 md:p-6">
              <h2 className="text-lg font-semibold text-text-primary">
                {t("activity.title", { defaultValue: "Recent Activity" })}
              </h2>
              {recentActivity.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
                  {t("activity.empty", { defaultValue: "No recent activity." })}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {recentActivity.map((event) => {
                    const eventDate = event.date || event.createdAt;
                    const relativeDate = eventDate
                      ? new Date(eventDate).toLocaleDateString(locale, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—";
                    const relativeTime = eventDate
                      ? new Date(eventDate).toLocaleTimeString(locale, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : null;

                    let eventLabel = event.type.replace(/_/g, " ");
                    eventLabel = eventLabel
                      .replace(/\b\w/g, (char) => char.toUpperCase())
                      .replace("Ai", "AI");

                    return (
                      <div
                        key={event._id}
                        className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-(--surface-elevated) px-4 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-text-primary">
                            {event.description || eventLabel}
                          </div>
                          {event.work_order_id ? (
                            <div className="mt-1 text-xs text-text-muted">
                              {stringId(event.work_order_id)}
                            </div>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right text-[10px] text-text-muted">
                          <div>{relativeDate}</div>
                          {relativeTime && <div>{relativeTime}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
