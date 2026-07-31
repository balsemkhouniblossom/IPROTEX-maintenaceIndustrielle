"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import { Modal } from "@/components/Modal";
import DocumentAttachmentViewer from "@/components/DocumentAttachmentViewer";
import KnowledgeSuggestions from "@/components/knowledge-base/KnowledgeSuggestions";
import { invalidateList, LIST_EVENTS } from "@/services/listInvalidation";
import { isCorrectiveMaintenanceType } from "@/services/maintenanceType";

type EntityRef = string | { _id?: string; id?: string };

interface MachineType {
  _id: string;
  type_id?: number;
  name: string;
}

interface Machine {
  _id: string;
  machine_id: string;
  type_id: EntityRef;
  model?: string;
}

interface ModuleEntity {
  _id: string;
  module_id: string;
  machine_id: EntityRef;
}

interface MaintenancePlan {
  _id: string;
  plan_id: string;
  module_id: EntityRef;
  type_maintenance?: string;
  instruction?: string;
  responsable?: string;
  documentation?: string;
  maintenance_code?: string;
  frequence?: number;
  unite_frequence?: string;
}

interface DocumentEntity {
  _id: string;
  machine_id: EntityRef;
  file_path: string;
  file_name: string;
  preview_path?: string;
  type_document?: string;
}

interface Lubrifiant {
  _id: string;
  nom: string;
  type: string;
}

interface Kpi {
  _id: string;
  machine_id: EntityRef;
  mtbf_value?: number;
  mttr_value?: number;
  availability_rate?: number;
}

interface PreventiveTaskChecklistItem {
  _id: string;
  task_id: string;
  instruction: string;
  responsable?: string;
  status: "pending" | "completed";
  notes?: string;
  completed_at?: string;
  module_id?: string | { _id?: string; machine_id?: EntityRef };
  plan_id?: EntityRef | { _id?: string; maintenance_code?: string; plan_id?: string };
}

interface GeneratedReportRow {
  id: string;
  type: "preventive" | "corrective";
  workOrderId: string;
  reportId: string;
  machine: string;
  summary: string;
  createdAt: string;
  status: string;
}

type MachineCondition = "good" | "followUp" | "technicianRequired" | "custom";
const REPORTS_STORAGE_KEY = "operator_generated_reports_history";
const CUSTOM_OPTION = "__custom__";
const LUBRIFICATION_QTY_OPTIONS = ["1", "2", "5", "10", "20", "50", "100"];

function refId(value: EntityRef | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id ?? value.id ?? "";
}

interface PreventiveOccurrence {
  _id: string;
  status?: string;
  due_date?: string;
  scheduled_date?: string;
  execution_date?: string;
  date_start?: string;
  original_due_date?: string;
  reschedule_reason?: string;
  rescheduled_at?: string;
}

interface PreventivePlanState {
  plan: MaintenancePlan;
  module?: ModuleEntity | null;
  currentOccurrence?: PreventiveOccurrence | null;
  currentState: string;
  lastCompletedDate?: string | null;
  nextDueDate?: string | null;
  frequency?: {
    value?: number;
    unit?: string;
    originalLabel?: string;
    normalized?: string;
  };
}

interface PreventiveStateResponse {
  sections?: {
    dueToday: PreventivePlanState[];
    overdue: PreventivePlanState[];
    upcoming: PreventivePlanState[];
    waitingValidation: PreventivePlanState[];
    returned: PreventivePlanState[];
    preventivePlan: PreventivePlanState[];
  };
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export default function OperatorPreventivePage() {
  const t = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
  const tChecklist = useTranslations("preventiveTaskChecklist");
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [machineTypes, setMachineTypes] = useState<MachineType[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [modules, setModules] = useState<ModuleEntity[]>([]);
  const [plans, setPlans] = useState<MaintenancePlan[]>([]);
  const [documents, setDocuments] = useState<DocumentEntity[]>([]);
  const [previewDocument, setPreviewDocument] = useState<DocumentEntity | null>(null);
  const [lubrifiants, setLubrifiants] = useState<Lubrifiant[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [preventiveState, setPreventiveState] = useState<PreventiveStateResponse | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [checklistItems, setChecklistItems] = useState<PreventiveTaskChecklistItem[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState("");
  const [checklistNotesDraft, setChecklistNotesDraft] = useState<Record<string, string>>({});
  const [checklistSavingId, setChecklistSavingId] = useState("");

  const [selectedCategory, setSelectedCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [customMachine, setCustomMachine] = useState("");

  const [condition, setCondition] = useState<MachineCondition>("good");
  const [customCondition, setCustomCondition] = useState("");
  const [comments, setComments] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [selectedLubrifiant, setSelectedLubrifiant] = useState("");
  const [selectedLubrificationQtyMode, setSelectedLubrificationQtyMode] = useState("");
  const [lubrificationQty, setLubrificationQty] = useState("");
  const [submitValidationReason, setSubmitValidationReason] = useState("");
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [, setSelectedOccurrenceId] = useState("");
  const [selectedOccurrenceIdsByPlan, setSelectedOccurrenceIdsByPlan] = useState<Record<string, string>>({});
  const [activePlanStepIndex, setActivePlanStepIndex] = useState(0);
  const [taskStarted, setTaskStarted] = useState(false);
  const [schedulePlan, setSchedulePlan] = useState<MaintenancePlan | null>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [scheduleReason, setScheduleReason] = useState("");
  const [rescheduleOccurrence, setRescheduleOccurrence] = useState<PreventiveOccurrence | null>(null);
  const [actionSaving, setActionSaving] = useState(false);
  const [generatedReports, setGeneratedReports] = useState<GeneratedReportRow[]>([]);
  const [selectedGeneratedReport, setSelectedGeneratedReport] = useState<GeneratedReportRow | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const submitValidationMessage = useMemo(() => {
    if (!submitValidationReason) {
      return "";
    }

    switch (submitValidationReason) {
      case "missing-user-or-machine":
        return `${t("validation")}: ${t("machine")}`;
      case "no-tasks-selected":
        return t("preventiveTasks");
      case "no-occurrence-scheduled":
        return t("validation");
      case "submit-failed":
        return tCommon("error");
      default:
        return submitValidationReason;
    }
  }, [submitValidationReason, t, tCommon]);

  const extractApiErrorMessage = useCallback((error: unknown, fallback: string): string => {
    const apiError = error as {
      response?: { status?: number; data?: { message?: string | string[] } };
    };
    if (apiError?.response?.status === 409) {
      return t("lifecycle.taskAlreadySubmitted");
    }
    const raw = apiError?.response?.data?.message;
    if (Array.isArray(raw) && raw.length) {
      return raw.join(" ");
    }
    if (typeof raw === "string" && raw.trim()) {
      return raw;
    }
    return fallback;
  }, [t]);

  useEffect(() => {
    if (!notification) return;

    const timeout = setTimeout(() => {
      setNotification(null);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [notification]);

  useEffect(() => {
    if (!submitValidationReason) return;

    setSubmitValidationReason("");
  }, [selectedMachine, selectedCategory, checklistItems, submitValidationReason]);

  function showNotification(type: "success" | "error", message: string): void {
    setNotification({ type, message });
  }

  function resetPreventiveFlowState(): void {
    setSelectedMachine("");
    setCondition("good");
    setCustomCondition("");
    setComments("");
    setPhoto(null);
    setSelectedLubrifiant("");
    setSelectedLubrificationQtyMode("");
    setLubrificationQty("");
    setSubmitValidationReason("");
    setSelectedPlanIds([]);
    setSelectedOccurrenceId("");
    setSelectedOccurrenceIdsByPlan({});
    setActivePlanStepIndex(0);
    setTaskStarted(false);
    setPreventiveState(null);
  }

  function resetMachineSpecificState(): void {
    setCondition("good");
    setCustomCondition("");
    setComments("");
    setPhoto(null);
    setSelectedLubrifiant("");
    setSelectedLubrificationQtyMode("");
    setLubrificationQty("");
    setSubmitValidationReason("");
    setSelectedPlanIds([]);
    setSelectedOccurrenceId("");
    setSelectedOccurrenceIdsByPlan({});
    setActivePlanStepIndex(0);
    setTaskStarted(false);
  }

  function addGeneratedReport(report: GeneratedReportRow): void {
    setGeneratedReports((prev) => {
      const next = [report, ...prev].slice(0, 30);
      localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REPORTS_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as GeneratedReportRow[];
      if (Array.isArray(parsed)) {
        setGeneratedReports(parsed);
      }
    } catch {
      setGeneratedReports([]);
    }
  }, []);

  useEffect(() => {
    async function loadAll() {
      try {
        setLoading(true);
        const [
          machineTypeItems,
          machineItems,
          moduleItems,
          planItems,
          documentItems,
          lubrifiantItems,
          kpiItems,
        ] = await Promise.all([
          fetchAllPaginated<MachineType>((params) => apiService.getOperatorMachineTypes(params)),
          fetchAllPaginated<Machine>((params) => apiService.getMyMachines(params)),
          fetchAllPaginatedItems<ModuleEntity>((params) => apiService.getOperatorModules(params)),
          fetchAllPaginatedItems<MaintenancePlan>((params) => apiService.getOperatorMaintenancePlans(params)),
          fetchAllPaginated<DocumentEntity>((params) => apiService.getOperatorManuals(params)),
          fetchAllPaginatedItems<Lubrifiant>((params) => apiService.getOperatorLubrifiants(params)),
          fetchAllPaginatedItems<Kpi>((params) => apiService.getOperatorKpis(params)),
        ]);

        setMachineTypes(machineTypeItems);
        setMachines(machineItems);
        setModules(moduleItems);
        setPlans(planItems);
        setDocuments(documentItems);
        setLubrifiants(lubrifiantItems);
        setKpis(kpiItems);
      } catch (error) {
        console.error("Failed to load preventive workflow data", error);
      } finally {
        setLoading(false);
      }
    }

    void loadAll();
  }, []);

  useEffect(() => {
    async function loadPreventiveState() {
      if (!selectedMachine) {
        setPreventiveState(null);
        return;
      }

      try {
        setStateLoading(true);
        const response = await apiService.getOperatorPreventiveStates({ machineId: selectedMachine });
        setPreventiveState((response.data || null) as PreventiveStateResponse | null);
      } catch (error) {
        console.error("Failed to load machine preventive scheduling state", error);
        setPreventiveState(null);
      } finally {
        setStateLoading(false);
      }
    }

    void loadPreventiveState();
  }, [selectedMachine]);

  const loadChecklist = useCallback(async () => {
    if (!selectedMachine && !selectedCategory) {
      setChecklistItems([]);
      setChecklistError("");
      return;
    }

    try {
      setChecklistLoading(true);
      setChecklistError("");
      const items = await fetchAllPaginated<PreventiveTaskChecklistItem>((params) =>
        apiService.getOperatorPreventiveTaskChecklist({
          ...params,
          machineId: selectedMachine || undefined,
          // Category-wide view: list every checklist item across the
          // operator's accessible machines in this category, not just one
          // machine, once they've picked a category but not yet a machine.
          machineTypeId: !selectedMachine && selectedCategory ? selectedCategory : undefined,
        }),
      );
      setChecklistItems(items);
    } catch (error) {
      console.error("Failed to load preventive task checklist", error);
      setChecklistItems([]);
      setChecklistError(extractApiErrorMessage(error, tChecklist("notifications.loadFailed")));
    } finally {
      setChecklistLoading(false);
    }
  }, [extractApiErrorMessage, selectedMachine, selectedCategory, tChecklist]);

  useEffect(() => {
    void loadChecklist();
  }, [loadChecklist]);

  async function toggleChecklistItem(item: PreventiveTaskChecklistItem): Promise<void> {
    const nextStatus = item.status === "completed" ? "pending" : "completed";
    try {
      setChecklistSavingId(item._id);
      await apiService.updateOperatorPreventiveTaskChecklist(item._id, {
        status: nextStatus,
        notes: checklistNotesDraft[item._id] ?? item.notes,
      });
      showNotification("success", tChecklist("notifications.taskUpdated"));
      await loadChecklist();
    } catch (error) {
      console.error("Failed to update preventive task checklist item", error);
      showNotification("error", extractApiErrorMessage(error, tChecklist("notifications.loadFailed")));
    } finally {
      setChecklistSavingId("");
    }
  }

  async function saveChecklistNotes(item: PreventiveTaskChecklistItem): Promise<void> {
    const notes = checklistNotesDraft[item._id];
    if (notes === undefined || notes === item.notes) return;

    try {
      setChecklistSavingId(item._id);
      await apiService.updateOperatorPreventiveTaskChecklist(item._id, { notes });
      showNotification("success", tChecklist("notifications.taskUpdated"));
      await loadChecklist();
    } catch (error) {
      console.error("Failed to save preventive task checklist notes", error);
      showNotification("error", extractApiErrorMessage(error, tChecklist("notifications.loadFailed")));
    } finally {
      setChecklistSavingId("");
    }
  }

  async function fetchAllPaginatedItems<T>(
    request: (params?: { page?: number; limit?: number }) => Promise<{ data: unknown }>,
  ): Promise<T[]> {
    return fetchAllPaginated<T>(request);
  }

  const machinesForCategory = useMemo(
    () => machines.filter((machine) => refId(machine.type_id) === selectedCategory),
    [machines, selectedCategory],
  );

  // machineTypes is already scoped server-side (getOperatorMachineTypes) to the
  // categories the operator can access, with no client-side re-filtering needed.
  const visibleMachineTypes = machineTypes;

  const modulesForMachine = useMemo(
    () => modules.filter((module) => refId(module.machine_id) === selectedMachine),
    [modules, selectedMachine],
  );

  const moduleIdSet = useMemo(() => new Set(modulesForMachine.map((module) => module._id)), [modulesForMachine]);

  const preventivePlans = useMemo(
    () =>
      plans.filter(
        (plan) =>
          moduleIdSet.has(refId(plan.module_id)) &&
          !isCorrectiveMaintenanceType(plan.type_maintenance),
      ),
    [plans, moduleIdSet],
  );

  const manualDocument = useMemo(
    () => {
      const selectedCategoryMachineIds = new Set(
        machines
          .filter((machine) => refId(machine.type_id) === selectedCategory)
          .map((machine) => machine._id),
      );

      return (
        documents.find((doc) => {
          const documentMachineId = refId(doc.machine_id);
          const type = (doc.type_document ?? "").toLowerCase();
          const name = (doc.file_name ?? "").toLowerCase();
          const isManualType =
            type.includes("manual") ||
            type.includes("procedure") ||
            type.includes("pdf") ||
            type.includes("excel") ||
            type.includes("xlsx") ||
            type.includes("xls") ||
            type.includes("spreadsheet") ||
            name.endsWith(".xlsx") ||
            name.endsWith(".xls");

          if (!isManualType) return false;
          if (selectedMachine) return documentMachineId === selectedMachine;
          if (selectedCategory) return selectedCategoryMachineIds.has(documentMachineId);
          return false;
        }) ?? null
      );
    },
    [documents, machines, selectedCategory, selectedMachine],
  );

  const selectedMachineKpi = useMemo(
    () => kpis.find((item) => refId(item.machine_id) === selectedMachine) ?? null,
    [kpis, selectedMachine],
  );

  const preventiveSections = preventiveState?.sections;

  function formatPlanStateLabel(state: string): string {
    const key = state === "not_scheduled"
      ? "notScheduled"
      : state === "due_today"
        ? "dueToday"
        : state === "due_soon"
          ? "dueSoon"
          : state === "waiting_validation"
            ? "waitingValidation"
            : state === "in_progress"
              ? "inProgress"
              : state;
    try {
      return t(`lifecycle.${key}`);
    } catch {
      return state;
    }
  }

  function formatDateLabel(value?: string | null): string {
    if (!value) return t("lifecycle.noDueDate");
    return new Date(value).toLocaleDateString();
  }

  function formatReportDate(value?: string): string {
    if (!value) return tCommon("notAvailable");
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? tCommon("notAvailable") : parsed.toLocaleString();
  }

  function formatReportStatus(status: string): string {
    switch (status) {
      case "waiting_validation":
        return t("waitingValidation");
      case "validated":
      case "completed":
        return t("validated");
      case "returned":
        return t("returned");
      case "technician_required":
        return t("technicianRequired");
      default:
        return status || tCommon("notAvailable");
    }
  }

  function reportStatusClasses(status: string): string {
    switch (status) {
      case "validated":
      case "completed":
        return "border-emerald-200 bg-emerald-50 text-emerald-800";
      case "returned":
        return "border-amber-200 bg-amber-50 text-amber-800";
      case "technician_required":
        return "border-blue-200 bg-blue-50 text-blue-800";
      case "waiting_validation":
      default:
        return "border-slate-200 bg-slate-50 text-slate-700";
    }
  }

  const preventivePlanStates = useMemo(
    () =>
      preventiveSections?.preventivePlan ||
      preventivePlans.map((plan) => ({
        plan,
        module: modules.find((moduleEntity) => refId(plan.module_id) === moduleEntity._id) || null,
        currentState: "not_scheduled",
        currentOccurrence: null,
        lastCompletedDate: null,
        nextDueDate: null,
        frequency: {
          value: plan.frequence,
          unit: plan.unite_frequence,
          normalized: plan.unite_frequence,
        },
      } satisfies PreventivePlanState)),
    [modules, preventivePlans, preventiveSections?.preventivePlan],
  );

  const preventivePlanGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; states: PreventivePlanState[]; planIds: string[] }
    >();

    preventivePlanStates.forEach((state) => {
      const label = state.plan.maintenance_code || state.plan.plan_id;
      const key = label.trim().toUpperCase() || state.plan._id;
      const existing = groups.get(key);
      if (existing) {
        existing.states.push(state);
        existing.planIds.push(state.plan._id);
        return;
      }

      groups.set(key, {
        key,
        label,
        states: [state],
        planIds: [state.plan._id],
      });
    });

    return Array.from(groups.values());
  }, [preventivePlanStates]);

  const selectedPlanId = selectedPlanIds[activePlanStepIndex] || selectedPlanIds[0] || "";
  const selectedPlanIdsSet = useMemo(() => new Set(selectedPlanIds), [selectedPlanIds]);
  const selectedPlanState = useMemo(
    () => preventivePlanStates.find((item) => item.plan._id === selectedPlanId) || null,
    [preventivePlanStates, selectedPlanId],
  );
  const selectedPlanGroup = useMemo(
    () => preventivePlanGroups.find((group) => group.planIds.some((planId) => selectedPlanIdsSet.has(planId))) || null,
    [preventivePlanGroups, selectedPlanIdsSet],
  );
  const selectedPlanLabel = selectedPlanGroup?.label || selectedPlanState?.plan.maintenance_code || selectedPlanState?.plan.plan_id || "";
  const selectedPlanStateLabel = selectedPlanState ? formatPlanStateLabel(selectedPlanState.currentState) : tCommon("notAvailable");

  function checklistPlanId(item: PreventiveTaskChecklistItem): string {
    const planRef = item.plan_id;
    if (!planRef) return "";
    return refId(planRef as EntityRef);
  }

  const groupedChecklistItems = useMemo(
    () => checklistItems.filter((item) => selectedPlanIdsSet.has(checklistPlanId(item))),
    [checklistItems, selectedPlanIdsSet],
  );

  const selectedChecklistItems = useMemo(
    () => checklistItems.filter((item) => checklistPlanId(item) === selectedPlanId),
    [checklistItems, selectedPlanId],
  );

  const completedChecklistLabels = useMemo(
    () => groupedChecklistItems.filter((item) => item.status === "completed").map((item) => item.instruction),
    [groupedChecklistItems],
  );

  const currentCompletedChecklistLabels = useMemo(
    () => selectedChecklistItems.filter((item) => item.status === "completed").map((item) => item.instruction),
    [selectedChecklistItems],
  );

  const focusedProgress = selectedChecklistItems.length > 0
    ? Math.round((currentCompletedChecklistLabels.length / selectedChecklistItems.length) * 100)
    : 0;

  const selectedTaskCompleted =
    selectedChecklistItems.length > 0 &&
    currentCompletedChecklistLabels.length === selectedChecklistItems.length;
  const groupTaskCompleted =
    groupedChecklistItems.length > 0 &&
    completedChecklistLabels.length === groupedChecklistItems.length;
  const activePlanStepNumber = selectedPlanGroup ? activePlanStepIndex + 1 : 0;
  const totalPlanSteps = selectedPlanGroup?.planIds.length || 0;
  const isLastPlanStep = totalPlanSteps <= 1 || activePlanStepIndex >= totalPlanSteps - 1;
  const canGoToNextPlanStep = Boolean(taskStarted && selectedTaskCompleted && !isLastPlanStep);
  const canSubmitFocusedTask = Boolean(taskStarted && groupTaskCompleted && selectedPlanIds.every((planId) => selectedOccurrenceIdsByPlan[planId] || selectedPlanGroup?.states.find((state) => state.plan._id === planId)?.currentOccurrence?._id));

  useEffect(() => {
    if (!selectedMachine || preventivePlanGroups.length === 0) {
      if (selectedPlanIds.length > 0) {
        setSelectedPlanIds([]);
        setSelectedOccurrenceId("");
        setSelectedOccurrenceIdsByPlan({});
        setActivePlanStepIndex(0);
        setTaskStarted(false);
      }
      return;
    }

    if (!selectedPlanId || !preventivePlanGroups.some((group) => group.planIds.includes(selectedPlanId))) {
      setSelectedPlanIds(preventivePlanGroups[0].planIds);
      setSelectedOccurrenceId("");
      setSelectedOccurrenceIdsByPlan({});
      setActivePlanStepIndex(0);
      setTaskStarted(false);
    }
  }, [preventivePlanGroups, selectedMachine, selectedPlanId, selectedPlanIds.length]);

  // The single source of truth for "what has this operator actually
  // completed" is the persisted checklist itself (backend PreventiveTask
  // rows) rather than a parallel, client-only set of checkboxes, so the
  // submission payload and the on-page progress indicator both derive from
  // checklistItems instead of duplicating their own selection state.
  function performPlanToday(plan: MaintenancePlan, occurrence?: PreventiveOccurrence | null): void {
    setSelectedPlanIds((current) => (current.includes(plan._id) ? current : [plan._id]));
    setSelectedOccurrenceId(occurrence?._id || "");
    if (occurrence?._id) {
      setSelectedOccurrenceIdsByPlan((current) => ({ ...current, [plan._id]: occurrence._id }));
    }
    setTaskStarted(Boolean(occurrence?._id));
    showNotification("success", `${plan.maintenance_code || plan.plan_id}: ${t("lifecycle.performToday")}`);
  }

  async function startSelectedTask(): Promise<void> {
    if (!selectedMachine || !selectedPlanState) return;

    if (selectedPlanState.currentOccurrence?._id) {
      performPlanToday(selectedPlanState.plan, selectedPlanState.currentOccurrence);
      return;
    }

    try {
      setActionSaving(true);
      const today = new Date().toISOString().slice(0, 10);
      const scheduleResponse = await apiService.scheduleOperatorPreventive({
        machine_id: selectedMachine,
        plan_id: selectedPlanState.plan._id,
        scheduled_date: today,
      });
      const occurrenceId = scheduleResponse?.data?.occurrence?._id as string | undefined;
      const response = await apiService.getOperatorPreventiveStates({ machineId: selectedMachine });
      setPreventiveState((response.data || null) as PreventiveStateResponse | null);
      setSelectedOccurrenceId(occurrenceId || "");
      if (occurrenceId) {
        setSelectedOccurrenceIdsByPlan((current) => ({ ...current, [selectedPlanState.plan._id]: occurrenceId }));
      }
      setTaskStarted(Boolean(occurrenceId));
      showNotification("success", `${selectedPlanState.plan.maintenance_code || selectedPlanState.plan.plan_id}: ${t("smartCalendar.start")}`);
    } catch (error) {
      console.error("Failed to start preventive task", error);
      showNotification("error", extractApiErrorMessage(error, t("lifecycle.duplicateOccurrence")));
    } finally {
      setActionSaving(false);
    }
  }

  async function completeSelectedTask(): Promise<void> {
    if (!selectedChecklistItems.length) {
      setSubmitValidationReason("no-tasks-selected");
      return;
    }

    try {
      setChecklistSavingId("bulk-complete");
      await Promise.all(
        selectedChecklistItems
          .filter((item) => item.status !== "completed")
          .map((item) =>
            apiService.updateOperatorPreventiveTaskChecklist(item._id, {
              status: "completed",
              notes: checklistNotesDraft[item._id] ?? item.notes,
            }),
          ),
      );
      await loadChecklist();
      showNotification("success", tChecklist("notifications.taskMarkedComplete"));
    } catch (error) {
      console.error("Failed to complete selected preventive task", error);
      showNotification("error", extractApiErrorMessage(error, tChecklist("notifications.loadFailed")));
    } finally {
      setChecklistSavingId("");
    }
  }

  function goToNextPlanStep(): void {
    if (!canGoToNextPlanStep) return;
    setActivePlanStepIndex((current) => Math.min(current + 1, totalPlanSteps - 1));
    setSelectedOccurrenceId("");
    setTaskStarted(false);
    setSubmitValidationReason("");
  }

  async function createFirstSchedule(plan: MaintenancePlan): Promise<void> {
    if (!selectedMachine || !scheduleDate) return;

    try {
      setActionSaving(true);
      await apiService.scheduleOperatorPreventive({
        machine_id: selectedMachine,
        plan_id: plan._id,
        scheduled_date: scheduleDate,
      });
      const response = await apiService.getOperatorPreventiveStates({ machineId: selectedMachine });
      setPreventiveState((response.data || null) as PreventiveStateResponse | null);
      setSchedulePlan(null);
      showNotification("success", t("lifecycle.scheduleCreated"));
    } catch (error) {
      console.error("Failed to schedule first preventive occurrence", error);
      showNotification("error", t("lifecycle.duplicateOccurrence"));
    } finally {
      setActionSaving(false);
    }
  }

  async function rescheduleSelectedOccurrence(): Promise<void> {
    if (!rescheduleOccurrence?._id || !scheduleDate || !scheduleReason.trim()) return;

    try {
      setActionSaving(true);
      await apiService.rescheduleMyCalendarEvent(rescheduleOccurrence._id, {
        new_due_date: scheduleDate,
        reason: scheduleReason.trim(),
      });
      if (selectedMachine) {
        const response = await apiService.getOperatorPreventiveStates({ machineId: selectedMachine });
        setPreventiveState((response.data || null) as PreventiveStateResponse | null);
      }
      setRescheduleOccurrence(null);
      setScheduleReason("");
      showNotification("success", t("lifecycle.rescheduleSuccess"));
    } catch (error) {
      console.error("Failed to reschedule preventive occurrence", error);
      showNotification("error", extractApiErrorMessage(error, tCommon("error")));
    } finally {
      setActionSaving(false);
    }
  }

  async function uploadPhotoIfPresent(machineId: string): Promise<void> {
    if (!photo || !user?._id) return;

    const formData = new FormData();
    formData.append("file", photo);
    formData.append("document_id", uniqueId("DOC"));
    formData.append("machine_id", machineId);
    formData.append("type_document", "maintenance_photo");
    formData.append("description", t("photoUpload"));
    formData.append("uploaded_by", user._id);

    await apiService.uploadDocument(formData);
  }

  async function submitPreventiveMaintenance(): Promise<void> {
    if (!user?._id || !selectedMachine) {
      setSubmitValidationReason("missing-user-or-machine");
      showNotification("error", t("validation"));
      return;
    }

    if (completedChecklistLabels.length === 0) {
      setSubmitValidationReason("no-tasks-selected");
      showNotification("error", tChecklist("heading"));
      return;
    }

    const missingOccurrence = selectedPlanIds.find((planId) => {
      const stateOccurrence = selectedPlanGroup?.states.find((state) => state.plan._id === planId)?.currentOccurrence?._id;
      return !selectedOccurrenceIdsByPlan[planId] && !stateOccurrence;
    });

    if (missingOccurrence) {
      // The Operator must act on an already-scheduled occurrence (via
      // "Perform today" on a due/overdue card) rather than an arbitrary
      // plan. This endpoint updates an assigned work order, it never
      // creates one.
      setSubmitValidationReason("no-occurrence-scheduled");
      showNotification("error", t("validation"));
      return;
    }

    const conditionValue = condition === "custom" ? customCondition.trim() : condition;

    setSubmitValidationReason("");
    setSubmitting(true);
    try {
      const machineLabel = machines.find((item) => item._id === selectedMachine)?.machine_id ?? tCommon("notAvailable");
      const taskSummary = completedChecklistLabels.join(" | ");
      const lubrication =
        selectedLubrifiant && lubrificationQty.trim() && Number(lubrificationQty) > 0
          ? { lubrifiant_id: selectedLubrifiant, quantity: Number(lubrificationQty) }
          : undefined;

      const submissionResults: Array<{ workOrderId: string; reportId: string }> = [];
      for (const planId of selectedPlanIds) {
        const planItems = groupedChecklistItems.filter((item) => checklistPlanId(item) === planId);
        const planLabels = planItems
          .filter((item) => item.status === "completed")
          .map((item) => item.instruction);
        if (planItems.length === 0 || planLabels.length !== planItems.length) {
          throw new Error("Preventive submission is incomplete");
        }

        const stateOccurrence = selectedPlanGroup?.states.find((state) => state.plan._id === planId)?.currentOccurrence?._id;
        const occurrenceId = selectedOccurrenceIdsByPlan[planId] || stateOccurrence;
        if (!occurrenceId) {
          throw new Error("Preventive occurrence is missing");
        }

        const response = await apiService.submitOperatorPreventiveMaintenance({
          work_order_id: occurrenceId,
          tasks_completed: planLabels,
          condition: conditionValue,
          comments: comments.trim() || undefined,
          lubrication,
        });

        const workOrderId = response?.data?.workOrder?._id as string | undefined;
        const reportId = response?.data?.report?._id as string | undefined;
        if (!workOrderId || !reportId) {
          throw new Error("Preventive submission failed");
        }
        submissionResults.push({ workOrderId, reportId });
      }

      await uploadPhotoIfPresent(selectedMachine);
      // The submitted work order's status changed server-side, so the Admin
      // Work Orders list has no other way to learn that.
      invalidateList(LIST_EVENTS.workOrders);
      addGeneratedReport({
        id: submissionResults.map((item) => `${item.workOrderId}-${item.reportId}`).join("|"),
        type: "preventive",
        workOrderId: submissionResults.map((item) => item.workOrderId).join(","),
        reportId: submissionResults.map((item) => item.reportId).join(","),
        machine: machineLabel,
        summary: taskSummary,
        createdAt: new Date().toISOString(),
        status: "waiting_validation",
      });

      const refreshedState = await apiService.getOperatorPreventiveStates({ machineId: selectedMachine });
      setPreventiveState((refreshedState.data || null) as PreventiveStateResponse | null);
      setSelectedOccurrenceId("");
      setSelectedOccurrenceIdsByPlan({});
      setActivePlanStepIndex(0);
      setTaskStarted(false);

      showNotification("success", t("notifications.submitSuccess"));
    } catch (error) {
      console.error("Failed to submit preventive maintenance", error);
      setSubmitValidationReason("submit-failed");
      showNotification("error", extractApiErrorMessage(error, tCommon("error")));
    } finally {
      setSubmitting(false);
    }
  }

  const preventiveGeneratedReports = generatedReports.filter((item) => item.type === "preventive");

  if (loading) {
    return (
      <ProtectedRoute requiredRole="operator">
        <DashboardLayout title={t("preventiveMaintenance")}>
          <div className="operator-dashboard-theme panel">{tCommon("loading")}</div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("preventiveMaintenance")}>
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

          <div className="col-span-full panel">
            <div className="card-title mb-4">{t("preventiveMaintenance")}</div>

            <div className="mb-6">
              <div className="mb-3 text-sm font-semibold text-slate-700">{t("machineCategory")}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {visibleMachineTypes.map((item) => (
                  <button
                    key={item._id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(item._id);
                      resetPreventiveFlowState();
                    }}
                    data-testid="preventive-category-select"
                    className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                      selectedCategory === item._id
                        ? "border-blue-500 bg-blue-50 shadow-md"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-lg font-semibold text-slate-900">{item.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{t("viewMachines")}</div>
                  </button>
                ))}
              </div>
              <input
                value={customCategory}
                onChange={(event) => setCustomCategory(event.target.value)}
                className="w-full border rounded-xl px-3 py-2 mt-3"
                placeholder={t("comments")}
              />
            </div>

            <div className="mb-6">
              <div className="mb-3 text-sm font-semibold text-slate-700">{t("machine")}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {machinesForCategory.map((machine) => (
                  <button
                    key={machine._id}
                    type="button"
                    onClick={() => {
                      resetMachineSpecificState();
                      setSelectedMachine(machine._id);
                    }}
                    data-testid="preventive-machine-select"
                    className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                      selectedMachine === machine._id
                        ? "border-emerald-500 bg-emerald-50 shadow-md"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-base font-semibold text-slate-900">{machine.machine_id}</div>
                    <div className="mt-1 text-sm text-slate-500">{machine.model || tCommon("notAvailable")}</div>
                  </button>
                ))}
              </div>
              <input
                value={customMachine}
                onChange={(event) => setCustomMachine(event.target.value)}
                className="w-full border rounded-xl px-3 py-2 mt-3"
                placeholder={t("comments")}
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-700">{t("progress")}</div>
                  <div className="text-xs text-slate-500">
                    {selectedPlanState
                      ? `${currentCompletedChecklistLabels.length}/${selectedChecklistItems.length || 1} ${t("completed")}`
                      : tCommon("table.noData")}
                  </div>
                </div>
                <div className="text-sm font-semibold text-slate-900">{focusedProgress}%</div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${focusedProgress}%` }} />
              </div>
            </div>
          </div>

          {selectedMachine ? (
            <div className="col-span-full">
              <KnowledgeSuggestions machineId={selectedMachine} />
            </div>
          ) : null}

          {selectedMachine ? (
            <div className="col-span-full panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="card-title">{tChecklist("heading")}</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {selectedPlanState
                      ? `${selectedPlanLabel} - ${selectedPlanStateLabel}`
                      : tCommon("table.noData")}
                  </div>
                </div>
                {manualDocument ? (
                  <button type="button" onClick={() => setPreviewDocument(manualDocument)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">
                    {t("openManual")}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {preventivePlanGroups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => {
                      setSelectedPlanIds(group.planIds);
                      setSelectedOccurrenceId("");
                      setSelectedOccurrenceIdsByPlan({});
                      setActivePlanStepIndex(0);
                      setTaskStarted(false);
                    }}
                    className={`shrink-0 rounded-lg border px-4 py-2 text-left text-sm ${
                      group.planIds.some((planId) => selectedPlanIdsSet.has(planId))
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <div className="font-semibold">{group.label}</div>
                    <div className="text-xs">
                      {formatPlanStateLabel(group.states[0].currentState)}
                      {group.states.length > 1 ? ` (${group.states.length})` : ""}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-bold text-slate-900">
                        {selectedPlanLabel || t("lifecycle.preventivePlan")}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {t("lifecycle.nextDue")}: {formatDateLabel(selectedPlanState?.nextDueDate)}
                      </div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
                      {selectedPlanStateLabel}
                    </span>
                  </div>

                  <div className="mt-4 rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-slate-700">
                        {t("progress")} {totalPlanSteps > 1 ? `${activePlanStepNumber}/${totalPlanSteps}` : ""}
                      </span>
                      <span className="font-semibold text-slate-900">{focusedProgress}%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200">
                      <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${focusedProgress}%` }} />
                    </div>
                  </div>

                  <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                    {checklistLoading || stateLoading ? (
                      <div data-testid="preventive-checklist-loading" className="text-sm text-slate-500">{tCommon("loading")}</div>
                    ) : checklistError ? (
                      <div data-testid="preventive-checklist-error" className="text-sm text-red-600">{checklistError}</div>
                    ) : selectedChecklistItems.length === 0 ? (
                      <div data-testid="preventive-checklist-empty" className="text-sm text-slate-500">{tChecklist("empty.default")}</div>
                    ) : (
                      selectedChecklistItems.map((item, index) => (
                        <div
                          key={item._id}
                          data-testid={`preventive-checklist-item-${index}`}
                          className={`rounded-xl border p-3 ${
                            item.status === "completed"
                              ? "border-emerald-400 bg-emerald-50"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm font-medium text-slate-900">{item.instruction}</div>
                            <button
                              type="button"
                              disabled={checklistSavingId === item._id || !taskStarted}
                              onClick={() => void toggleChecklistItem(item)}
                              data-testid={`preventive-checklist-toggle-${index}`}
                              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                                item.status === "completed" ? "bg-slate-600" : "bg-emerald-600"
                              }`}
                            >
                              {item.status === "completed" ? tChecklist("status.pending") : tChecklist("actions.complete")}
                            </button>
                          </div>
                          <input
                            value={checklistNotesDraft[item._id] ?? item.notes ?? ""}
                            onChange={(event) =>
                              setChecklistNotesDraft((prev) => ({ ...prev, [item._id]: event.target.value }))
                            }
                            onBlur={() => void saveChecklistNotes(item)}
                            data-testid={`preventive-checklist-notes-${index}`}
                            className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                            placeholder={tChecklist("placeholders.notes")}
                          />
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-4 grid gap-2 md:grid-cols-4">
                    <button
                      type="button"
                      disabled={!selectedPlanState || actionSaving || taskStarted}
                      onClick={() => void startSelectedTask()}
                      className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {actionSaving ? tCommon("saving") : t("smartCalendar.start")}
                    </button>
                    <button
                      type="button"
                      disabled={!taskStarted || checklistSavingId === "bulk-complete" || selectedTaskCompleted}
                      onClick={() => void completeSelectedTask()}
                      className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {checklistSavingId === "bulk-complete" ? tCommon("saving") : t("smartCalendar.complete")}
                    </button>
                    <button
                      type="button"
                      disabled={!canGoToNextPlanStep}
                      onClick={goToNextPlanStep}
                      data-testid="preventive-next-step-button"
                      className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                    >
                      {tCommon("next")}
                    </button>
                    <button
                      disabled={!canSubmitFocusedTask || submitting || !isLastPlanStep}
                      onClick={() => void submitPreventiveMaintenance()}
                      data-testid="preventive-submit-button"
                      className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {submitting ? tCommon("saving") : t("generateReport")}
                    </button>
                  </div>
                  {submitValidationReason ? (
                    <div data-testid="preventive-submit-validation" className="mt-3 text-sm text-red-600">
                      {submitValidationMessage}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">{t("machineCondition")}</label>
                    <select
                      value={condition}
                      onChange={(event) => setCondition(event.target.value as MachineCondition)}
                      title={t("machineCondition")}
                      aria-label={t("machineCondition")}
                      className="mt-2 w-full rounded-lg border px-3 py-2"
                    >
                      <option value="good">{t("good")}</option>
                      <option value="followUp">{t("followUp")}</option>
                      <option value="technicianRequired">{t("technicianRequired")}</option>
                      <option value="custom">{t("custom")}</option>
                    </select>
                    {condition === "custom" ? (
                      <input
                        value={customCondition}
                        onChange={(event) => setCustomCondition(event.target.value)}
                        className="mt-2 w-full rounded-lg border px-3 py-2"
                        placeholder={t("comments")}
                      />
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">{t("comments")}</label>
                    <input
                      value={comments}
                      onChange={(event) => setComments(event.target.value.slice(0, 180))}
                      className="mt-2 w-full rounded-lg border px-3 py-2"
                      placeholder={t("comments")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">{t("lubricant")}</label>
                    <select
                      value={selectedLubrifiant}
                      onChange={(event) => setSelectedLubrifiant(event.target.value)}
                      title={t("lubricant")}
                      aria-label={t("lubricant")}
                      className="mt-2 w-full rounded-lg border px-3 py-2"
                    >
                      <option value="">{tCommon("actions.search")}</option>
                      {lubrifiants.map((item) => (
                        <option key={item._id} value={item._id}>
                          {item.nom} ({item.type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">{t("quantity")}</label>
                    <select
                      value={selectedLubrificationQtyMode}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSelectedLubrificationQtyMode(value);
                        setLubrificationQty(value === CUSTOM_OPTION ? "" : value);
                      }}
                      title={t("quantity")}
                      aria-label={t("quantity")}
                      className="mt-2 w-full rounded-lg border px-3 py-2"
                    >
                      <option value="">{tCommon("actions.search")}</option>
                      {LUBRIFICATION_QTY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value={CUSTOM_OPTION}>{t("custom")}</option>
                    </select>
                    {selectedLubrificationQtyMode === CUSTOM_OPTION ? (
                      <input
                        type="number"
                        min="0"
                        value={lubrificationQty}
                        onChange={(event) => setLubrificationQty(event.target.value)}
                        title={t("quantity")}
                        aria-label={t("quantity")}
                        placeholder={t("quantity")}
                        className="mt-2 w-full rounded-lg border px-3 py-2"
                      />
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">{t("photoUpload")}</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                      title={t("photoUpload")}
                      aria-label={t("photoUpload")}
                      className="mt-2 w-full rounded-lg border px-3 py-2"
                    />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                    {t("lifecycle.actualExecutionDate")}: {new Date().toLocaleString()}
                  </div>
                  {selectedMachineKpi ? (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg border bg-white p-2">{t("mtbf")}: {selectedMachineKpi.mtbf_value ?? tCommon("notAvailable")}</div>
                      <div className="rounded-lg border bg-white p-2">{t("mttr")}: {selectedMachineKpi.mttr_value ?? tCommon("notAvailable")}</div>
                      <div className="rounded-lg border bg-white p-2">{t("availability")}: {selectedMachineKpi.availability_rate ?? tCommon("notAvailable")}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("myReports")}</div>
            {preventiveGeneratedReports.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {preventiveGeneratedReports.map((item, index) => (
                  <article
                    key={item.id}
                    className="w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-slate-900">{item.machine || tCommon("notAvailable")}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                          <span>{t("preventive")}</span>
                          <span aria-hidden="true">|</span>
                          <span>{formatReportDate(item.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${reportStatusClasses(item.status)}`}>
                          {formatReportStatus(item.status)}
                        </span>
                        <button
                          type="button"
                          data-testid={`preventive-report-details-${index}`}
                          onClick={() => setSelectedGeneratedReport(item)}
                          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                          {t("smartCalendar.maintenanceDetails")}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <Modal
          isOpen={Boolean(selectedGeneratedReport)}
          onClose={() => setSelectedGeneratedReport(null)}
          title={t("smartCalendar.maintenanceDetails")}
          size="lg"
        >
          {selectedGeneratedReport ? (
            <div className="operator-dashboard-theme space-y-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("machine")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {selectedGeneratedReport.machine || tCommon("notAvailable")}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("smartCalendar.maintenanceType")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">{t("preventive")}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("dashboard.submissionDate")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {formatReportDate(selectedGeneratedReport.createdAt)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("validation")}</div>
                  <div className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${reportStatusClasses(selectedGeneratedReport.status)}`}>
                    {formatReportStatus(selectedGeneratedReport.status)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-700">{t("actionsPerformed")}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {selectedGeneratedReport.summary || tCommon("notAvailable")}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedGeneratedReport(null)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  {tCommon("close")}
                </button>
              </div>
            </div>
          ) : null}
        </Modal>

        <Modal
          isOpen={Boolean(previewDocument)}
          onClose={() => setPreviewDocument(null)}
          title={previewDocument?.file_name || t("openManual")}
          size="xl"
        >
          {previewDocument ? (
            <div className="operator-dashboard-theme">
              <DocumentAttachmentViewer document={previewDocument} title={previewDocument.file_name} />
            </div>
          ) : null}
        </Modal>

        <Modal
          isOpen={Boolean(schedulePlan)}
          onClose={() => setSchedulePlan(null)}
          title={t("lifecycle.setFirstInterventionDate")}
        >
          <div className="operator-dashboard-theme space-y-4">
            <div className="text-sm font-semibold text-slate-800">
              {schedulePlan?.maintenance_code || schedulePlan?.plan_id}
            </div>
            <label className="block text-sm">
              {t("lifecycle.newDueDate")}
              <input
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                className="mt-2 w-full rounded-lg border px-3 py-2"
              />
            </label>
            <button
              type="button"
              disabled={actionSaving || !schedulePlan}
              onClick={() => schedulePlan && void createFirstSchedule(schedulePlan)}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {actionSaving ? tCommon("saving") : t("lifecycle.setFirstInterventionDate")}
            </button>
          </div>
        </Modal>

        <Modal
          isOpen={Boolean(rescheduleOccurrence)}
          onClose={() => setRescheduleOccurrence(null)}
          title={t("lifecycle.reschedule")}
        >
          <div className="operator-dashboard-theme space-y-4">
            <div className="text-sm text-slate-600">
              {t("lifecycle.originalDueDate")}: {formatDateLabel(rescheduleOccurrence?.original_due_date || rescheduleOccurrence?.due_date || rescheduleOccurrence?.scheduled_date)}
            </div>
            <label className="block text-sm">
              {t("lifecycle.newDueDate")}
              <input
                type="date"
                value={scheduleDate}
                onChange={(event) => setScheduleDate(event.target.value)}
                className="mt-2 w-full rounded-lg border px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              {t("lifecycle.reschedulingReason")}
              <input
                value={scheduleReason}
                onChange={(event) => setScheduleReason(event.target.value)}
                className="mt-2 w-full rounded-lg border px-3 py-2"
              />
            </label>
            <button
              type="button"
              disabled={actionSaving || !scheduleReason.trim()}
              onClick={() => void rescheduleSelectedOccurrence()}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              {actionSaving ? tCommon("saving") : t("lifecycle.reschedule")}
            </button>
          </div>
        </Modal>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
