"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CalendarDaysIcon,
  FunnelIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { apiService } from "@/services/api";
import { useTranslations } from "next-intl";
import { fetchAllPaginated } from "@/services/pagination";
import { extractApiErrorMessage } from "@/services/apiErrors";
import { isCorrectiveMaintenanceType } from "@/services/maintenanceType";

type CalendarView = "day" | "week" | "month";

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
  color: string;
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
];

function toInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function resetFilters(): FilterState {
  return {
    machineId: "",
    machineTypeId: "",
    maintenanceType: "",
    status: "",
    priority: "",
    month: "",
    week: "",
    year: "",
  };
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
  const [view, setView] = useState<CalendarView>("day");
  const [date, setDate] = useState<string>(toInputDate(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [selectedEventDetails, setSelectedEventDetails] = useState<CalendarEventDetails | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [machineFilterOptions, setMachineFilterOptions] = useState<SelectOption[]>([]);
  const [machineTypeFilterOptions, setMachineTypeFilterOptions] = useState<SelectOption[]>([]);
  const [filters, setFilters] = useState<FilterState>(resetFilters);

  const machineOptions = useMemo(() => {
    if (machineFilterOptions.length > 0) {
      if (!filters.machineTypeId) return machineFilterOptions;
      return machineFilterOptions.filter((machine) => machine.machineTypeId === filters.machineTypeId);
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
    if (!filters.machineTypeId) return eventMachines;
    return eventMachines.filter((machine) => machine.machineTypeId === filters.machineTypeId);
  }, [events, filters.machineTypeId, machineFilterOptions]);

  const machineTypeOptions = useMemo(() => {
    if (machineTypeFilterOptions.length > 0) return machineTypeFilterOptions;

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
            return [{
              id,
              label: machine.machine_id || machine.machine_code || machine.model || id,
              machineTypeId,
            } satisfies SelectOption];
          }),
        );

        setMachineTypeFilterOptions(
          machineTypes.flatMap((machineType) => {
            const id = machineType._id || machineType.id || "";
            if (!id) return [];
            return [{ id, label: machineType.name || machineType.machine_type || machineType.code || id }];
          }),
        );
      } catch (error) {
        console.error("Failed to load smart calendar filter options", error);
      }
    }

    void loadFilterOptions();
  }, []);

  useEffect(() => {
    if (!filters.machineId) return;
    const hasSelectedMachine = machineOptions.some((machine) => machine.id === filters.machineId);
    if (!hasSelectedMachine) {
      setFilters((prev) => ({ ...prev, machineId: "" }));
    }
  }, [filters.machineId, machineOptions]);

  function showNotification(type: "success" | "error", message: string): void {
    setNotification({ type, message });
  }

  useEffect(() => {
    if (!notification) return;
    const timeout = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timeout);
  }, [notification]);

  const refreshEvents = useCallback(async (): Promise<void> => {
    const paramsToSend: Record<string, string> = { view, date };
    (Object.keys(filters) as Array<keyof FilterState>).forEach((key) => {
      if (filters[key]) paramsToSend[key] = filters[key];
    });

    const response = await apiService.getMyCalendarEvents(paramsToSend);
    setEvents((response.data?.items || []) as CalendarEvent[]);
  }, [date, filters, view]);

  useEffect(() => {
    async function loadCalendar() {
      try {
        setLoading(true);
        await refreshEvents();
      } catch (error) {
        console.error("Failed to load smart maintenance calendar", error);
        setEvents([]);
        showNotification("error", extractApiErrorMessage(error, tCommon("error")));
      } finally {
        setLoading(false);
      }
    }

    void loadCalendar();
  }, [refreshEvents, tCommon]);

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
  }, [selectedEventId, tCommon]);

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
      await refreshEvents();
      showNotification("success", action === "start" ? tCalendar("startSuccess") : tCalendar("completeSuccess"));
    } catch (error) {
      console.error("Failed to run maintenance action", error);
      showNotification("error", extractApiErrorMessage(error, tCommon("error")));
    } finally {
      setActionLoading(false);
    }
  }

  async function quickStartEvent(event: CalendarEvent): Promise<void> {
    try {
      setActionLoading(true);
      await apiService.startMyCalendarEvent(event.workOrderId);
      await refreshEvents();
      showNotification("success", tCalendar("startSuccess"));
    } catch (error) {
      console.error("Failed to start maintenance task", error);
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

  function isEventWaitingValidation(event: CalendarEvent): boolean {
    return event.status === "waiting_validation";
  }

  function isEventCompleted(event: CalendarEvent): boolean {
    return event.status === "completed" || event.status === "validated";
  }

  function isEventOverdue(event: CalendarEvent): boolean {
    if (isEventCompleted(event) || isEventWaitingValidation(event)) return false;
    const due = new Date(event.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    return startOfDay(due).getTime() < startOfDay(new Date()).getTime();
  }

  function isEventDueToday(event: CalendarEvent): boolean {
    if (isEventCompleted(event) || isEventWaitingValidation(event)) return false;
    const due = new Date(event.dueDate);
    if (Number.isNaN(due.getTime())) return false;
    return startOfDay(due).getTime() === startOfDay(new Date()).getTime();
  }

  function urgencyRank(event: CalendarEvent): number {
    const priority = (event.priority || "").toLowerCase();
    if (isEventOverdue(event)) return 0;
    if (priority.includes("urgent") || priority.includes("high")) return 1;
    if (isEventDueToday(event)) return 2;
    if (event.status === "in_progress") return 3;
    return 4;
  }

  function sortActionEvents(items: CalendarEvent[]): CalendarEvent[] {
    return [...items].sort((a, b) => {
      const urgencyDelta = urgencyRank(a) - urgencyRank(b);
      if (urgencyDelta !== 0) return urgencyDelta;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }

  function eventStatusLabel(event: CalendarEvent): string {
    if (isEventOverdue(event)) return tCalendar("overdue");
    if (isEventDueToday(event)) return tCalendar("todayLabel");
    if (event.status === "in_progress") return tCalendar("inProgress");
    if (event.status === "validated") return tCalendar("validated");
    if (event.status === "completed") return tCalendar("completed");
    if (event.status === "waiting_validation") return tCalendar("waitingValidation");
    return event.status || tCalendar("scheduled");
  }

  function primaryActionLabel(event: CalendarEvent): string {
    if (event.status === "in_progress") return tCalendar("continueAction");
    if (isEventWaitingValidation(event) || isEventCompleted(event)) return tCalendar("viewDetailsAction");
    return tCalendar("startTaskAction");
  }

  function statusPillClass(event: CalendarEvent): string {
    if (isEventOverdue(event)) return "border-red-200 bg-red-50 text-red-700";
    if (isEventDueToday(event)) return "border-amber-200 bg-amber-50 text-amber-700";
    if (event.status === "waiting_validation") return "border-violet-200 bg-violet-50 text-violet-700";
    if (event.status === "completed" || event.status === "validated") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (event.status === "in_progress") return "border-blue-200 bg-blue-50 text-blue-700";
    return "border-slate-200 bg-slate-50 text-slate-700";
  }

  function runPrimaryCardAction(event: CalendarEvent): void {
    if (event.status === "in_progress" || isEventWaitingValidation(event) || isEventCompleted(event)) {
      setSelectedEventId(event.workOrderId);
      return;
    }

    void quickStartEvent(event);
  }

  const actionSections = [
    {
      key: "due-today",
      title: tCalendar("dueTodaySection"),
      events: sortActionEvents(events.filter((event) => isEventOverdue(event) || isEventDueToday(event))),
    },
    {
      key: "upcoming",
      title: tCalendar("upcomingSection"),
      events: sortActionEvents(
        events.filter(
          (event) =>
            !isEventOverdue(event) &&
            !isEventDueToday(event) &&
            !isEventWaitingValidation(event) &&
            !isEventCompleted(event),
        ),
      ),
    },
    {
      key: "waiting-validation",
      title: tCalendar("waitingValidation"),
      events: sortActionEvents(events.filter(isEventWaitingValidation)),
    },
  ];

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={tCalendar("title")}>
        <div className="operator-dashboard-theme bento-grid">
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

          <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase text-blue-700">
                  <CalendarDaysIcon className="h-4 w-4" />
                  {tCalendar("title")}
                </div>
                <div className="text-2xl font-bold tracking-tight text-slate-900">{tCalendar("title")}</div>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">{tCalendar("description")}</p>
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
          </div>

          <div className="col-span-full panel">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <FunnelIcon className="h-4 w-4" />
                {tCalendar("filtersAndViews")}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedFilters((value) => !value)}
                  data-testid="smart-calendar-advanced-filters-toggle"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase text-slate-600 transition hover:bg-slate-100"
                >
                  {tCalendar("advancedFilters")}
                </button>
                <button
                  type="button"
                  onClick={() => setFilters(resetFilters())}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase text-slate-600 transition hover:bg-slate-100"
                >
                  {tCalendar("resetFilters")}
                </button>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {VIEW_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setView(option.key)}
                  data-testid={`smart-calendar-view-${option.key}`}
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

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
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
            </div>

            {showAdvancedFilters ? (
              <div data-testid="smart-calendar-advanced-filters" className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <select
                  value={filters.machineTypeId}
                  onChange={(event) => setFilters((prev) => ({ ...prev, machineTypeId: event.target.value }))}
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
            ) : null}
          </div>

          <div className="col-span-full space-y-5" data-testid="smart-calendar-action-sections">
            {loading ? (
              <div className="text-sm text-slate-500">{tCommon("loading")}</div>
            ) : (
              actionSections.map((section) => (
                <section key={section.key} data-testid={`smart-calendar-section-${section.key}`} className="panel">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="card-title">{section.title}</div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                      {section.events.length}
                    </span>
                  </div>
                  {section.events.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      {tCalendar("noItem")}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {section.events.map((event, index) => (
                        <article
                          key={event.id}
                          data-testid={`smart-calendar-task-card-${section.key}-${index}`}
                          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-500">{event.machine.code || tCommon("notAvailable")}</div>
                              <div className="mt-1 text-lg font-bold leading-snug text-slate-900">{event.title}</div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusPillClass(event)}`}>
                                  {eventStatusLabel(event)}
                                </span>
                                <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                                  {event.priority || tCalendar("noPriority")}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              data-testid={`smart-calendar-primary-action-${section.key}-${index}`}
                              disabled={actionLoading}
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                runPrimaryCardAction(event);
                              }}
                              className="shrink-0 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              {primaryActionLabel(event)}
                            </button>
                          </div>
                          <div className="mt-4 text-sm text-slate-600">
                            <span className="font-semibold text-slate-800">{tCalendar("due")}:</span>{" "}
                            {new Date(event.dueDate).toLocaleString(locale)}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ))
            )}
          </div>

          {selectedEventId ? (
            <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-sm" role="presentation">
              <aside
                role="dialog"
                aria-modal="true"
                aria-labelledby="smart-calendar-details-title"
                className="operator-dashboard-theme ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white p-5 shadow-2xl"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div id="smart-calendar-details-title" className="card-title">{tCalendar("maintenanceDetails")}</div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEventId("");
                      setSelectedEventDetails(null);
                      setShowHistory(false);
                    }}
                    aria-label={tCommon("close")}
                    className="rounded-lg border border-slate-300 p-2 text-slate-700"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {drawerLoading || !selectedEventDetails ? (
                  <div className="text-sm text-slate-500">{tCommon("loading")}</div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <div className="text-sm font-semibold text-slate-500">{selectedEventDetails.machine.code || tCommon("notAvailable")}</div>
                      <div className="mt-1 text-xl font-bold text-slate-900">{selectedEventDetails.description || tCommon("notAvailable")}</div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase text-slate-500">{tCalendar("machineType")}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{selectedEventDetails.machineType.name || tCommon("notAvailable")}</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase text-slate-500">{tCalendar("currentStatus")}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {selectedEventDetails.currentStatus === "in_progress"
                            ? tCalendar("inProgress")
                            : selectedEventDetails.currentStatus === "validated"
                              ? tCalendar("validated")
                              : selectedEventDetails.currentStatus === "completed"
                                ? tCalendar("completed")
                                : selectedEventDetails.currentStatus === "waiting_validation"
                                  ? tCalendar("waitingValidation")
                                  : selectedEventDetails.currentStatus}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase text-slate-500">{tCalendar("module")}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {selectedEventDetails.module.code || selectedEventDetails.module.location || tCommon("notAvailable")}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase text-slate-500">{tCalendar("frequency")}</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{selectedEventDetails.frequency.label || tCommon("notAvailable")}</div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-700">{tCalendar("spareParts")}</div>
                      {selectedEventDetails.spareParts.length === 0 ? (
                        <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
                      ) : (
                        <div className="space-y-2">
                          {selectedEventDetails.spareParts.map((part) => (
                            <div key={part.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                              {part.name} - Qty {part.quantity}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void runEventAction("start")}
                        disabled={actionLoading || !selectedEventDetails.actions.canStart}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {tCalendar("start")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void runEventAction("complete")}
                        disabled={actionLoading || !selectedEventDetails.actions.canComplete}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {tCalendar("complete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const base = `/${locale}/operator`;
                          if (!isCorrectiveMaintenanceType(selectedEventDetails.maintenanceType)) {
                            router.push(`${base}/preventive?workOrderId=${selectedEventDetails.id}`);
                            return;
                          }
                          router.push(`${base}/corrective?workOrderId=${selectedEventDetails.id}`);
                        }}
                        disabled={!selectedEventDetails.actions.canGenerateReport}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {tCalendar("generateReportAction")}
                      </button>
                      <button
                        type="button"
                        onClick={openManual}
                        disabled={!selectedEventDetails.actions.canOpenManual}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {tCalendar("openManualAction")}
                      </button>
                      <button
                        type="button"
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
              </aside>
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
