"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import { MiniAvatarAssistant } from "@/components/avatar/MiniAvatarAssistant";
import type { AvatarActionKey } from "@/components/avatar/avatar-types";
import AiAssistantPanel from "@/components/ai-assistant/AiAssistantPanel";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import {
    CheckCircleIcon,
    ClockIcon,
    ArrowRightIcon,
    ClipboardDocumentListIcon,
    SparklesIcon,
    WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { apiService } from "@/services/api";
import { displayText } from "@/services/displayValues";
import { fetchAllPaginated, normalizeApiItems } from "@/services/pagination";

interface OperatorStats {
    assigned: number;
    inProgress: number;
    completed: number;
}

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
    return date.getFullYear() === reference.getFullYear()
        && date.getMonth() === reference.getMonth()
        && date.getDate() === reference.getDate();
}

function isCompletedStatus(status?: string): boolean {
    const normalized = (status || "").toLowerCase();
    return normalized === "completed" || normalized === "validated";
}

function formatMaintenanceType(type: string | undefined, tOperator: ReturnType<typeof useTranslations>): string {
    return (type || "").toLowerCase().includes("correct")
        ? tOperator("correctiveMaintenance")
        : tOperator("preventiveMaintenance");
}

function formatPriority(priority: string | undefined): string {
    if (!priority) return "Medium";
    const normalized = priority.toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatReportStatus(status: string | undefined, tOperator: ReturnType<typeof useTranslations>): string {
    if (status === "validated") {
        return tOperator("validated");
    }
    if (status === "rejected") {
        return tOperator("dashboard.rejected");
    }
    return tOperator("dashboard.pendingTechnicianValidation");
}

export default function OperatorDashboard() {
    const tOperator = useTranslations("dashboard.operator");
    const tCommon = useTranslations("common");
    const { user, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const locale = Array.isArray(params?.locale)
        ? params.locale[0]
        : params?.locale || "en";

    const [workOrders, setWorkOrders] = useState<WorkOrderItem[]>([]);
    const [reports, setReports] = useState<InterventionReportItem[]>([]);
    const [calendarEvents, setCalendarEvents] = useState<CalendarEventItem[]>([]);
    const [stats, setStats] = useState<OperatorStats>({
        assigned: 0,
        inProgress: 0,
        completed: 0,
    });
    const [kpiCounts, setKpiCounts] = useState<OperatorKpiCounts>(emptyKpiCounts);
    const [loading, setLoading] = useState(true);
    const [statsError, setStatsError] = useState(false);
    const now = useMemo(() => new Date(), []);

    const shiftLabel = useMemo(() => {
        const hour = now.getHours();
        if (hour >= 6 && hour < 14) {
            return tOperator("shift.morning");
        }
        if (hour >= 14 && hour < 22) {
            return tOperator("shift.afternoon");
        }
        return tOperator("shift.night");
    }, [now, tOperator]);

    const activeWorkOrders = useMemo(
        () => workOrders.filter((order) => order.technician_id && extractId(order.technician_id) === user?._id),
        [user?._id, workOrders],
    );

    const derivedMachineLabel = useMemo(() => {
        const firstActive = activeWorkOrders.find((order) => order.status !== "completed");
        return firstActive ? extractMachineLabel(firstActive.machine_id) : tOperator("dashboard.emptyValue");
    }, [activeWorkOrders, tOperator]);

    const recentReports = useMemo(() => {
        return reports
            .filter((report) => {
                const workOrder = workOrders.find((order) => order._id === extractId(report.ot_id));
                return !workOrder || !user?._id || extractId(workOrder.technician_id) === user._id;
            })
            .slice()
            .sort((left, right) => new Date(right.date_fin || right.date_debut || 0).getTime() - new Date(left.date_fin || left.date_debut || 0).getTime())
            .slice(0, 4);
    }, [reports, workOrders, user?._id]);

    const eventByWorkOrderId = useMemo(() => {
        return new Map(
            calendarEvents
                .filter((event) => event.workOrderId)
                .map((event) => [event.workOrderId as string, event]),
        );
    }, [calendarEvents]);

    const operatorTasks = useMemo<OperatorTaskItem[]>(() => {
        return activeWorkOrders
            .map((order) => {
                const event = eventByWorkOrderId.get(order._id);
                const dueDate = event?.dueDate || order.date_start || order.date_created || new Date().toISOString();
                const due = new Date(dueDate);
                const overdue = event?.status === "overdue"
                    || (!isCompletedStatus(order.status) && due.getTime() < now.getTime());

                return {
                    id: event?.id || order._id,
                    workOrderId: order._id,
                    machineId: event?.machine?.id || extractId(order.machine_id),
                    machineCode: event?.machine?.code || extractMachineLabel(order.machine_id),
                    maintenanceType: order.type_maintenance || event?.type || "preventive",
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
                return new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime();
            });
    }, [activeWorkOrders, eventByWorkOrderId, now]);

    const nextTask = operatorTasks[0] || null;
    // The overdue *count* shown as a KPI badge always comes from the
    // server (`GET /operator/dashboard`, business-timezone-aware) rather
    // than from filtering the on-screen task list — the two lists can
    // legitimately differ (this page only loads a week of calendar
    // events), so recomputing the badge locally could silently disagree
    // with every other overdue count in the app.
    const overdueTasksCount = kpiCounts.overdueCount;

    const latestReport = recentReports[0] || null;
    const waitingValidationCount = reports.filter((report) => !report.validation_responsable || report.validation_responsable === "pending").length;

    const analyticsCards = [
        { label: tOperator("dashboard.todayTasks"), value: operatorTasks.length, icon: ClipboardDocumentListIcon, accent: "from-cyan-700 via-sky-700 to-blue-800", textTone: "text-[var(--text-primary)]" },
        { label: tOperator("stats.assignedToYou"), value: stats.assigned, icon: ClipboardDocumentListIcon, accent: "from-cyan-700 via-sky-700 to-blue-800", textTone: "text-[var(--text-primary)]" },
        { label: tOperator("stats.inProgress"), value: stats.inProgress, icon: WrenchScrewdriverIcon, accent: "from-cyan-700 via-sky-700 to-indigo-800", textTone: "text-[var(--text-primary)]" },
        { label: tOperator("stats.dueToday"), value: kpiCounts.dueTodayCount, icon: ClockIcon, accent: "from-cyan-700 via-sky-700 to-blue-800", textTone: "text-[var(--text-primary)]" },
        { label: tOperator("dashboard.overdueTasks"), value: overdueTasksCount, icon: ClockIcon, accent: "from-cyan-700 via-sky-700 to-blue-800", textTone: overdueTasksCount > 0 ? "text-rose-500" : "text-[var(--text-primary)]" },
        { label: tOperator("stats.completedToday"), value: kpiCounts.completedTodayCount, icon: CheckCircleIcon, accent: "from-cyan-700 via-sky-700 to-indigo-800", textTone: "text-[var(--text-primary)]" },
    ];

    const shellClassName = "p-4 md:p-6 xl:p-8";
    const softCardClassName = "operator-frost-card";
    const centeredMetricCardClassName = `${softCardClassName} rounded-3xl p-6 text-center`;
    const actionButtonClassName = "inline-flex items-center justify-center gap-3 rounded-2xl border border-cyan-700/55 bg-linear-to-r from-[#1E3A8A] via-[#1D4ED8] to-[#155E75] px-6 py-4 text-sm font-semibold text-slate-50 shadow-[0_14px_30px_rgba(6,78,59,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(6,78,59,0.45)]";

    const getTaskRoute = (maintenanceType: string) => {
        return maintenanceType.toLowerCase().includes("correct")
            ? `/${locale}/operator/corrective`
            : `/${locale}/operator/preventive`;
    };

    const handleStartWorking = () => {
        const chooseSection = document.getElementById("operator-maintenance-entry");
        if (chooseSection) {
            chooseSection.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }

        if (nextTask) {
            const machineQuery = nextTask.machineId ? `?machine=${nextTask.machineId}` : "";
            router.push(`${getTaskRoute(nextTask.maintenanceType)}${machineQuery}`);
            return;
        }

        router.push(`/${locale}/operator/preventive`);
    };

    const handleStartTask = (task: OperatorTaskItem) => {
        const machineQuery = task.machineId ? `?machine=${task.machineId}` : "";
        router.push(`${getTaskRoute(task.maintenanceType)}${machineQuery}`);
    };

    const handleAvatarAction = (action: AvatarActionKey) => {
        if (action === "viewReports") {
            router.push(`/${locale}/operator/my-reports`);
            return;
        }
        if (action === "viewCalendar") {
            router.push(`/${locale}/operator/smart-maintenance-calendar`);
            return;
        }
        if (nextTask) {
            handleStartTask(nextTask);
            return;
        }
        handleStartWorking();
    };

    useEffect(() => {
        if (authLoading) {
            return;
        }
        if (!user?._id) {
            return;
        }

        let cancelled = false;

        const loadOperatorStats = async () => {
            try {
                const [workOrdersResponse, reportsResponse, calendarResponse, dashboardResponse] = await Promise.all([
                    fetchAllPaginated<WorkOrderItem>((pagination) => apiService.getMyWorkOrders(pagination)),
                    fetchAllPaginated<InterventionReportItem>((pagination) => apiService.getMyInterventionReports(pagination)),
                    apiService.getMyCalendarEvents({
                        view: "week",
                        date: new Date().toISOString().slice(0, 10),
                    }),
                    apiService.getOperatorDashboard(),
                ]);

                if (cancelled) {
                    return;
                }

                const normalizedWorkOrders = workOrdersResponse;
                const reportItems = reportsResponse;
                const calendarPayload = (calendarResponse.data as { items?: unknown } | undefined)?.items ?? calendarResponse.data;
                const calendarItems = normalizeApiItems<CalendarEventItem>(calendarPayload);

                setWorkOrders(normalizedWorkOrders);
                setReports(reportItems);
                setCalendarEvents(calendarItems);

                // Every counter/badge on this page comes from the shared
                // KpiService via GET /operator/dashboard — never recomputed
                // client-side from the (necessarily partial, week-scoped)
                // lists fetched above, which exist only to render the task
                // list and recent-activity cards.
                const dashboard = dashboardResponse.data as {
                    overdueCount: number;
                    dueTodayCount: number;
                    waitingValidationCount: number;
                    completedTodayCount: number;
                    assignedCount: number;
                    inProgressCount: number;
                    completedCount: number;
                };

                setKpiCounts({
                    overdueCount: dashboard.overdueCount,
                    dueTodayCount: dashboard.dueTodayCount,
                    waitingValidationCount: dashboard.waitingValidationCount,
                    completedTodayCount: dashboard.completedTodayCount,
                });
                setStats({
                    assigned: dashboard.assignedCount,
                    inProgress: dashboard.inProgressCount,
                    completed: dashboard.completedCount,
                });
            } catch (error) {
                console.error("Error loading operator stats", error);
                setStatsError(true);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadOperatorStats();

        return () => {
            cancelled = true;
        };
    }, [user?._id, authLoading]);

    if (loading) {
        return (
            <div className="operator-dashboard-theme flex min-h-screen items-center justify-center bg-background px-4">
                <div className="rounded-3xl border border-border bg-(--surface-elevated) px-8 py-10 text-center backdrop-blur-xl shadow-(--shadow-lg)">
                    <div className="mx-auto h-14 w-14 animate-spin rounded-full border-b-2 border-cyan-700"></div>
                    <div className="mt-4 text-sm font-medium text-text-secondary">{tCommon("loading")}</div>
                </div>
            </div>
        );
    }

    return (
        <ProtectedRoute requiredRole="operator">
            <DashboardLayout title={tOperator("title")}>
                <div className={`operator-dashboard-theme ${shellClassName}`}>
                    <div className="bento-grid gap-6">
                        <section className={`col-span-full rounded-[28px] p-5 md:p-8 ${softCardClassName}`}>
                            <div className="operator-welcome-stage grid gap-6 rounded-[26px] p-4 sm:p-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.95fr)] xl:items-center xl:p-6">
                                <div className="flex min-w-0 flex-col justify-center">
                                    <MiniAvatarAssistant
                                        userName={user?.nom_complet}
                                        role={user?.role}
                                        status={statsError ? "error" : "ready"}
                                        stats={{
                                            assigned: stats.assigned,
                                            dueToday: operatorTasks.filter((task) => !task.isOverdue).length,
                                            overdue: overdueTasksCount,
                                            waitingValidation: waitingValidationCount,
                                            inProgress: stats.inProgress,
                                        }}
                                        onAction={handleAvatarAction}
                                        variant="embedded"
                                    />
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className={`operator-context-card ${softCardClassName} flex min-h-36 items-center gap-4 rounded-3xl p-5 text-start`}>
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-cyan-500 to-blue-700 text-white shadow-[0_10px_24px_rgba(14,116,144,0.24)]">
                                            <ClockIcon className="h-5 w-5" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{tOperator("dashboard.currentShift")}</div>
                                            <div className="mt-1.5 truncate text-xl font-semibold tracking-[-0.02em] text-text-primary">{shiftLabel}</div>
                                            <div className="mt-1 text-xs text-text-secondary">{tOperator("dashboard.todayTasks")}</div>
                                        </div>
                                    </div>

                                    <div className={`operator-context-card ${softCardClassName} flex min-h-36 items-center gap-4 rounded-3xl p-5 text-start`}>
                                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-blue-600 to-indigo-800 text-white shadow-[0_10px_24px_rgba(30,64,175,0.24)]">
                                            <WrenchScrewdriverIcon className="h-5 w-5" aria-hidden="true" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{tOperator("dashboard.machineAssigned")}</div>
                                            <div className="mt-1.5 truncate text-xl font-semibold tracking-[-0.02em] text-text-primary">{derivedMachineLabel}</div>
                                            <div className="mt-1 text-xs text-text-secondary">{tOperator("machine")}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                                {analyticsCards.map((card) => {
                                    const Icon = card.icon;

                                    return (
                                        <div key={card.label} className={`${centeredMetricCardClassName} flex min-h-44 flex-col items-center justify-center`}>
                                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-700/25 bg-cyan-900/12 text-cyan-700 dark:text-cyan-500">
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">{card.label}</div>
                                            <div className={`mt-3 text-4xl font-semibold tracking-[-0.03em] ${card.textTone}`}>{card.value}</div>
                                            <div className={`mt-4 h-1.5 w-16 rounded-full bg-linear-to-r ${card.accent}`}></div>
                                        </div>
                                    );
                                })}

                                <div className={`${centeredMetricCardClassName} flex min-h-44 flex-col items-center justify-center`}>
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">{tOperator("dashboard.startMaintenance")}</div>
                                    <div className="mt-4 max-w-55 text-center text-sm leading-6 text-text-secondary">{nextTask ? `${nextTask.machineCode} • ${formatMaintenanceType(nextTask.maintenanceType, tOperator)}` : tOperator("dashboard.todaysTasksDescription")}</div>
                                    <button
                                        type="button"
                                        onClick={handleStartWorking}
                                        className={`mt-5 w-full max-w-55 ${actionButtonClassName}`}
                                    >
                                        {tOperator("dashboard.startMaintenance")}
                                        <ArrowRightIcon className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        </section>

                        <section className={`col-span-full rounded-[28px] p-6 md:p-8 ${softCardClassName}`}>
                            <div className="mb-6 text-center">
                                <div className="mb-2 text-xl font-semibold text-text-primary md:text-2xl">{tOperator("dashboard.aiAssistantTitle")}</div>
                                <p className="mx-auto mt-1 max-w-2xl text-sm leading-7 text-text-secondary">{tOperator("dashboard.aiAssistantSubtitle")}</p>
                            </div>

                            <AiAssistantPanel
                                machineId={nextTask?.machineId || undefined}
                                workOrderId={nextTask?.workOrderId || undefined}
                                faultCode={nextTask?.maintenanceType.toLowerCase().includes("correct") ? "" : undefined}
                            />
                        </section>

                        <section id="operator-maintenance-entry" className={`col-span-full rounded-[28px] p-6 md:p-8 ${softCardClassName}`}>
                            <div className="mb-6 text-center">
                                <div className="mb-2 text-2xl font-semibold text-text-primary md:text-3xl">{tOperator("dashboard.chooseMaintenance")}</div>
                                <p className="mx-auto mt-1 max-w-2xl text-sm leading-7 text-text-secondary">{tOperator("dashboard.todaysTasksDescription")}</p>
                            </div>

                            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 auto-rows-fr items-stretch">
                                <button
                                    onClick={() => router.push(`/${locale}/operator/preventive`)}
                                    className={`group h-full rounded-3xl p-6 text-center transition hover:-translate-y-1 ${softCardClassName}`}
                                >
                                    <div className="flex h-full flex-col items-center justify-center gap-5">
                                        <div className="flex h-16 w-16 items-center justify-center rounded-[20px] border border-cyan-700/30 bg-cyan-900/12 text-cyan-700 dark:text-cyan-500">
                                            <ClipboardDocumentListIcon className="h-7 w-7" />
                                        </div>
                                        <div>
                                            <div className="text-xl font-semibold text-text-primary">{tOperator("preventiveMaintenance")}</div>
                                            <p className="mt-3 max-w-md text-sm leading-7 text-text-secondary">{tOperator("dashboard.preventiveFlow")}</p>
                                        </div>
                                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-700 dark:text-cyan-500">
                                            {tOperator("dashboard.startWorking")}
                                            <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-1" />
                                        </div>
                                    </div>
                                </button>

                                <button
                                    onClick={() => router.push(`/${locale}/operator/corrective`)}
                                    className={`group h-full rounded-3xl p-6 text-center transition hover:-translate-y-1 ${softCardClassName}`}
                                >
                                    <div className="flex h-full flex-col items-center justify-center gap-5">
                                        <div className="flex h-16 w-16 items-center justify-center rounded-[20px] border border-cyan-700/30 bg-cyan-900/12 text-cyan-700 dark:text-cyan-500">
                                            <WrenchScrewdriverIcon className="h-7 w-7" />
                                        </div>
                                        <div>
                                            <div className="text-xl font-semibold text-text-primary">{tOperator("correctiveMaintenance")}</div>
                                            <p className="mt-3 max-w-md text-sm leading-7 text-text-secondary">{tOperator("dashboard.correctiveFlow")}</p>
                                        </div>
                                        <div className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-700 dark:text-cyan-500">
                                            {tOperator("dashboard.startWorking")}
                                            <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-1" />
                                        </div>
                                    </div>
                                </button>
                            </div>
                        </section>

                        <section className={`col-span-full rounded-[28px] p-6 md:p-8 ${softCardClassName}`}>
                            <div className="mb-6 flex flex-col items-center justify-center gap-3 text-center">
                                <div>
                                    <div className="mb-2 text-2xl font-semibold text-text-primary md:text-3xl">{tOperator("dashboard.aiAssistantTitle")}</div>
                                    <p className="mx-auto mt-1 max-w-2xl text-sm leading-7 text-text-secondary">{tOperator("dashboard.aiAssistantSubtitle")}</p>
                                </div>
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-700/25 bg-cyan-900/12 text-cyan-700 dark:text-cyan-500">
                                    <SparklesIcon className="h-5 w-5" />
                                </div>
                            </div>

                            <AiAssistantPanel
                                machineId={nextTask?.machineId || undefined}
                                workOrderId={nextTask?.workOrderId || undefined}
                            />
                        </section>

                        <section className={`col-span-full rounded-[28px] p-6 md:p-8 ${softCardClassName}`}>
                            <div className="mb-6 flex flex-col items-center justify-center gap-3 text-center">
                                <div>
                                    <div className="mb-2 text-2xl font-semibold text-text-primary md:text-3xl">{tOperator("dashboard.todaysTasks")}</div>
                                    <p className="mx-auto mt-1 max-w-2xl text-sm leading-7 text-text-secondary">{operatorTasks.length === 0 ? tOperator("dashboard.noTasksDescription") : tOperator("dashboard.todaysTasksDescription")}</p>
                                </div>
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-700/25 bg-cyan-900/12 text-cyan-700 dark:text-cyan-500">
                                    <ClockIcon className="h-5 w-5" />
                                </div>
                            </div>

                            {operatorTasks.length === 0 ? (
                                <div className={`${centeredMetricCardClassName} px-6 py-12`}>
                                    <div className="text-lg font-semibold text-text-primary">{tOperator("dashboard.noTasksTitle")}</div>
                                    <div className="mt-3 text-sm leading-7 text-text-secondary">{tOperator("dashboard.noTasksDescription")}</div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="hidden grid-cols-[1.3fr_1fr_0.9fr_0.9fr_0.9fr] gap-4 rounded-[20px] border border-border bg-(--surface-secondary) px-5 py-4 text-center text-xs font-semibold uppercase tracking-[0.16em] text-text-muted md:grid">
                                        <div>{tOperator("machine")}</div>
                                        <div>{tOperator("smartCalendar.maintenanceType")}</div>
                                        <div>{tCommon("priority")}</div>
                                        <div>{tOperator("smartCalendar.due")}</div>
                                        <div>{tOperator("smartCalendar.start")}</div>
                                    </div>

                                    {operatorTasks.map((task) => {
                                        const dueDate = new Date(task.dueDate);
                                        const dueLabel = task.isOverdue
                                            ? tCommon("now")
                                            : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(dueDate);

                                        return (
                                            <div
                                                key={task.id}
                                                className={`grid gap-4 rounded-3xl px-5 py-5 md:grid-cols-[1.3fr_1fr_0.9fr_0.9fr_0.9fr] md:items-center ${softCardClassName}`}
                                            >
                                                <div className="flex flex-col items-center justify-center text-center">
                                                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted md:hidden">{tOperator("machine")}</div>
                                                    <div className="mt-1 text-base font-semibold text-text-primary">{task.machineCode}</div>
                                                </div>
                                                <div className="flex flex-col items-center justify-center text-center">
                                                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted md:hidden">{tOperator("smartCalendar.maintenanceType")}</div>
                                                    <div className="mt-1 text-sm font-medium text-text-secondary">{formatMaintenanceType(task.maintenanceType, tOperator)}</div>
                                                </div>
                                                <div className="flex flex-col items-center justify-center text-center">
                                                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted md:hidden">{tCommon("priority")}</div>
                                                    <div className={`mt-1 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${task.isOverdue ? "border-rose-400/35 bg-rose-500/12 text-rose-200" : "border-cyan-700/40 bg-cyan-900/18 text-cyan-700 dark:text-cyan-300"}`}>
                                                        {formatPriority(task.priority)}
                                                    </div>
                                                </div>
                                                <div className="flex flex-col items-center justify-center text-center">
                                                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted md:hidden">{tOperator("smartCalendar.due")}</div>
                                                    <div className="mt-1 text-sm font-medium text-text-secondary">{dueLabel}</div>
                                                </div>
                                                <div className="flex items-center justify-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStartTask(task)}
                                                        className={`w-full ${actionButtonClassName}`}
                                                    >
                                                        {tOperator("smartCalendar.start")}
                                                        <ArrowRightIcon className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                        <section className={`col-span-full rounded-[28px] p-6 md:p-8 ${softCardClassName}`}>
                            <div className="mb-6 flex flex-col items-center justify-center gap-3 text-center">
                                <div>
                                    <div className="mb-2 text-2xl font-semibold text-text-primary md:text-3xl">{tOperator("recentActivity.title")}</div>
                                    <p className="mx-auto mt-1 max-w-2xl text-sm leading-7 text-text-secondary">{tOperator("dashboard.recentActivityDescription")}</p>
                                </div>
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-700/25 bg-cyan-900/12 text-cyan-700 dark:text-cyan-500">
                                    <ClipboardDocumentListIcon className="h-5 w-5" />
                                </div>
                            </div>

                            {latestReport ? (() => {
                                const workOrder = workOrders.find((order) => order._id === extractId(latestReport.ot_id));
                                const machineLabel = workOrder ? extractMachineLabel(workOrder.machine_id) : tOperator("dashboard.emptyValue");
                                const maintenanceType = formatMaintenanceType(workOrder?.type_maintenance, tOperator);
                                const submittedAt = latestReport.date_fin || latestReport.date_debut;

                                return (
                                    <div className={`rounded-3xl p-6 ${softCardClassName}`}>
                                        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr] xl:items-center">
                                            <div className="flex flex-col items-center justify-center text-center">
                                                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{tOperator("dashboard.lastSubmittedReport")}</div>
                                                <div className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-text-primary">{maintenanceType}</div>
                                                <div className="mt-2 text-sm text-text-secondary">{machineLabel}</div>
                                            </div>

                                            <div className="grid gap-4 md:grid-cols-2">
                                                <div className={`${centeredMetricCardClassName} flex min-h-36.5 flex-col items-center justify-center`}>
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{tOperator("smartCalendar.status")}</div>
                                                    <div className="mt-3 text-sm font-semibold text-text-primary">{formatReportStatus(latestReport.validation_responsable, tOperator)}</div>
                                                </div>
                                                <div className={`${centeredMetricCardClassName} flex min-h-36.5 flex-col items-center justify-center`}>
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{tOperator("dashboard.submissionDate")}</div>
                                                    <div className="mt-3 text-sm font-semibold text-text-primary">
                                                        {submittedAt
                                                            ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(submittedAt))
                                                            : tOperator("dashboard.emptyValue")}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-center pt-2 xl:col-span-full">
                                                <button
                                                    type="button"
                                                    onClick={() => router.push(`/${locale}/operator/my-reports`)}
                                                    className={actionButtonClassName}
                                                >
                                                    {tOperator("smartCalendar.viewHistory")}
                                                    <ArrowRightIcon className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })() : (
                                <div className={`${centeredMetricCardClassName} px-6 py-12 text-sm text-text-secondary`}>
                                    {tOperator("dashboard.noRecentReports")}
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            </DashboardLayout>
        </ProtectedRoute>
    );
}
