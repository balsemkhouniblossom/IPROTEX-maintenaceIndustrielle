"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { apiService } from "@/services/api";
import { useTranslations } from "next-intl";
import { fetchAllPaginated, normalizeApiItems } from "@/services/pagination";
import { resolveManagedFileUrl } from "@/services/managedFileUrls";

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

interface Panne {
  _id: string;
  code_panne: string;
  description: string;
  gravite?: string;
}

interface PanneSolution {
  _id: string;
  panne_id: EntityRef;
  cause_probable?: string;
  solution_recommandee?: string;
}

interface DocumentEntity {
  _id: string;
  machine_id: EntityRef;
  file_path: string;
  file_name?: string;
  type_document?: string;
}

interface Catalogue {
  _id: string;
  part_id: string;
  nom_piece: string;
  ref_constructeur: string;
}

interface Stock {
  _id: string;
  part_id: EntityRef;
  quantite_en_stock: number;
}

interface WorkOrder {
  _id: string;
  ot_id: string;
  type_maintenance?: string;
  status?: string;
  machine_id?: EntityRef | { _id?: string; machine_id?: string };
  date_created?: string;
}

interface InterventionReport {
  _id: string;
  report_id: string;
  ot_id: EntityRef;
  description_action?: string;
  cause_racine?: string;
  date_debut?: string;
  date_fin?: string;
}

function refId(value: EntityRef | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id ?? value.id ?? "";
}

function tokenize(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(/\r?\n|[;,]/g)
    .map((item) => item.replace(/^[-*\u2022\s]+/, "").trim())
    .filter(Boolean);
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

type CorrectiveResult = "solved" | "notSolved" | "technicianRequired" | "custom";
const CUSTOM_OPTION = "__custom__";
const CORRECTIVE_DRAFTS_STORAGE_PREFIX = "operator_corrective_drafts";

interface CorrectiveDraft {
  id: string;
  title: string;
  updatedAt: string;
  selectedCategory: string;
  selectedMachine: string;
  selectedPanne: string;
  selectedSymptoms: Record<string, boolean>;
  checkedActions: Record<string, boolean>;
  customActions: string[];
  result: CorrectiveResult;
  customResult: string;
  comments: string;
  selectedParts: Record<string, string>;
}

function OperatorCorrectivePageContent() {
  const t = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [machineTypes, setMachineTypes] = useState<MachineType[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [pannes, setPannes] = useState<Panne[]>([]);
  const [panneSolutions, setPanneSolutions] = useState<PanneSolution[]>([]);
  const [documents, setDocuments] = useState<DocumentEntity[]>([]);
  const [catalogues, setCatalogues] = useState<Catalogue[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [interventionReports, setInterventionReports] = useState<InterventionReport[]>([]);

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [selectedPanne, setSelectedPanne] = useState("");
  const [selectedSymptoms, setSelectedSymptoms] = useState<Record<string, boolean>>({});
  const [faultSearch, setFaultSearch] = useState("");

  const [checkedActions, setCheckedActions] = useState<Record<string, boolean>>({});
  const [selectedActionToAdd, setSelectedActionToAdd] = useState("");
  const [customActionInput, setCustomActionInput] = useState("");
  const [customActions, setCustomActions] = useState<string[]>([]);

  const [result, setResult] = useState<CorrectiveResult>("solved");
  const [customResult, setCustomResult] = useState("");
  const [comments, setComments] = useState("");

  const [photo, setPhoto] = useState<File | null>(null);
  const [selectedParts, setSelectedParts] = useState<Record<string, string>>({});
  const [submitValidationReason, setSubmitValidationReason] = useState("");
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [faultsLoading, setFaultsLoading] = useState(false);
  const [drafts, setDrafts] = useState<CorrectiveDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const draftStorageKey = useMemo(
    () => `${CORRECTIVE_DRAFTS_STORAGE_PREFIX}:${user?._id || "anonymous"}`,
    [user?._id],
  );

  const submitValidationMessage = useMemo(() => {
    if (!submitValidationReason) return "";

    switch (submitValidationReason) {
      case "missing-user-machine-or-fault":
        return t("notifications.validationFailed");
      case "no-actions-selected":
        return t("actionsPerformed");
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
    const raw = apiError?.response?.data?.message;
    if (Array.isArray(raw) && raw.length) {
      return raw.join(" ");
    }
    if (typeof raw === "string" && raw.trim()) {
      return raw;
    }
    return fallback;
  }

  const initialTypeId = searchParams.get("type") || "";
  const initialMachineId = searchParams.get("machine") || "";
  const initialView = searchParams.get("view") || "";
  const intent = searchParams.get("intent") || "";

  useEffect(() => {
    if (!notification) return;

    const timeout = setTimeout(() => {
      setNotification(null);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [notification]);

  function showNotification(type: "success" | "error", message: string): void {
    setNotification({ type, message });
  }

  function resetCorrectiveState(): void {
    setSelectedPanne("");
    setFaultSearch("");
    setSelectedSymptoms({});
    setCheckedActions({});
    setSelectedActionToAdd("");
    setCustomActionInput("");
    setCustomActions([]);
    setResult("solved");
    setCustomResult("");
    setComments("");
    setPhoto(null);
    setSelectedParts({});
    setSubmitValidationReason("");
  }

  function resetFaultSpecificState(): void {
    setSelectedSymptoms({});
    setCheckedActions({});
    setSelectedActionToAdd("");
    setCustomActionInput("");
    setCustomActions([]);
    setResult("solved");
    setCustomResult("");
    setComments("");
    setPhoto(null);
    setSelectedParts({});
    setSubmitValidationReason("");
  }

  function persistDrafts(nextDrafts: CorrectiveDraft[]): void {
    setDrafts(nextDrafts);
    localStorage.setItem(draftStorageKey, JSON.stringify(nextDrafts));
  }

  function saveCurrentAsDraft(): void {
    const machineLabel = machines.find((item) => item._id === selectedMachine)?.machine_id || t("machine");
    const draftId = selectedDraftId || uniqueId("DRAFT-COR");
    const nextDraft: CorrectiveDraft = {
      id: draftId,
      title: machineLabel,
      updatedAt: new Date().toISOString(),
      selectedCategory,
      selectedMachine,
      selectedPanne,
      selectedSymptoms,
      checkedActions,
      customActions,
      result,
      customResult,
      comments,
      selectedParts,
    };

    const nextDrafts = selectedDraftId
      ? drafts.map((item) => (item.id === selectedDraftId ? nextDraft : item))
      : [nextDraft, ...drafts];

    persistDrafts(nextDrafts);
    setSelectedDraftId(draftId);
    showNotification("success", t("notifications.draftSaved"));
  }

  function openDraft(draft: CorrectiveDraft): void {
    setSelectedDraftId(draft.id);
    setSelectedCategory(draft.selectedCategory);
    setSelectedMachine(draft.selectedMachine);
    setSelectedPanne(draft.selectedPanne);
    setSelectedSymptoms(draft.selectedSymptoms);
    setCheckedActions(draft.checkedActions);
    setCustomActions(draft.customActions);
    setResult(draft.result);
    setCustomResult(draft.customResult);
    setComments(draft.comments);
    setSelectedParts(draft.selectedParts);
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
    async function loadAll() {
      try {
        setLoading(true);
        const [
          machineTypeItems,
          machineItems,
          documentItems,
          catalogueItems,
          stockItems,
          workOrderItems,
          reportItems,
        ] = await Promise.all([
          fetchAllPaginated<MachineType>((pagination) => apiService.getOperatorMachineTypes(pagination)),
          fetchAllPaginated<Machine>((pagination) => apiService.getMyMachines(pagination)),
          fetchAllPaginated<DocumentEntity>((pagination) => apiService.getOperatorManuals(pagination)),
          fetchAllPaginated<Catalogue>((pagination) => apiService.getOperatorCatalogues(pagination)),
          fetchAllPaginated<Stock>((pagination) => apiService.getOperatorStocks(pagination)),
          fetchAllPaginated<WorkOrder>((pagination) => apiService.getMyWorkOrders(pagination)),
          fetchAllPaginated<InterventionReport>((pagination) => apiService.getMyInterventionReports(pagination)),
        ]);

        setMachineTypes(machineTypeItems);
        setMachines(machineItems);
        setPannes([]);
        setPanneSolutions([]);
        setDocuments(documentItems);
        setCatalogues(catalogueItems);
        setStocks(stockItems);
        setWorkOrders(workOrderItems);
        setInterventionReports(reportItems);
      } catch (error) {
        console.error("Failed to load corrective workflow data", error);
      } finally {
        setLoading(false);
      }
    }

    void loadAll();
  }, []);

  useEffect(() => {
    async function loadScopedFaults() {
      if (!selectedMachine && !selectedCategory) {
        setPannes([]);
        setPanneSolutions([]);
        return;
      }

      try {
        setFaultsLoading(true);
        const faultItems = await fetchAllPaginated<Panne>((pagination) =>
          apiService.getOperatorFaults({
            ...pagination,
            machineId: selectedMachine || undefined,
            machineTypeId: selectedCategory || undefined,
            search: faultSearch || undefined,
          }),
        );
        setPannes(faultItems);
      } catch (error) {
        console.error("Failed to load scoped faults", error);
        setPannes([]);
      } finally {
        setFaultsLoading(false);
      }
    }

    void loadScopedFaults();
  }, [selectedCategory, selectedMachine, faultSearch]);

  useEffect(() => {
    async function loadFaultSolutions() {
      if (!selectedPanne) {
        setPanneSolutions([]);
        return;
      }

      try {
        const response = await apiService.getOperatorFaultSolutions({
          page: 1,
          limit: 100,
          panneId: selectedPanne,
          machineId: selectedMachine || undefined,
          machineTypeId: selectedCategory || undefined,
        });
        setPanneSolutions(normalizeApiItems<PanneSolution>(response.data));
      } catch (error) {
        console.error("Failed to load fault solutions", error);
        setPanneSolutions([]);
      }
    }

    void loadFaultSolutions();
  }, [selectedCategory, selectedMachine, selectedPanne]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftStorageKey);
      if (!saved) {
        setDrafts([]);
        return;
      }
      const parsed = JSON.parse(saved) as CorrectiveDraft[];
      if (Array.isArray(parsed)) {
        setDrafts(parsed);
      } else {
        setDrafts([]);
      }
    } catch {
      setDrafts([]);
    }
  }, [draftStorageKey]);

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

  useEffect(() => {
    if (!machines.length) return;
    if (!initialMachineId && !initialTypeId) return;

    const preselectedMachine = machines.find((machine) => machine._id === initialMachineId);

    if (preselectedMachine) {
      const preselectedType = refId(preselectedMachine.type_id);
      setSelectedCategory(preselectedType);
      setSelectedMachine(preselectedMachine._id);
      return;
    }

    if (initialTypeId) {
      setSelectedCategory(initialTypeId);
    }
  }, [initialMachineId, initialTypeId, machines]);

  useEffect(() => {
    if (loading) return;
    if (initialView !== "history") return;

    const historySection = document.getElementById("machine-history");
    historySection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [initialView, loading]);

  const selectedFault = useMemo(
    () => pannes.find((item) => item._id === selectedPanne) ?? null,
    [pannes, selectedPanne],
  );

  const selectedFaultSolutions = useMemo(
    () => panneSolutions.filter((solution) => refId(solution.panne_id) === selectedPanne),
    [panneSolutions, selectedPanne],
  );

  const visiblePannes = useMemo(() => {
    if (!faultSearch.trim()) {
      return pannes;
    }

    const query = faultSearch.trim().toLowerCase();
    return pannes.filter((panne) =>
      panne.code_panne.toLowerCase().includes(query)
      || panne.description.toLowerCase().includes(query),
    );
  }, [faultSearch, pannes]);

  const symptomOptions = useMemo(
    () => [
      t("symptoms.machineStopped"),
      t("symptoms.noise"),
      t("symptoms.smoke"),
      t("symptoms.overheating"),
      t("symptoms.alarm"),
      t("symptoms.motorBlocked"),
      t("symptoms.noMovement"),
      t("symptoms.oilLeak"),
      t("symptoms.airLeak"),
      t("symptoms.electricalSmell"),
      t("symptoms.other"),
    ],
    [t],
  );

  const correctiveTasks = useMemo(() => {
    const matching = panneSolutions
      .filter((solution) => refId(solution.panne_id) === selectedPanne)
      .flatMap((solution) => tokenize(solution.solution_recommandee));
    return Array.from(new Set(matching));
  }, [panneSolutions, selectedPanne]);

  const allTasks = useMemo(() => [...correctiveTasks, ...customActions], [correctiveTasks, customActions]);

  const selectedActionLabels = useMemo(
    () => allTasks.filter((task) => checkedActions[task]),
    [allTasks, checkedActions],
  );

  const availableActionOptions = useMemo(
    () => allTasks.filter((task) => !checkedActions[task]),
    [allTasks, checkedActions],
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

  const stockByCatalogueId = useMemo(() => {
    const stockMap = new Map<string, number>();
    stocks.forEach((stock) => {
      stockMap.set(refId(stock.part_id), stock.quantite_en_stock ?? 0);
    });
    return stockMap;
  }, [stocks]);

  const machineInterventionHistory = useMemo(() => {
    if (!selectedMachine) return [];

    return interventionReports
      .map((report) => {
        const workOrder = workOrders.find((item) => item._id === refId(report.ot_id));
        if (!workOrder) return null;

        const machineRef = typeof workOrder.machine_id === "string"
          ? workOrder.machine_id
          : refId(workOrder.machine_id as EntityRef);

        if (machineRef !== selectedMachine) return null;

        const date = report.date_fin || report.date_debut || workOrder.date_created || "";

        return {
          id: report._id,
          reportId: report.report_id,
          workOrderId: workOrder.ot_id,
          type: workOrder.type_maintenance || "corrective",
          status: workOrder.status || "waiting_validation",
          action: report.description_action || tCommon("notAvailable"),
          rootCause: report.cause_racine || tCommon("notAvailable"),
          date,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b!.date).getTime() - new Date(a!.date).getTime()) as Array<{
      id: string;
      reportId: string;
      workOrderId: string;
      type: string;
      status: string;
      action: string;
      rootCause: string;
      date: string;
    }>;
  }, [interventionReports, selectedMachine, tCommon, workOrders]);

  function toggleTask(task: string): void {
    setCheckedActions((prev) => ({ ...prev, [task]: !prev[task] }));
  }

  function addActionFromSelection(): void {
    const value = selectedActionToAdd === CUSTOM_OPTION ? customActionInput.trim() : selectedActionToAdd.trim();
    if (!value) return;
    if (!customActions.includes(value)) {
      setCustomActions((prev) => [...prev, value]);
    }
    setCheckedActions((prev) => ({ ...prev, [value]: true }));
    setSelectedActionToAdd("");
    setCustomActionInput("");
  }

  function setPartQuantity(catalogueId: string, quantity: string): void {
    setSelectedParts((prev) => ({ ...prev, [catalogueId]: quantity }));
  }

  async function uploadPhotoIfPresent(machineId: string): Promise<void> {
    if (!photo || !user?._id) return;

    const formData = new FormData();
    formData.append("file", photo);
    formData.append("document_id", uniqueId("DOC"));
    formData.append("machine_id", machineId);
    formData.append("type_document", "fault_photo");
    formData.append("description", t("photoUpload"));
    formData.append("uploaded_by", user._id);

    await apiService.uploadDocument(formData);
  }

  async function submitCorrectiveMaintenance(fromDraftId?: string): Promise<void> {
    if (!user?._id || !selectedMachine || !selectedFault) {
      setSubmitValidationReason("missing-user-machine-or-fault");
      showNotification("error", t("notifications.validationFailed"));
      return;
    }

    if (selectedActionLabels.length === 0) {
      setSubmitValidationReason("no-actions-selected");
      showNotification("error", t("notifications.validationFailed"));
      return;
    }

    const nowIso = new Date().toISOString();
    const resultValue = result === "custom" ? customResult.trim() : result;
    const selectedSymptomLabels = symptomOptions.filter((symptom) => selectedSymptoms[symptom]);

    setSubmitValidationReason("");
    setSubmitting(true);
    try {
      const workOrderPayload = {
        ot_id: uniqueId("WO-COR"),
        machine_id: selectedMachine,
        technician_id: user._id,
        description: `${selectedFault.code_panne} | ${selectedSymptomLabels.join(" | ")} | ${selectedActionLabels.join(" | ")}`,
        type_maintenance: "corrective",
        status: "waiting_validation",
        priorite: "high",
        code_panne: selectedFault.code_panne,
        date_created: nowIso,
        date_start: nowIso,
      };

      const workOrderRes = await apiService.createWorkOrder(workOrderPayload);
      const workOrderId = workOrderRes?.data?._id as string | undefined;
      if (!workOrderId) {
        throw new Error("Work order creation failed");
      }

      const reportPayload = {
        report_id: uniqueId("REP-COR"),
        ot_id: workOrderId,
        technician_id: user._id,
        date_debut: nowIso,
        date_fin: nowIso,
        cause_racine: selectedFault.description,
        description_action: [...selectedSymptomLabels, ...selectedActionLabels].join(" | "),
        etat_final: resultValue,
        validation_responsable: "waiting_validation",
      };

      await apiService.createInterventionReport(reportPayload);

      const requestedParts = Object.entries(selectedParts)
        .filter(([, quantity]) => Number(quantity) > 0)
        .map(([partId, quantity]) => ({ partId, quantity: Number(quantity) }));

      // Requesting parts only records a pending request against this work
      // order — it never reduces Stock directly. Stock is only ever
      // consumed later by the Technician's own transactional flow once the
      // part is approved or used.
      await Promise.all(
        requestedParts.map((part) =>
          apiService.requestOperatorParts(workOrderId, {
            part_id: part.partId,
            quantity: part.quantity,
          }),
        ),
      );

      await uploadPhotoIfPresent(selectedMachine);

      if (fromDraftId) {
        const nextDrafts = drafts.filter((item) => item.id !== fromDraftId);
        persistDrafts(nextDrafts);
        setSelectedDraftId("");
      }

      showNotification("success", t("notifications.submitSuccess"));
    } catch (error) {
      console.error("Failed to submit corrective maintenance", error);
      setSubmitValidationReason("submit-failed");
      showNotification("error", extractApiErrorMessage(error, tCommon("error")));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="operator">
        <DashboardLayout title={t("correctiveMaintenance")}>
          <div className="panel">{tCommon("loading")}</div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("correctiveMaintenance")}>
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

          {intent === "report-issue" ? (
            <div className="col-span-full panel border border-blue-200 bg-blue-50 text-blue-800 text-sm">
              {t("correctiveWorkflowNote")}
            </div>
          ) : null}

          <div className="col-span-full panel">
            <div className="card-title mb-4">{t("correctiveMaintenance")}</div>
            <div className="mb-6">
              <div className="mb-3 text-sm font-semibold text-slate-700">{t("machineCategory")}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {visibleMachineTypes.map((type) => (
                  <button
                    key={type._id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(type._id);
                      setSelectedMachine("");
                      resetCorrectiveState();
                    }}
                    data-testid="corrective-category-select"
                    className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                      selectedCategory === type._id ? "border-blue-500 bg-blue-50 shadow-md" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-lg font-semibold text-slate-900">{type.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{t("viewMachines")}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <div className="mb-3 text-sm font-semibold text-slate-700">{t("machine")}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {machinesForCategory.map((machine) => (
                  <button
                    key={machine._id}
                    type="button"
                    onClick={() => {
                      setSelectedMachine(machine._id);
                      resetCorrectiveState();
                    }}
                    data-testid="corrective-machine-select"
                    className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                      selectedMachine === machine._id ? "border-emerald-500 bg-emerald-50 shadow-md" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-base font-semibold text-slate-900">{machine.machine_id}</div>
                    <div className="mt-1 text-sm text-slate-500">{machine.model || tCommon("notAvailable")}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">{t("fault")}</div>
              <div className="mt-3">
                <input
                  value={faultSearch}
                  onChange={(event) => setFaultSearch(event.target.value)}
                  className="w-full border rounded-xl px-3 py-2"
                  placeholder={tCommon("actions.search")}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {!selectedMachine ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    {t("selectMachineForHistory")}
                  </div>
                ) : faultsLoading ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {tCommon("loading")}
                  </div>
                ) : visiblePannes.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                    {tCommon("table.noData")}
                  </div>
                ) : visiblePannes.map((panne) => (
                  <button
                    key={panne._id}
                    type="button"
                    onClick={() => {
                      setSelectedPanne(panne._id);
                      resetFaultSpecificState();
                    }}
                    data-testid="corrective-fault-select"
                    className={`rounded-3xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                      selectedPanne === panne._id ? "border-red-500 bg-red-50 shadow-md" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-base font-semibold text-slate-900">{panne.code_panne}</div>
                    <div className="mt-1 text-sm text-slate-500 line-clamp-2">{panne.description}</div>
                    {panne.gravite ? (
                      <div className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {panne.gravite}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("solution")}</div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-700">{t("fault")}</div>
                <div className="mt-2 text-lg font-bold text-slate-900">
                  {selectedFault ? `${selectedFault.code_panne} - ${selectedFault.description}` : tCommon("table.noData")}
                </div>
                <div className="mt-3 text-sm text-slate-600">
                  {selectedFault?.gravite ? `${t("validation")}: ${selectedFault.gravite}` : tCommon("notAvailable")}
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-700">{t("solution")}</div>
                {selectedFaultSolutions.length === 0 ? (
                  <div className="mt-2 text-sm text-slate-500">{tCommon("table.noData")}</div>
                ) : (
                  <div className="mt-3 space-y-3 text-sm text-slate-700">
                    {selectedFaultSolutions.map((solution) => (
                      <div key={solution._id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div><span className="font-semibold">{t("solution")}: </span>{solution.solution_recommandee || tCommon("notAvailable")}</div>
                        <div className="mt-2"><span className="font-semibold">{t("validationQueue")}: </span>{solution.cause_probable || tCommon("notAvailable")}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-3 text-sm font-semibold text-slate-700">{t("symptoms.title")}</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {symptomOptions.map((symptom, index) => (
                  <label key={symptom} className={`flex items-center gap-3 rounded-2xl border p-3 text-sm transition-colors ${selectedSymptoms[symptom] ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedSymptoms[symptom])}
                      onChange={() => setSelectedSymptoms((prev) => ({ ...prev, [symptom]: !prev[symptom] }))}
                      data-testid={`corrective-symptom-checkbox-${index}`}
                    />
                    <span>{symptom}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-2">
              {allTasks.length === 0 && <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>}
              {allTasks.map((task, index) => (
                <label key={task} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(checkedActions[task])}
                    onChange={() => toggleTask(task)}
                    data-testid={`corrective-task-checkbox-${index}`}
                  />
                  <span>{task}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <select
                value={selectedActionToAdd}
                onChange={(event) => setSelectedActionToAdd(event.target.value)}
                data-testid="corrective-custom-action-select"
                className="flex-1 border rounded-lg px-3 py-2"
                title={t("actionsPerformed")}
              >
                <option value="">{tCommon("actions.search")}</option>
                {availableActionOptions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>{t("custom")}</option>
              </select>
              {selectedActionToAdd === CUSTOM_OPTION ? (
                <input
                  value={customActionInput}
                  onChange={(event) => setCustomActionInput(event.target.value)}
                  data-testid="corrective-custom-action-input"
                  className="flex-1 border rounded-lg px-3 py-2"
                  placeholder={t("actionsPerformed")}
                />
              ) : null}
              <button
                onClick={addActionFromSelection}
                data-testid="corrective-add-custom-action"
                className="px-4 py-2 rounded-lg bg-slate-900 text-white"
              >
                {tCommon("add")}
              </button>
            </div>
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("actionsPerformed")}</div>
            <select
              value={result}
              onChange={(event) => setResult(event.target.value as CorrectiveResult)}
              title={t("actionsPerformed")}
              aria-label={t("actionsPerformed")}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="solved">{t("solved")}</option>
              <option value="notSolved">{t("notSolved")}</option>
              <option value="technicianRequired">{t("technicianRequired")}</option>
              <option value="custom">{t("custom")}</option>
            </select>
            {result === "custom" && (
              <input
                value={customResult}
                onChange={(event) => setCustomResult(event.target.value)}
                className="w-full border rounded-lg px-3 py-2 mt-3"
                placeholder={t("comments")}
              />
            )}
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
            {manualDocument ? (
              <a
                href={resolveManagedFileUrl(manualDocument.file_path)}
                target="_blank"
                rel="noreferrer"
                className="inline-block px-4 py-2 rounded-lg bg-blue-600 text-white"
              >
                {t("openManual")}
              </a>
            ) : (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            )}
          </div>

          <div id="machine-history" className="col-span-full panel">
            <div className="card-title mb-3">{t("report")} - {t("machine")}: {t("all")}</div>
            <div className="text-sm text-slate-500 mb-3">
              {selectedMachine
                ? t("machineInterventionHistory")
                : t("selectMachineForHistory")}
            </div>
            {!selectedMachine ? null : machineInterventionHistory.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="space-y-3">
                {machineInterventionHistory.slice(0, 8).map((item) => (
                  <div key={item.id} className="border rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-sm">{item.reportId} | {item.workOrderId}</div>
                      <div className="text-xs text-slate-500">
                        {item.date ? new Date(item.date).toLocaleString() : tCommon("notAvailable")}
                      </div>
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      {item.type === "preventive" ? t("preventive") : t("corrective")} | {item.status}
                    </div>
                    <div className="text-sm mt-2">
                      <span className="font-medium">{t("actionsPerformed")}: </span>{item.action}
                    </div>
                    <div className="text-sm mt-1">
                      <span className="font-medium">{t("fault")}: </span>{item.rootCause}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("spareParts")}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {catalogues.map((part) => (
                <div key={part._id} className="border rounded-lg p-3">
                  <div className="font-medium">{part.nom_piece}</div>
                  <div className="text-xs text-slate-500">{part.ref_constructeur}</div>
                  <div className="text-xs mt-1">
                    {t("stockQuantity")}: {stockByCatalogueId.get(part._id) ?? 0}
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={selectedParts[part._id] ?? ""}
                    onChange={(event) => setPartQuantity(part._id, event.target.value)}
                    className="w-full border rounded-lg px-3 py-2 mt-2"
                    placeholder={t("partRequest")}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-full panel">
            <label className="block text-sm mb-2">{t("comments")}</label>
            <input
              value={comments}
              onChange={(event) => setComments(event.target.value.slice(0, 180))}
              data-testid="corrective-comments-input"
              className="w-full border rounded-lg px-3 py-2 mb-4"
              placeholder={t("comments")}
            />

            {submitValidationReason ? (
              <div data-testid="corrective-submit-validation" className="text-sm text-red-600 mb-3">
                {submitValidationMessage}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveCurrentAsDraft}
                data-testid="corrective-save-draft"
                className="w-full md:w-auto px-5 py-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
              >
                {tCommon("save")}
              </button>
              <button
                disabled={submitting}
                onClick={() => void submitCorrectiveMaintenance(selectedDraftId || undefined)}
                data-testid="corrective-submit-button"
                className="w-full md:w-auto px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white"
              >
                {submitting ? tCommon("saving") : t("generateReport")}
              </button>
            </div>
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
                    data-testid={`corrective-draft-${index}`}
                    onClick={() => openDraft(draft)}
                    className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow ${selectedDraftId === draft.id ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900">{draft.title}</div>
                      <span className="text-xs text-slate-500">{new Date(draft.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-600">{t("fault")}: {draft.selectedPanne || tCommon("notAvailable")}</div>
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
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export default function OperatorCorrectivePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <OperatorCorrectivePageContent />
    </Suspense>
  );
}
