"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { apiService } from "@/services/api";
import { useTranslations } from "next-intl";
import { fetchAllPaginated } from "@/services/pagination";
import {
  CalendarDaysIcon,
  FunnelIcon,
  ClockIcon,
  WrenchScrewdriverIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentCheckIcon,
} from "@heroicons/react/24/outline";

type CalendarView = "day" | "week" | "month" | "year" | "timeline";

type CalendarColor = "blue" | "green" | "orange" | "red" | "purple";

interface CalendarEvent {
  id: string;
  workOrderId: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  startDate: string;
  endDate?: string;
  color: CalendarColor;
  machine: {
    id: string;
    code: string;
    model?: string;
    typeId?: string;
    typeName?: string;
  };
  module?: {
    id: string;
    code?: string;
    location?: string;
  };
  frequency: {
    value?: number;
    unit?: string;
    normalizedUnit: string;
    label: string;
  };
  assignedOperator?: {
    id: string;
    name: string;
  };
  assignedTechnician?: {
    id: string;
    name: string;
  };
  reminderStage: string;
}

interface CalendarEventDetails {
  id: string;
  machine: {
    id: string;
    code: string;
    model?: string;
  };
  machineType: {
    id: string;
    name: string;
  };
  module: {
    id: string;
    code?: string;
    location?: string;
  };
  maintenanceType: string;
  description: string;
  frequency: {
    value?: number;
    unit?: string;
    label: string;
  };
  assignedOperator?: {
    id: string;
    name: string;
  };
  currentStatus: string;
  spareParts: Array<{
    id: string;
    name: string;
    quantity: number;
  }>;
  manuals: Array<{
    id: string;
    type?: string;
    fileName: string;
    filePath: string;
  }>;
  history: Array<{
    id: string;
    reportId: string;
    start: string;
    end: string;
    action?: string;
    status: string;
  }>;
  actions: {
    canStart: boolean;
    canComplete: boolean;
    canGenerateReport: boolean;
    canOpenManual: boolean;
    canViewHistory: boolean;
  };
}

interface WidgetData {
  counts?: {
    today: number;
    thisWeek: number;
    nextWeek: number;
    nextMonth: number;
    overdue: number;
    waitingValidation: number;
  };
}

interface NotificationCard {
  key: string;
  title: string;
  count: number;
  severity: "info" | "warning" | "danger" | "success" | "purple";
}

interface FilterState {
  machineId: string;
  machineTypeId: string;
  maintenanceType: string;
  status: string;
  priority: string;
  month: string;
  week: string;
  year: string;
}

interface SelectOption {
  id: string;
  label: string;
  machineTypeId?: string;
}

const VIEW_OPTIONS: Array<{ key: CalendarView; labelKey: string }> = [
  { key: "day", labelKey: "dayView" },
  { key: "week", labelKey: "weekView" },
  { key: "month", labelKey: "monthView" },
  { key: "year", labelKey: "yearView" },
  { key: "timeline", labelKey: "timelineView" },
];

function colorClass(color: CalendarColor): string {
  if (color === "green") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (color === "orange") return "border-amber-200 bg-amber-50 text-amber-900";
  if (color === "red") return "border-red-200 bg-red-50 text-red-900";
  if (color === "purple") return "border-violet-200 bg-violet-50 text-violet-900";
  return "border-blue-200 bg-blue-50 text-blue-900";
}

function severityClass(level: NotificationCard["severity"]): string {
  if (level === "success") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (level === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  if (level === "danger") return "border-red-200 bg-red-50 text-red-900";
  if (level === "purple") return "border-violet-200 bg-violet-50 text-violet-900";
  return "border-blue-200 bg-blue-50 text-blue-900";
}

function statusPillClass(status: string): string {
  const normalized = (status || "").toLowerCase();
  if (normalized === "completed" || normalized === "validated") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (normalized === "waiting_validation") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }
  if (normalized === "overdue") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (normalized === "in_progress") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatReminderStage(value: string): string {
  if (!value) return "No stage";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function SmartMaintenanceCalendarPage() {
  const tCalendar = useTranslations("dashboard.operator.smartCalendar");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const params = useParams();
  const locale = Array.isArray(params?.locale)
    ? params.locale[0]
    : params?.locale || "en";

  const [loading, setLoading] = useState(true);
  const [widgetLoading, setWidgetLoading] = useState(true);
  const [view, setView] = useState<CalendarView>("month");
  const [date, setDate] = useState<string>(toInputDate(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [timeline, setTimeline] = useState<Record<string, CalendarEvent[]>>({});
  const [widgetData, setWidgetData] = useState<WidgetData>({});
  const [notificationCards, setNotificationCards] = useState<NotificationCard[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [selectedEventDetails, setSelectedEventDetails] = useState<CalendarEventDetails | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [machineFilterOptions, setMachineFilterOptions] = useState<SelectOption[]>([]);
  const [machineTypeFilterOptions, setMachineTypeFilterOptions] = useState<SelectOption[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    machineId: "",
    machineTypeId: "",
    maintenanceType: "",
    status: "",
    priority: "",
    month: "",
    week: "",
    year: "",
  });

  const machineOptions = useMemo(() => {
    if (machineFilterOptions.length > 0) {
      if (!filters.machineTypeId) {
        return machineFilterOptions;
      }

      return machineFilterOptions.filter(
        (machine) => machine.machineTypeId === filters.machineTypeId,
      );
    }

    const map = new Map<string, SelectOption>();
    events.forEach((event) => {
      map.set(event.machine.id, {
        id: event.machine.id,
        label: event.machine.code || event.machine.id,
        machineTypeId: event.machine.typeId,
      });
    });

    const eventMachines = Array.from(map.values());
    if (!filters.machineTypeId) {
      return eventMachines;
    }

    return eventMachines.filter(
      (machine) => machine.machineTypeId === filters.machineTypeId,
    );
  }, [events, machineFilterOptions, filters.machineTypeId]);

  const machineTypeOptions = useMemo(() => {
    if (machineTypeFilterOptions.length > 0) {
      return machineTypeFilterOptions;
    }

    const map = new Map<string, string>();
    events.forEach((event) => {
      if (event.machine.typeId && event.machine.typeName) {
        map.set(event.machine.typeId, event.machine.typeName);
      }
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [events, machineTypeFilterOptions]);

  useEffect(() => {
    async function loadFilterOptions() {
      try {
        const [machines, machineTypes] = await Promise.all([
          fetchAllPaginated<{
            _id?: string;
            id?: string;
            machine_id?: string;
            machine_code?: string;
            model?: string;
            type_id?: string | { _id?: string; id?: string };
          }>((pagination) => apiService.getMyMachines(pagination)),
          fetchAllPaginated<{
            _id?: string;
            id?: string;
            name?: string;
            machine_type?: string;
            code?: string;
          }>((pagination) => apiService.getOperatorMachineTypes(pagination)),
        ]);

        setMachineFilterOptions(
          machines.flatMap((machine) => {
              const id = machine._id || machine.id || "";
              if (!id) return [];
              const machineTypeId =
                typeof machine.type_id === "string"
                  ? machine.type_id
                  : machine.type_id?._id || machine.type_id?.id || "";
              const label =
                machine.machine_id ||
                machine.machine_code ||
                machine.model ||
                id;
              return [{ id, label, machineTypeId } satisfies SelectOption];
            }),
        );

        setMachineTypeFilterOptions(
          machineTypes.flatMap((machineType) => {
              const id = machineType._id || machineType.id || "";
              if (!id) return [];
              const label = machineType.name || machineType.machine_type || machineType.code || id;
              return [{ id, label } satisfies SelectOption];
            }),
        );
      } catch (error) {
        console.error("Failed to load smart calendar filter options", error);
      }
    }

    void loadFilterOptions();
  }, []);

  useEffect(() => {
    if (!filters.machineId) {
      return;
    }

    const hasSelectedMachine = machineOptions.some(
      (machine) => machine.id === filters.machineId,
    );

    if (!hasSelectedMachine) {
      setFilters((prev) => ({ ...prev, machineId: "" }));
    }
  }, [filters.machineId, machineOptions]);

  function extractApiErrorMessage(error: unknown, fallback: string): string {
    const apiError = error as {
      response?: { status?: number; data?: { message?: string | string[] } };
    };
    const raw = apiError?.response?.data?.message;
    if (Array.isArray(raw) && raw.length) {
      return raw.join(" ");
    }
    if (typeof raw === "string" && raw.trim()) {
      return raw;
    }
    return fallback;
  }

  function showNotification(type: "success" | "error", message: string): void {
    setNotification({ type, message });
  }

  useEffect(() => {
    if (!notification) return;
    const timeout = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timeout);
  }, [notification]);

  useEffect(() => {
    async function loadCalendar() {
      try {
        setLoading(true);
        const params: Record<string, string> = {
          view,
          date,
        };

        (Object.keys(filters) as Array<keyof FilterState>).forEach((key) => {
          const value = filters[key];
          if (value) {
            params[key] = value;
          }
        });

        const response = await apiService.getMyCalendarEvents(params);
        setEvents((response.data?.items || []) as CalendarEvent[]);

        if (view === "timeline") {
          const timelineResponse = await apiService.getMyCalendarTimeline({ date, machineId: filters.machineId || undefined });
          setTimeline((timelineResponse.data || {}) as Record<string, CalendarEvent[]>);
        } else {
          setTimeline({});
        }
      } catch (error) {
        console.error("Failed to load smart maintenance calendar", error);
        setEvents([]);
        setTimeline({});
        showNotification("error", extractApiErrorMessage(error, tCommon("error")));
      } finally {
        setLoading(false);
      }
    }

    void loadCalendar();
  }, [date, filters, view]);

  useEffect(() => {
    async function loadWidgetAndNotifications() {
      try {
        setWidgetLoading(true);
        const [widgetResponse, notificationResponse] = await Promise.all([
          apiService.getMyCalendarWidget(),
          apiService.getMyCalendarNotifications(),
        ]);
        setWidgetData((widgetResponse.data || {}) as WidgetData);
        setNotificationCards((notificationResponse.data || []) as NotificationCard[]);
      } catch (error) {
        console.error("Failed to load calendar widget and notifications", error);
        setWidgetData({});
        setNotificationCards([]);
      } finally {
        setWidgetLoading(false);
      }
    }

    void loadWidgetAndNotifications();
  }, []);

  useEffect(() => {
    async function loadEventDetails() {
      if (!selectedEventId) {
        setSelectedEventDetails(null);
        return;
      }

      try {
        setDrawerLoading(true);
        const response = await apiService.getMyCalendarEventDetails(selectedEventId);
        setSelectedEventDetails((response.data || null) as CalendarEventDetails | null);
      } catch (error) {
        console.error("Failed to load calendar event details", error);
        setSelectedEventDetails(null);
        showNotification("error", extractApiErrorMessage(error, tCommon("error")));
      } finally {
        setDrawerLoading(false);
      }
    }

    void loadEventDetails();
  }, [selectedEventId]);

  async function runEventAction(action: "start" | "complete") {
    if (!selectedEventDetails?.id) return;

    try {
      setActionLoading(true);
      if (action === "start") {
        await apiService.startMyCalendarEvent(selectedEventDetails.id);
      } else {
        await apiService.completeMyCalendarEvent(selectedEventDetails.id);
      }

      const refreshedDetails = await apiService.getMyCalendarEventDetails(selectedEventDetails.id);
      setSelectedEventDetails((refreshedDetails.data || null) as CalendarEventDetails | null);

      const refreshedEvents = await apiService.getMyCalendarEvents({ view, date, ...filters });
      setEvents((refreshedEvents.data?.items || []) as CalendarEvent[]);
      showNotification(
        "success",
        action === "start" ? tCalendar("startSuccess") : tCalendar("completeSuccess"),
      );
    } catch (error) {
      console.error("Failed to run maintenance action", error);
      showNotification("error", extractApiErrorMessage(error, tCommon("error")));
    } finally {
      setActionLoading(false);
    }
  }

  function openManual() {
    const firstManual = selectedEventDetails?.manuals?.[0];
    if (!firstManual?.filePath) return;
    window.open(firstManual.filePath, "_blank", "noopener,noreferrer");
  }

  const timelineOrder: Array<{ key: string; labelKey: string }> = [
    { key: "today", labelKey: "todayLabel" },
    { key: "tomorrow", labelKey: "tomorrowLabel" },
    { key: "nextWeek", labelKey: "nextWeek" },
    { key: "nextMonth", labelKey: "nextMonth" },
    { key: "sixMonths", labelKey: "sixMonthsLabel" },
    { key: "oneYear", labelKey: "oneYearLabel" },
  ];

  const widgetCounts = widgetData.counts || {
    today: 0,
    thisWeek: 0,
    nextWeek: 0,
    nextMonth: 0,
    overdue: 0,
    waitingValidation: 0,
  };

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={tCalendar("title")}>
        <div className="bento-grid">
          {notification ? (
            <div
              className={`col-span-full panel border ${
                notification.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {notification.message}
            </div>
          ) : null}

          <div className="col-span-full rounded-2xl border border-slate-200 bg-linear-to-br from-white via-slate-50 to-blue-50 p-5 shadow-sm">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                  <CalendarDaysIcon className="h-4 w-4" />
                  {tCalendar("title")}
                </div>
                <div className="text-2xl font-bold tracking-tight text-slate-900">{tCalendar("title")}</div>
                <p className="mt-1 max-w-3xl text-sm text-slate-600">{tCalendar("description")}</p>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="smart-calendar-date" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {tCalendar("referenceDate")}
                </label>
                <input
                  id="smart-calendar-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{tCalendar("todayMaintenance")}</div>
                <div className="mt-1 text-2xl font-bold text-slate-800">{widgetCounts.today}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{tCalendar("thisWeek")}</div>
                <div className="mt-1 text-2xl font-bold text-slate-800">{widgetCounts.thisWeek}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{tCalendar("nextWeek")}</div>
                <div className="mt-1 text-2xl font-bold text-slate-800">{widgetCounts.nextWeek}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{tCalendar("nextMonth")}</div>
                <div className="mt-1 text-2xl font-bold text-slate-800">{widgetCounts.nextMonth}</div>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-900">
                <div className="text-xs">{tCalendar("overdue")}</div>
                <div className="mt-1 text-2xl font-bold">{widgetCounts.overdue}</div>
              </div>
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-violet-900">
                <div className="text-xs">{tCalendar("waitingValidation")}</div>
                <div className="mt-1 text-2xl font-bold">{widgetCounts.waitingValidation}</div>
              </div>
            </div>
          </div>

          <div className="col-span-full panel">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <FunnelIcon className="h-4 w-4" />
                {tCalendar("filtersAndViews")}
              </div>
              <button
                type="button"
                onClick={() =>
                  setFilters({
                    machineId: "",
                    machineTypeId: "",
                    maintenanceType: "",
                    status: "",
                    priority: "",
                    month: "",
                    week: "",
                    year: "",
                  })
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-100"
              >
                {tCalendar("resetFilters")}
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {VIEW_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  onClick={() => setView(option.key)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    view === option.key
                      ? "bg-slate-900 text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {tCalendar(option.labelKey)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-5">
              <select
                value={filters.machineId}
                onChange={(event) => setFilters((prev) => ({ ...prev, machineId: event.target.value }))}
                title={tCalendar("machine")}
                aria-label={tCalendar("machine")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                <option value="">{tCalendar("machine")}</option>
                {machineOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={filters.machineTypeId}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    machineTypeId: event.target.value,
                  }))
                }
                title={tCalendar("machineType")}
                aria-label={tCalendar("machineType")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                <option value="">{tCalendar("machineType")}</option>
                {machineTypeOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>

              <select
                value={filters.maintenanceType}
                onChange={(event) => setFilters((prev) => ({ ...prev, maintenanceType: event.target.value }))}
                title={tCalendar("maintenanceType")}
                aria-label={tCalendar("maintenanceType")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                <option value="">{tCalendar("maintenanceType")}</option>
                <option value="preventive">{tCalendar("preventive")}</option>
                <option value="corrective">{tCalendar("corrective")}</option>
              </select>

              <select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                title={tCalendar("status")}
                aria-label={tCalendar("status")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
              >
                <option value="">{tCalendar("status")}</option>
                <option value="pending">{tCalendar("scheduled")}</option>
                <option value="in_progress">{tCalendar("inProgress")}</option>
                <option value="completed">{tCalendar("completed")}</option>
                <option value="waiting_validation">{tCalendar("waitingValidation")}</option>
                <option value="validated">{tCalendar("validated")}</option>
              </select>
            </div>
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{tCalendar("calendarEvents")}</div>
            {loading ? (
              <div className="text-sm text-slate-500">{tCommon("loading")}</div>
            ) : view === "timeline" ? (
              <div className="space-y-4">
                {timelineOrder.map((group) => (
                  <div key={group.key}>
                    <div className="mb-2 text-sm font-semibold text-slate-700">{tCalendar(group.labelKey)}</div>
                    <div className="space-y-2">
                      {(timeline[group.key] || []).length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">
                          {tCalendar("noItem")}
                        </div>
                      ) : (
                        (timeline[group.key] || []).map((event) => (
                          <button
                            key={event.id}
                            onClick={() => setSelectedEventId(event.workOrderId)}
                            className={`w-full rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow ${colorClass(event.color)}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-semibold leading-snug">{event.title}</div>
                              <div className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusPillClass(event.status)}`}>
                                {event.status === "in_progress"
                                  ? tCalendar("inProgress")
                                  : event.status === "validated"
                                    ? tCalendar("validated")
                                    : event.status === "completed"
                                      ? tCalendar("completed")
                                      : event.status === "waiting_validation"
                                        ? tCalendar("waitingValidation")
                                        : event.status}
                              </div>
                            </div>
                            <div className="mt-2 text-sm">
                              {event.machine.code} · {new Date(event.dueDate).toLocaleString(locale)}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => setSelectedEventId(event.workOrderId)}
                    className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow ${colorClass(event.color)}`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="line-clamp-2 font-semibold leading-snug">{event.title}</div>
                      <div className="rounded-full border border-current px-2 py-0.5 text-xs font-semibold uppercase">
                        {event.priority || tCalendar("noPriority")}
                      </div>
                    </div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusPillClass(event.status)}`}>
                        {event.status === "in_progress"
                          ? tCalendar("inProgress")
                          : event.status === "validated"
                            ? tCalendar("validated")
                            : event.status === "completed"
                              ? tCalendar("completed")
                              : event.status === "waiting_validation"
                                ? tCalendar("waitingValidation")
                                : event.status}
                      </span>
                      <span className="rounded-full border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                        {event.type === "preventive" ? tCalendar("preventive") : tCalendar("corrective")}
                      </span>
                    </div>
                    <div className="space-y-1 text-sm">
                      <div><span className="font-medium text-slate-700">{tCalendar("machine")}:</span> {event.machine.code || tCommon("notAvailable")}</div>
                      <div><span className="font-medium text-slate-700">{tCalendar("frequency")}:</span> {event.frequency.label}</div>
                      <div><span className="font-medium text-slate-700">{tCalendar("due")}:</span> {new Date(event.dueDate).toLocaleString(locale)}</div>
                    </div>
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      <ClockIcon className="h-3.5 w-3.5" />
                      {formatReminderStage(event.reminderStage)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{tCalendar("notificationCenter")}</div>
            {widgetLoading ? (
              <div className="text-sm text-slate-500">{tCommon("loading")}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {notificationCards.map((card) => (
                  <div key={card.key} className={`rounded-xl border p-4 ${severityClass(card.severity)}`}>
                    <div className="text-sm font-semibold leading-tight">{card.title}</div>
                    <div className="mt-2 text-3xl font-bold">{card.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{tCalendar("dashboardWidget")}</div>
            {widgetLoading ? (
              <div className="text-sm text-slate-500">{tCommon("loading")}</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="inline-flex items-center gap-1 text-xs text-slate-500"><WrenchScrewdriverIcon className="h-3.5 w-3.5" />{tCalendar("todayMaintenance")}</div>
                  <div className="text-2xl font-bold text-slate-800">{widgetData.counts?.today ?? 0}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs text-slate-500">{tCalendar("thisWeek")}</div>
                  <div className="text-2xl font-bold text-slate-800">{widgetData.counts?.thisWeek ?? 0}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs text-slate-500">{tCalendar("nextWeek")}</div>
                  <div className="text-2xl font-bold text-slate-800">{widgetData.counts?.nextWeek ?? 0}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-xs text-slate-500">{tCalendar("nextMonth")}</div>
                  <div className="text-2xl font-bold text-slate-800">{widgetData.counts?.nextMonth ?? 0}</div>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-900">
                  <div className="inline-flex items-center gap-1 text-xs"><ExclamationTriangleIcon className="h-3.5 w-3.5" />{tCalendar("overdue")}</div>
                  <div className="text-2xl font-bold">{widgetData.counts?.overdue ?? 0}</div>
                </div>
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-violet-900">
                  <div className="inline-flex items-center gap-1 text-xs"><ClipboardDocumentCheckIcon className="h-3.5 w-3.5" />{tCalendar("waitingValidation")}</div>
                  <div className="text-2xl font-bold">{widgetData.counts?.waitingValidation ?? 0}</div>
                </div>
              </div>
            )}
          </div>

          {selectedEventId ? (
            <div className="col-span-full panel border-2 border-slate-900">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="card-title">{tCalendar("maintenanceDetails")}</div>
                <button
                  onClick={() => {
                    setSelectedEventId("");
                    setSelectedEventDetails(null);
                    setShowHistory(false);
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700"
                >
                  {tCommon("close")}
                </button>
              </div>

              {drawerLoading || !selectedEventDetails ? (
                <div className="text-sm text-slate-500">{tCommon("loading")}</div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div><strong>{tCalendar("machine")}:</strong> {selectedEventDetails.machine.code || tCommon("notAvailable")}</div>
                    <div><strong>{tCalendar("machineType")}:</strong> {selectedEventDetails.machineType.name || tCommon("notAvailable")}</div>
                    <div><strong>{tCalendar("module")}:</strong> {selectedEventDetails.module.code || selectedEventDetails.module.location || tCommon("notAvailable")}</div>
                    <div><strong>{tCalendar("maintenanceType")}:</strong> {selectedEventDetails.maintenanceType === "preventive" ? tCalendar("preventive") : tCalendar("corrective")}</div>
                    <div><strong>{tCalendar("descriptionLabel")}:</strong> {selectedEventDetails.description || tCommon("notAvailable")}</div>
                    <div><strong>{tCalendar("frequency")}:</strong> {selectedEventDetails.frequency.label || tCommon("notAvailable")}</div>
                    <div><strong>{tCalendar("assignedOperator")}:</strong> {selectedEventDetails.assignedOperator?.name || tCommon("notAvailable")}</div>
                    <div><strong>{tCalendar("currentStatus")}:</strong> {selectedEventDetails.currentStatus === "in_progress" ? tCalendar("inProgress") : selectedEventDetails.currentStatus === "validated" ? tCalendar("validated") : selectedEventDetails.currentStatus === "completed" ? tCalendar("completed") : selectedEventDetails.currentStatus === "waiting_validation" ? tCalendar("waitingValidation") : selectedEventDetails.currentStatus}</div>
                  </div>

                  <div>
                    <div className="mb-1 text-sm font-semibold text-slate-700">{tCalendar("spareParts")}</div>
                    {selectedEventDetails.spareParts.length === 0 ? (
                      <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
                    ) : (
                      <div className="space-y-1">
                        {selectedEventDetails.spareParts.map((part) => (
                          <div key={part.id} className="text-sm">
                            {part.name} · Qty {part.quantity}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void runEventAction("start")}
                      disabled={actionLoading || !selectedEventDetails.actions.canStart}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tCalendar("start")}
                    </button>
                    <button
                      onClick={() => void runEventAction("complete")}
                      disabled={actionLoading || !selectedEventDetails.actions.canComplete}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tCalendar("complete")}
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedEventDetails) return;
                        const base = `/${locale}/operator`;
                        if (selectedEventDetails.maintenanceType === "preventive") {
                          router.push(`${base}/preventive?workOrderId=${selectedEventDetails.id}`);
                          return;
                        }
                        router.push(`${base}/report-problem?workOrderId=${selectedEventDetails.id}`);
                      }}
                      disabled={!selectedEventDetails.actions.canGenerateReport}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tCalendar("generateReportAction")}
                    </button>
                    <button
                      onClick={openManual}
                      disabled={!selectedEventDetails.actions.canOpenManual}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tCalendar("openManualAction")}
                    </button>
                    <button
                      onClick={() => setShowHistory((prev) => !prev)}
                      disabled={!selectedEventDetails.actions.canViewHistory}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {tCalendar("viewHistory")}
                    </button>
                  </div>

                  {showHistory ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 text-sm font-semibold text-slate-700">{tCalendar("history")}</div>
                      {selectedEventDetails.history.length === 0 ? (
                        <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
                      ) : (
                        <div className="space-y-2">
                          {selectedEventDetails.history.map((entry) => (
                            <div key={entry.id} className="rounded-lg border border-slate-200 bg-white p-2 text-sm">
                              <div className="font-semibold">{entry.reportId}</div>
                              <div>{new Date(entry.start).toLocaleString(locale)} - {new Date(entry.end).toLocaleString(locale)}</div>
                              <div>{tCalendar("status")}: {entry.status}</div>
                              <div>{entry.action || tCommon("notAvailable")}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <div className="col-span-full text-xs text-slate-500">
            {tCalendar("operatorFlowNote")}
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
