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

interface PreventiveDraft {
  id: string;
  title: string;
  updatedAt: string;
  selectedCategory: string;
  customCategory: string;
  selectedMachine: string;
  customMachine: string;
  checkedTasks: Record<string, boolean>;
  customTasks: string[];
  customTaskGroups?: Record<string, string>;
  condition: MachineCondition;
  customCondition: string;
  comments: string;
  completionDate: string;
  selectedLubrifiant: string;
  selectedLubrificationQtyMode: string;
  lubrificationQty: string;
}

type MachineCondition = "good" | "followUp" | "technicianRequired" | "custom";
const REPORTS_STORAGE_KEY = "operator_generated_reports_history";
const PREVENTIVE_DRAFTS_STORAGE_PREFIX = "operator_preventive_drafts";
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

function tokenizeInstructions(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(/\r?\n|[;,]/g)
    .map((item) => item.replace(/^[-*\u2022\s]+/, "").trim())
    .filter(Boolean);
}

function isChecklistHeader(task: string): boolean {
  return /^Checklist for W\d+[:]?$/i.test(task.trim());
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export default function OperatorPreventivePage() {
  const t = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
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

  const [selectedCategory, setSelectedCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [customMachine, setCustomMachine] = useState("");

  const [checkedTasks, setCheckedTasks] = useState<Record<string, boolean>>({});
  const [selectedTaskToAdd, setSelectedTaskToAdd] = useState("");
  const [selectedTaskGroup, setSelectedTaskGroup] = useState("");
  const [customTaskInput, setCustomTaskInput] = useState("");
  const [customTasks, setCustomTasks] = useState<string[]>([]);
  const [customTaskGroups, setCustomTaskGroups] = useState<Record<string, string>>({});

  const [condition, setCondition] = useState<MachineCondition>("good");
  const [customCondition, setCustomCondition] = useState("");
  const [comments, setComments] = useState("");
  const [completionDate, setCompletionDate] = useState<string>(new Date().toISOString().slice(0, 16));

  const [photo, setPhoto] = useState<File | null>(null);
  const [selectedLubrifiant, setSelectedLubrifiant] = useState("");
  const [selectedLubrificationQtyMode, setSelectedLubrificationQtyMode] = useState("");
  const [lubrificationQty, setLubrificationQty] = useState("");
  const [submitValidationReason, setSubmitValidationReason] = useState("");
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState("");
  const [schedulePlan, setSchedulePlan] = useState<MaintenancePlan | null>(null);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().slice(0, 10));
  const [scheduleReason, setScheduleReason] = useState("");
  const [rescheduleOccurrence, setRescheduleOccurrence] = useState<PreventiveOccurrence | null>(null);
  const [actionSaving, setActionSaving] = useState(false);
  const [generatedReports, setGeneratedReports] = useState<GeneratedReportRow[]>([]);
  const [drafts, setDrafts] = useState<PreventiveDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const draftStorageKey = useMemo(
    () => `${PREVENTIVE_DRAFTS_STORAGE_PREFIX}:${user?._id || "anonymous"}`,
    [user?._id],
  );

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

  function extractApiErrorMessage(error: unknown, fallback: string): string {
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
  }

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
  }, [selectedMachine, selectedCategory, checkedTasks, submitValidationReason]);

  function showNotification(type: "success" | "error", message: string): void {
    setNotification({ type, message });
  }

  function resetPreventiveFlowState(): void {
    setSelectedMachine("");
    setCheckedTasks({});
    setSelectedTaskToAdd("");
    setSelectedTaskGroup("");
    setCustomTaskInput("");
    setCustomTasks([]);
    setCustomTaskGroups({});
    setCondition("good");
    setCustomCondition("");
    setComments("");
    setPhoto(null);
    setSelectedLubrifiant("");
    setSelectedLubrificationQtyMode("");
    setLubrificationQty("");
    setSubmitValidationReason("");
    setSelectedDraftId("");
    setSelectedPlanIds([]);
    setSelectedOccurrenceId("");
    setPreventiveState(null);
  }

  function resetMachineSpecificState(): void {
    setCheckedTasks({});
    setSelectedTaskToAdd("");
    setSelectedTaskGroup("");
    setCustomTaskInput("");
    setCustomTasks([]);
    setCustomTaskGroups({});
    setCondition("good");
    setCustomCondition("");
    setComments("");
    setPhoto(null);
    setSelectedLubrifiant("");
    setSelectedLubrificationQtyMode("");
    setLubrificationQty("");
    setSubmitValidationReason("");
    setSelectedDraftId("");
    setSelectedPlanIds([]);
    setSelectedOccurrenceId("");
  }

  function addGeneratedReport(report: GeneratedReportRow): void {
    setGeneratedReports((prev) => {
      const next = [report, ...prev].slice(0, 30);
      localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function persistDrafts(nextDrafts: PreventiveDraft[]): void {
    setDrafts(nextDrafts);
    localStorage.setItem(draftStorageKey, JSON.stringify(nextDrafts));
  }

  function saveCurrentAsDraft(): void {
    const machineLabel = machines.find((item) => item._id === selectedMachine)?.machine_id || customMachine || t("machine");
    const draftId = selectedDraftId || uniqueId("DRAFT-PREV");
    const nextDraft: PreventiveDraft = {
      id: draftId,
      title: machineLabel,
      updatedAt: new Date().toISOString(),
      selectedCategory,
      customCategory,
      selectedMachine,
      customMachine,
      checkedTasks,
      customTasks,
      customTaskGroups,
      condition,
      customCondition,
      comments,
      completionDate,
      selectedLubrifiant,
      selectedLubrificationQtyMode,
      lubrificationQty,
    };

    const nextDrafts = selectedDraftId
      ? drafts.map((item) => (item.id === selectedDraftId ? nextDraft : item))
      : [nextDraft, ...drafts];

    persistDrafts(nextDrafts);
    setSelectedDraftId(draftId);
    showNotification("success", t("notifications.draftSaved"));
  }

  function openDraft(draft: PreventiveDraft): void {
    setSelectedDraftId(draft.id);
    setSelectedCategory(draft.selectedCategory);
    setCustomCategory(draft.customCategory);
    setSelectedMachine(draft.selectedMachine);
    setCustomMachine(draft.customMachine);
    setCheckedTasks(draft.checkedTasks);
    setCustomTasks(draft.customTasks);
    setCustomTaskGroups(draft.customTaskGroups ?? {});
    setCondition(draft.condition);
    setCustomCondition(draft.customCondition);
    setComments(draft.comments);
    setCompletionDate(draft.completionDate);
    setSelectedLubrifiant(draft.selectedLubrifiant);
    setSelectedLubrificationQtyMode(draft.selectedLubrificationQtyMode);
    setLubrificationQty(draft.lubrificationQty);
    showNotification("success", t("notifications.draftLoaded"));
  }

  function deleteDraft(draftId: string): void {
    const nextDrafts = drafts.filter((item) => item.id !== draftId);
    persistDrafts(nextDrafts);
    if (selectedDraftId === draftId) {
      setSelectedDraftId("");
    }
    showNotification("success", t("notifications.draftDeleted"));
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
    try {
      const saved = localStorage.getItem(draftStorageKey);
      if (!saved) {
        setDrafts([]);
        return;
      }
      const parsed = JSON.parse(saved) as PreventiveDraft[];
      if (Array.isArray(parsed)) {
        setDrafts(parsed);
      } else {
        setDrafts([]);
      }
    } catch {
      setDrafts([]);
    }
  }, [draftStorageKey]);

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

  async function fetchAllPaginatedItems<T>(
    request: (params?: { page?: number; limit?: number }) => Promise<{ data: unknown }>,
  ): Promise<T[]> {
    return fetchAllPaginated<T>(request);
  }

  const machinesForCategory = useMemo(
    () => machines.filter((machine) => refId(machine.type_id) === selectedCategory),
    [machines, selectedCategory],
  );

  const visibleMachineTypes = useMemo(() => {
    const usedTypeIds = new Set(
      machines.map((machine) => refId(machine.type_id)).filter(Boolean),
    );

    return machineTypes.filter((type) => usedTypeIds.has(type._id));
  }, [machineTypes, machines]);

  const modulesForMachine = useMemo(
    () => modules.filter((module) => refId(module.machine_id) === selectedMachine),
    [modules, selectedMachine],
  );

  const moduleIdSet = useMemo(() => new Set(modulesForMachine.map((module) => module._id)), [modulesForMachine]);

  const preventivePlans = useMemo(
    () =>
      plans.filter((plan) => {
        const maintenanceType = (plan.type_maintenance ?? "").toLowerCase();
        return moduleIdSet.has(refId(plan.module_id)) && maintenanceType.includes("prevent");
      }),
    [plans, moduleIdSet],
  );

  const taskList = useMemo(() => {
    const generated = preventivePlans.flatMap((plan) => tokenizeInstructions(plan.instruction));
    return Array.from(new Set(generated));
  }, [preventivePlans]);

  const checklistGroups = useMemo(() => {
    const groups: Array<{ header: string; items: string[] }> = [];
    let currentHeader = "";

    taskList.forEach((task) => {
      if (isChecklistHeader(task)) {
        currentHeader = task;
        groups.push({ header: task, items: [] });
        return;
      }

      if (!currentHeader) {
        groups.push({ header: task, items: [] });
        return;
      }

      const currentGroup = groups[groups.length - 1];
      currentGroup?.items.push(task);
    });

    return groups;
  }, [taskList]);

  const checklistHeaders = useMemo(
    () => checklistGroups.map((group) => group.header).filter((header) => isChecklistHeader(header)),
    [checklistGroups],
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

  function renderOccurrenceSection(title: string, items: PreventivePlanState[] = []) {
    if (!selectedMachine) return null;
    return (
      <div className="panel">
        <div className="card-title mb-3">{title}</div>
        {stateLoading ? (
          <div className="text-sm text-slate-500">{tCommon("loading")}</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {items.map((item) => {
              const occurrence = item.currentOccurrence;
              return (
                <div key={`${item.plan._id}-${item.currentState}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900">{item.plan.maintenance_code || item.plan.plan_id}</div>
                      <div className="mt-1 text-sm text-slate-600">{item.plan.instruction || tCommon("notAvailable")}</div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
                      {formatPlanStateLabel(item.currentState)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                    <div>{t("lifecycle.lastCompleted")}: {formatDateLabel(item.lastCompletedDate)}</div>
                    <div>{t("lifecycle.nextDue")}: {formatDateLabel(item.nextDueDate)}</div>
                    <div>{t("lifecycle.originalDueDate")}: {formatDateLabel(occurrence?.original_due_date)}</div>
                    <div>{t("lifecycle.reschedulingReason")}: {occurrence?.reschedule_reason || tCommon("notAvailable")}</div>
                  </div>
                  {occurrence && ["scheduled", "due_soon", "due_today", "overdue"].includes(item.currentState) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => performPlanToday(item.plan, occurrence)}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        {t("lifecycle.performToday")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRescheduleOccurrence(occurrence);
                          setScheduleDate((item.nextDueDate || new Date().toISOString()).slice(0, 10));
                        }}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
                      >
                        {t("lifecycle.reschedule")}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const allTaskItems = useMemo(() => {
    if (!customTasks.length) {
      return taskList;
    }

    const assignedCustom = new Map<string, string[]>();
    const unassignedCustom: string[] = [];

    customTasks.forEach((task) => {
      const header = customTaskGroups[task];
      if (header && checklistHeaders.includes(header)) {
        assignedCustom.set(header, [...(assignedCustom.get(header) ?? []), task]);
      } else {
        unassignedCustom.push(task);
      }
    });

    if (!checklistGroups.length) {
      return [...taskList, ...unassignedCustom];
    }

    const result: string[] = [];
    checklistGroups.forEach((group) => {
      result.push(group.header, ...group.items, ...(assignedCustom.get(group.header) ?? []));
    });

    return [...result, ...unassignedCustom];
  }, [taskList, customTasks, customTaskGroups, checklistGroups, checklistHeaders]);

  const selectedTaskLabels = useMemo(
    () => allTaskItems.filter((task) => checkedTasks[task]),
    [allTaskItems, checkedTasks],
  );

  const taskLabelsForPlan = useCallback((plan: MaintenancePlan): string[] => {
    const planTasks = tokenizeInstructions(plan.instruction);
    const planTaskSet = new Set(planTasks);
    const code = (plan.maintenance_code || plan.plan_id || "").trim().toLowerCase();
    const explicitHeader = planTasks.find((task) => isChecklistHeader(task));
    const explicitHeaderMatches =
      explicitHeader && selectedTaskLabels.some((task) => task.toLowerCase() === explicitHeader.toLowerCase());

    const selectedForPlan = selectedTaskLabels.filter((task) => {
      if (planTaskSet.has(task)) return true;
      const group = customTaskGroups[task];
      if (group && explicitHeader && group.toLowerCase() === explicitHeader.toLowerCase()) return true;
      return Boolean(code) && task.toLowerCase().includes(code);
    });

    if (selectedForPlan.length > 0 || explicitHeaderMatches) {
      return selectedForPlan.filter((task) => !isChecklistHeader(task));
    }

    return [];
  }, [customTaskGroups, selectedTaskLabels]);

  const selectedPreventivePlans = useMemo(() => {
    if (selectedPlanIds.length > 0) {
      return preventivePlans.filter((plan) => selectedPlanIds.includes(plan._id));
    }

    const matched = preventivePlans.filter((plan) => taskLabelsForPlan(plan).length > 0);
    if (matched.length > 0) {
      return matched;
    }

    return selectedTaskLabels.length > 0 && preventivePlans[0] ? [preventivePlans[0]] : [];
  }, [preventivePlans, selectedPlanIds, selectedTaskLabels, taskLabelsForPlan]);

  const availableTaskOptions = useMemo(
    () => allTaskItems.filter((task) => !checkedTasks[task]),
    [allTaskItems, checkedTasks],
  );

  function toggleTask(task: string): void {
    setCheckedTasks((prev) => {
      const next = { ...prev };
      const group = checklistGroups.find((item) => item.header === task);

      if (group && group.items.length > 0) {
        const shouldCheck = !group.items.every((item) => Boolean(prev[item])) || !prev[task];
        next[task] = shouldCheck;
        group.items.forEach((item) => {
          next[item] = shouldCheck;
        });
        return next;
      }

      next[task] = !prev[task];

      const parentGroup = checklistGroups.find((item) => item.items.includes(task));
      if (parentGroup) {
        next[parentGroup.header] = parentGroup.items.every((item) =>
          item === task ? next[item] : Boolean(next[item]),
        );
      }

      return next;
    });
  }

  function addTaskFromSelection(): void {
    const value = selectedTaskToAdd === CUSTOM_OPTION ? customTaskInput.trim() : selectedTaskToAdd.trim();
    if (!value) return;
    if (!customTasks.includes(value)) {
      setCustomTasks((prev) => [...prev, value]);
    }
    if (selectedTaskGroup) {
      setCustomTaskGroups((prev) => ({ ...prev, [value]: selectedTaskGroup }));
    }
    setCheckedTasks((prev) => ({ ...prev, [value]: true }));
    setSelectedTaskToAdd("");
    setSelectedTaskGroup("");
    setCustomTaskInput("");
  }

  function removeCustomTask(task: string): void {
    setCustomTasks((prev) => prev.filter((item) => item !== task));
    setCustomTaskGroups((prev) => {
      const next = { ...prev };
      delete next[task];
      return next;
    });
    setCheckedTasks((prev) => {
      const next = { ...prev };
      delete next[task];
      return next;
    });
  }

  function performPlanToday(plan: MaintenancePlan, occurrence?: PreventiveOccurrence | null): void {
    setSelectedPlanIds([plan._id]);
    setSelectedOccurrenceId(occurrence?._id || "");
    setCompletionDate(new Date().toISOString().slice(0, 16));
    const planTasks = tokenizeInstructions(plan.instruction).filter((task) => !isChecklistHeader(task));
    setCheckedTasks((prev) => {
      const next = { ...prev };
      planTasks.forEach((task) => {
        next[task] = true;
      });
      return next;
    });
    showNotification("success", `${plan.maintenance_code || plan.plan_id}: ${t("lifecycle.performToday")}`);
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

  async function submitPreventiveMaintenance(fromDraftId?: string): Promise<void> {
    if (!user?._id || !selectedMachine) {
      setSubmitValidationReason("missing-user-or-machine");
      showNotification("error", t("validation"));
      return;
    }

    if (selectedTaskLabels.length === 0) {
      setSubmitValidationReason("no-tasks-selected");
      showNotification("error", t("preventiveTasks"));
      return;
    }

    if (!selectedOccurrenceId) {
      // The Operator must act on an already-scheduled occurrence (via
      // "Perform today" on a due/overdue card) rather than an arbitrary
      // plan — this endpoint updates an assigned work order, it never
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
      const taskSummary = selectedTaskLabels.join(" | ");
      const lubrication =
        selectedLubrifiant && lubrificationQty.trim() && Number(lubrificationQty) > 0
          ? { lubrifiant_id: selectedLubrifiant, quantity: Number(lubrificationQty) }
          : undefined;

      const response = await apiService.submitOperatorPreventiveMaintenance({
        work_order_id: selectedOccurrenceId,
        tasks_completed: selectedTaskLabels,
        condition: conditionValue,
        comments: comments.trim() || undefined,
        lubrication,
      });

      const workOrderId = response?.data?.workOrder?._id as string | undefined;
      const reportId = response?.data?.report?._id as string | undefined;
      if (!workOrderId || !reportId) {
        throw new Error("Preventive submission failed");
      }

      await uploadPhotoIfPresent(selectedMachine);
      addGeneratedReport({
        id: `${workOrderId}-${reportId}`,
        type: "preventive",
        workOrderId,
        reportId,
        machine: machineLabel,
        summary: taskSummary,
        createdAt: new Date().toISOString(),
        status: "waiting_validation",
      });

      const refreshedState = await apiService.getOperatorPreventiveStates({ machineId: selectedMachine });
      setPreventiveState((refreshedState.data || null) as PreventiveStateResponse | null);
      setSelectedOccurrenceId("");

      if (fromDraftId) {
        const nextDrafts = drafts.filter((item) => item.id !== fromDraftId);
        persistDrafts(nextDrafts);
        setSelectedDraftId("");
      }

      showNotification("success", t("notifications.submitSuccess"));
    } catch (error) {
      console.error("Failed to submit preventive maintenance", error);
      setSubmitValidationReason("submit-failed");
      showNotification("error", extractApiErrorMessage(error, tCommon("error")));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="operator">
        <DashboardLayout title={t("preventiveMaintenance")}>
          <div className="panel">{tCommon("loading")}</div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("preventiveMaintenance")}>
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

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-700">{t("progress")}</div>
                  <div className="text-xs text-slate-500">
                    {selectedTaskLabels.length}/{allTaskItems.length || 1} {t("completed")}
                  </div>
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {allTaskItems.length > 0 ? Math.round((selectedTaskLabels.length / allTaskItems.length) * 100) : 0}%
                </div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${allTaskItems.length > 0 ? Math.round((selectedTaskLabels.length / allTaskItems.length) * 100) : 0}%` }}
                />
              </div>
            </div>
          </div>

          <div className="col-span-full grid grid-cols-1 gap-4 xl:grid-cols-2">
            {renderOccurrenceSection(t("lifecycle.dueToday"), preventiveSections?.dueToday)}
            {renderOccurrenceSection(t("lifecycle.overdue"), preventiveSections?.overdue)}
            {renderOccurrenceSection(t("lifecycle.upcoming"), preventiveSections?.upcoming)}
            {renderOccurrenceSection(t("lifecycle.waitingValidation"), preventiveSections?.waitingValidation)}
            {renderOccurrenceSection(t("lifecycle.returned"), preventiveSections?.returned)}
          </div>

          {preventivePlans.length > 0 ? (
            <div className="col-span-full panel">
              <div className="card-title mb-3">{t("lifecycle.preventivePlan")}</div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {(preventiveSections?.preventivePlan || preventivePlans.map((plan) => ({
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
                } satisfies PreventivePlanState))).map((item) => (
                  <div key={item.plan._id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-bold text-slate-900">{item.plan.maintenance_code || item.plan.plan_id}</div>
                        <div className="mt-1 text-sm text-slate-500">{item.plan.responsable || tCommon("notAvailable")}</div>
                      </div>
                      <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {item.frequency?.normalized || item.plan.unite_frequence}
                      </div>
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-slate-700">
                      <div><span className="font-semibold">{t("preventiveTasks")}: </span>{item.plan.instruction || tCommon("notAvailable")}</div>
                      <div><span className="font-semibold">{t("module")}: </span>{item.module?.module_id || tCommon("notAvailable")}</div>
                      <div><span className="font-semibold">{t("lifecycle.lastCompleted")}: </span>{formatDateLabel(item.lastCompletedDate)}</div>
                      <div><span className="font-semibold">{t("lifecycle.nextDue")}: </span>{formatDateLabel(item.nextDueDate)}</div>
                      <div><span className="font-semibold">{t("smartCalendar.status")}: </span>{formatPlanStateLabel(item.currentState)}</div>
                      <div><span className="font-semibold">{t("openManual")}: </span>{item.plan.documentation || tCommon("notAvailable")}</div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => performPlanToday(item.plan, item.currentOccurrence)}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        {t("lifecycle.performToday")}
                      </button>
                      {item.currentState === "not_scheduled" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSchedulePlan(item.plan);
                            setScheduleDate(new Date().toISOString().slice(0, 10));
                          }}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700"
                        >
                          {t("lifecycle.setFirstInterventionDate")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("preventiveTasks")}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {allTaskItems.length === 0 && <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>}
              {allTaskItems.map((task, index) => {
                const isHeader = isChecklistHeader(task);
                const isCustomTask = customTasks.includes(task);
                return (
                  <div
                    key={task}
                    className={`flex items-start gap-3 rounded-2xl border p-4 text-sm cursor-pointer transition-colors ${
                      checkedTasks[task]
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    } ${isHeader ? "md:col-span-2 font-semibold" : ""}`}
                  >
                    <label className="flex min-w-0 flex-1 items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(checkedTasks[task])}
                        onChange={() => toggleTask(task)}
                        data-testid={`preventive-task-checkbox-${index}`}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span className={`leading-5 ${!isHeader ? "pl-1" : ""}`}>{task}</span>
                    </label>
                    {isCustomTask ? (
                      <button
                        type="button"
                        onClick={() => removeCustomTask(task)}
                        data-testid={`preventive-remove-custom-task-${index}`}
                        className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        {tCommon("delete")}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-3">
              <select
                value={selectedTaskGroup}
                onChange={(event) => setSelectedTaskGroup(event.target.value)}
                data-testid="preventive-custom-task-group"
                className="w-48 border rounded-lg px-3 py-2"
                title={t("preventiveTasks")}
              >
                <option value="">{t("maintenanceCode")}</option>
                {checklistHeaders.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              <select
                value={selectedTaskToAdd}
                onChange={(event) => setSelectedTaskToAdd(event.target.value)}
                data-testid="preventive-custom-task-select"
                className="flex-1 border rounded-lg px-3 py-2"
                title={t("preventiveTasks")}
              >
                <option value="">{tCommon("actions.search")}</option>
                {availableTaskOptions.map((task) => (
                  <option key={task} value={task}>
                    {task}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>{t("custom")}</option>
              </select>
              {selectedTaskToAdd === CUSTOM_OPTION ? (
                <input
                  value={customTaskInput}
                  onChange={(event) => setCustomTaskInput(event.target.value)}
                  data-testid="preventive-custom-task-input"
                  className="flex-1 border rounded-lg px-3 py-2"
                  placeholder={t("comments")}
                />
              ) : null}
              <button
                onClick={addTaskFromSelection}
                data-testid="preventive-add-custom-task"
                className="px-4 py-2 rounded-lg bg-slate-900 text-white"
              >
                {tCommon("add")}
              </button>
            </div>
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("machineCondition")}</div>
            <select
              value={condition}
              onChange={(event) => setCondition(event.target.value as MachineCondition)}
              title={t("machineCondition")}
              aria-label={t("machineCondition")}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="good">{t("good")}</option>
              <option value="followUp">{t("followUp")}</option>
              <option value="technicianRequired">{t("technicianRequired")}</option>
              <option value="custom">{t("custom")}</option>
            </select>
            {condition === "custom" && (
              <input
                value={customCondition}
                onChange={(event) => setCustomCondition(event.target.value)}
                className="w-full border rounded-lg px-3 py-2 mt-3"
                placeholder={t("comments")}
              />
            )}
          </div>

          <div className="col-span-full panel">
            <div className="stats-grid grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2">{t("comments")}</label>
                <input
                  value={comments}
                  onChange={(event) => setComments(event.target.value.slice(0, 180))}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder={t("comments")}
                />
              </div>
              <div>
                <label className="block text-sm mb-2">{t("lifecycle.actualExecutionDate")}</label>
                <div
                  data-testid="preventive-execution-date-note"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                >
                  {new Date().toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("photoUpload")}</div>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              title={t("photoUpload")}
              aria-label={t("photoUpload")}
              placeholder={t("photoUpload")}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("openManual")}</div>
            <div className="flex flex-wrap gap-3">
              {manualDocument ? (
                <button
                  type="button"
                  onClick={() => setPreviewDocument(manualDocument)}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white"
                >
                  {t("openManual")}
                </button>
              ) : (
                <span className="text-sm text-slate-500">{tCommon("table.noData")}</span>
              )}
            </div>
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("kpiTitle")}</div>
            {selectedMachineKpi ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="border rounded-lg p-3">{t("mtbf")}: {selectedMachineKpi.mtbf_value ?? tCommon("notAvailable")}</div>
                <div className="border rounded-lg p-3">{t("mttr")}: {selectedMachineKpi.mttr_value ?? tCommon("notAvailable")}</div>
                <div className="border rounded-lg p-3">
                  {t("availability")}: {selectedMachineKpi.availability_rate ?? tCommon("notAvailable")}
                </div>
              </div>
            ) : (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            )}
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("preventiveMaintenance")}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-sm mb-2">{t("lubricant")}</label>
                <select
                  value={selectedLubrifiant}
                  onChange={(event) => setSelectedLubrifiant(event.target.value)}
                  title={t("lubricant")}
                  aria-label={t("lubricant")}
                  className="w-full border rounded-lg px-3 py-2"
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
                <label className="block text-sm mb-2">{t("quantity")}</label>
                <select
                  value={selectedLubrificationQtyMode}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedLubrificationQtyMode(value);
                    setLubrificationQty(value === CUSTOM_OPTION ? "" : value);
                  }}
                  title={t("quantity")}
                  aria-label={t("quantity")}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">{tCommon("actions.search")}</option>
                  {LUBRIFICATION_QTY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION}>{t("custom")}</option>
                </select>
                {selectedLubrificationQtyMode === CUSTOM_OPTION && (
                  <input
                    type="number"
                    min="0"
                    value={lubrificationQty}
                    onChange={(event) => setLubrificationQty(event.target.value)}
                    title={t("quantity")}
                    aria-label={t("quantity")}
                    placeholder={t("quantity")}
                    className="w-full border rounded-lg px-3 py-2 mt-2"
                  />
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveCurrentAsDraft}
                data-testid="preventive-save-draft"
                className="w-full md:w-auto px-5 py-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
              >
                {tCommon("save")}
              </button>
              <button
                disabled={submitting}
                onClick={() => void submitPreventiveMaintenance(selectedDraftId || undefined)}
                data-testid="preventive-submit-button"
                className="w-full md:w-auto px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white"
              >
                {submitting ? tCommon("saving") : t("generateReport")}
              </button>
            </div>
            {submitValidationReason ? (
              <div data-testid="preventive-submit-validation" className="text-sm text-red-600 mt-3">
                {submitValidationMessage}
              </div>
            ) : null}
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("report")}</div>
            {drafts.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {drafts.map((draft, index) => (
                  <button
                    key={draft.id}
                    type="button"
                    data-testid={`preventive-draft-${index}`}
                    onClick={() => openDraft(draft)}
                    className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow ${selectedDraftId === draft.id ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900">{draft.title}</div>
                      <span className="text-xs text-slate-500">{new Date(draft.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-600">{t("machine")}: {draft.selectedMachine || draft.customMachine || tCommon("notAvailable")}</div>
                    <div className="mt-3 flex justify-end">
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteDraft(draft.id);
                        }}
                        className="inline-flex rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        {tCommon("delete")}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="col-span-full panel overflow-x-auto">
            <div className="card-title mb-3">{t("myReports")}</div>
            {generatedReports.filter((item) => item.type === "preventive").length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3">{t("report")}</th>
                    <th className="text-left py-2 px-3">{t("workOrder")}</th>
                    <th className="text-left py-2 px-3">{t("machine")}</th>
                    <th className="text-left py-2 px-3">{t("actionsPerformed")}</th>
                    <th className="text-left py-2 px-3">{t("validation")}</th>
                    <th className="text-left py-2 px-3">{tCommon("time.justNow")}</th>
                  </tr>
                </thead>
                <tbody>
                  {generatedReports
                    .filter((item) => item.type === "preventive")
                    .map((item) => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="py-2 px-3 font-mono text-xs">{item.reportId}</td>
                        <td className="py-2 px-3 font-mono text-xs">{item.workOrderId}</td>
                        <td className="py-2 px-3">{item.machine}</td>
                        <td className="py-2 px-3 truncate max-w-xs">{item.summary}</td>
                        <td className="py-2 px-3">{item.status === "waiting_validation" ? t("waitingValidation") : item.status}</td>
                        <td className="py-2 px-3">{new Date(item.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <Modal
          isOpen={Boolean(previewDocument)}
          onClose={() => setPreviewDocument(null)}
          title={previewDocument?.file_name || t("openManual")}
          size="xl"
        >
          {previewDocument ? (
            <DocumentAttachmentViewer document={previewDocument} title={previewDocument.file_name} />
          ) : null}
        </Modal>

        <Modal
          isOpen={Boolean(schedulePlan)}
          onClose={() => setSchedulePlan(null)}
          title={t("lifecycle.setFirstInterventionDate")}
        >
          <div className="space-y-4">
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
          <div className="space-y-4">
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
