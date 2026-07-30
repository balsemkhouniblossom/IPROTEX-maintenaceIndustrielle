"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { apiService } from "@/services/api";
import { useTranslations } from "next-intl";
import { fetchAllPaginated, normalizeApiItems } from "@/services/pagination";
import { extractApiErrorMessage } from "@/services/apiErrors";
import { invalidateList, LIST_EVENTS } from "@/services/listInvalidation";
import { CORRECTIVE_REQUIRED_FIELDS, validateCorrectiveWorkflow } from "@/services/correctiveMaintenanceWorkflow";
import { Modal } from "@/components/Modal";
import { isCorrectiveMaintenanceType } from "@/services/maintenanceType";
import KnowledgeSuggestions from "@/components/knowledge-base/KnowledgeSuggestions";
import AiAssistantPanel from "@/components/ai-assistant/AiAssistantPanel";
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

interface WorkOrder {
  _id: string;
  type_maintenance?: string;
  status?: string;
  machine_id?: { _id?: string; id?: string; machine_id?: string } | string;
  date_created?: string;
}

interface InterventionReport {
  _id: string;
  ot_id: EntityRef;
  description_action?: string;
  validation_responsable?: string;
  date_debut?: string;
  date_fin?: string;
}

interface ReportPhotoDocument {
  _id?: string;
  id?: string;
  machine_id?: EntityRef;
  work_order_id?: EntityRef;
  intervention_report_id?: EntityRef;
  type_document?: string;
  file_path?: string;
  file_url?: string;
  preview_path?: string;
  file_name?: string;
  mime_type?: string;
  content_type?: string;
  date_ajout?: string;
  createdAt?: string;
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
  photoDocument?: ReportPhotoDocument;
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
const REPORTS_STORAGE_KEY = "operator_generated_reports_history";

function correctiveReportElementId(reportId: string): string {
  return `corrective-report-${reportId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function normalizeReportPhotoDocument(document: ReportPhotoDocument): ReportPhotoDocument {
  const inferredMimeType =
    document.mime_type ||
    document.content_type ||
    (document.type_document?.toLowerCase().includes("photo") ? "image/webp" : undefined);

  return {
    ...document,
    mime_type: inferredMimeType,
  };
}

function reportRowKey(report: GeneratedReportRow): string {
  return report.reportId || report.workOrderId || report.id;
}

function reportRowsReferToSameRecord(
  left: GeneratedReportRow,
  right: GeneratedReportRow,
): boolean {
  return Boolean(
    (left.reportId && left.reportId === right.reportId) ||
      (left.workOrderId && left.workOrderId === right.workOrderId) ||
      left.id === right.id,
  );
}

function isPhotoNearReport(document: ReportPhotoDocument, reportDate: string): boolean {
  if (!reportDate) return false;
  const documentTime = new Date(document.createdAt || document.date_ajout || "").getTime();
  const reportTime = new Date(reportDate).getTime();
  if (!Number.isFinite(documentTime) || !Number.isFinite(reportTime)) return false;
  return Math.abs(documentTime - reportTime) <= 10 * 60 * 1000;
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
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [interventionReports, setInterventionReports] = useState<InterventionReport[]>([]);
  const [reportPhotoDocuments, setReportPhotoDocuments] = useState<ReportPhotoDocument[]>([]);

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [selectedPanne, setSelectedPanne] = useState("");
  const [selectedSymptoms, setSelectedSymptoms] = useState<Record<string, boolean>>({});
  const [showMoreSymptoms, setShowMoreSymptoms] = useState(false);
  const [faultSearch, setFaultSearch] = useState("");

  const [checkedActions, setCheckedActions] = useState<Record<string, boolean>>({});
  const [customActions, setCustomActions] = useState<string[]>([]);

  const [result, setResult] = useState<CorrectiveResult>("solved");
  const [customResult, setCustomResult] = useState("");
  const [comments, setComments] = useState("");

  const [photo, setPhoto] = useState<File | null>(null);
  const [submitValidationReason, setSubmitValidationReason] = useState("");
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [faultsLoading, setFaultsLoading] = useState(false);
  const [generatedReports, setGeneratedReports] = useState<GeneratedReportRow[]>([]);
  const [selectedGeneratedReport, setSelectedGeneratedReport] = useState<GeneratedReportRow | null>(null);
  const [highlightedReportId, setHighlightedReportId] = useState("");

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
    setShowMoreSymptoms(false);
    setCheckedActions({});
    setCustomActions([]);
    setResult("solved");
    setCustomResult("");
    setComments("");
    setPhoto(null);
    setSubmitValidationReason("");
  }

  function resetFaultSpecificState(): void {
    setSelectedSymptoms({});
    setShowMoreSymptoms(false);
    setCheckedActions({});
    setCustomActions([]);
    setResult("solved");
    setCustomResult("");
    setComments("");
    setPhoto(null);
    setSubmitValidationReason("");
  }

  function addGeneratedReport(report: GeneratedReportRow): void {
    setGeneratedReports((prev) => {
      const next = [report, ...prev].slice(0, 30);
      localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    async function loadAll() {
      try {
        setLoading(true);
        const [machineTypeItems, machineItems, workOrderItems, reportItems, documentItems] = await Promise.all([
          fetchAllPaginated<MachineType>((pagination) => apiService.getOperatorMachineTypes(pagination)),
          fetchAllPaginated<Machine>((pagination) => apiService.getMyMachines(pagination)),
          fetchAllPaginated<WorkOrder>((pagination) => apiService.getMyWorkOrders(pagination)),
          fetchAllPaginated<InterventionReport>((pagination) => apiService.getMyInterventionReports(pagination)),
          fetchAllPaginated<ReportPhotoDocument>((pagination) => apiService.getDocuments(pagination)),
        ]);

        setMachineTypes(machineTypeItems);
        setMachines(machineItems);
        setWorkOrders(workOrderItems);
        setInterventionReports(reportItems);
        setReportPhotoDocuments(
          documentItems.filter((item) =>
            item.type_document?.toLowerCase().includes("photo"),
          ).map(normalizeReportPhotoDocument),
        );
        setPannes([]);
        setPanneSolutions([]);
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

  const machinesForCategory = useMemo(
    () => machines.filter((machine) => refId(machine.type_id) === selectedCategory),
    [machines, selectedCategory],
  );

  // machineTypes is already scoped server-side (getOperatorMachineTypes) to the
  // categories the operator can access, with no client-side re-filtering needed.
  const visibleMachineTypes = machineTypes;

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

  const selectedMachineLabel = useMemo(
    () => machines.find((item) => item._id === selectedMachine)?.machine_id || tCommon("notAvailable"),
    [machines, selectedMachine, tCommon],
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

  const primarySymptomOptions = useMemo(() => symptomOptions.slice(0, 5), [symptomOptions]);
  const extraSymptomOptions = useMemo(() => symptomOptions.slice(5), [symptomOptions]);
  const visibleSymptomOptions = showMoreSymptoms ? symptomOptions : primarySymptomOptions;

  const correctiveTasks = useMemo(() => {
    const matching = selectedFaultSolutions.flatMap((solution) => tokenize(solution.solution_recommandee));
    return Array.from(new Set(matching));
  }, [selectedFaultSolutions]);

  const allTasks = useMemo(() => [...correctiveTasks, ...customActions], [correctiveTasks, customActions]);

  const selectedActionLabels = useMemo(
    () => allTasks.filter((task) => checkedActions[task]),
    [allTasks, checkedActions],
  );

  const selectedSymptomLabels = useMemo(
    () => symptomOptions.filter((symptom) => selectedSymptoms[symptom]),
    [selectedSymptoms, symptomOptions],
  );

  const resultLabel = result === "custom" ? customResult.trim() : t(result);
  const correctiveValidation = useMemo(
    () =>
      validateCorrectiveWorkflow({
        machineId: selectedMachine,
        faultCode: selectedFault?.code_panne,
        selectedActions: selectedActionLabels,
        selectedSymptoms: selectedSymptomLabels,
        comments,
        resultLabel,
      }),
    [comments, resultLabel, selectedActionLabels, selectedFault?.code_panne, selectedMachine, selectedSymptomLabels],
  );
  const reportActionLabels = correctiveValidation.actions;
  const canSubmitCorrective = correctiveValidation.canSubmit && !submitting;
  const correctiveProgress = correctiveValidation.progress;
  const correctiveSubmitHint = correctiveValidation.missingFields
    .map((field) => {
      if (field === CORRECTIVE_REQUIRED_FIELDS.machine) return t("machine");
      if (field === CORRECTIVE_REQUIRED_FIELDS.faultOrSymptoms) return `${t("fault")} / ${t("symptoms.title")}`;
      return `${t("symptoms.title")} / ${t("comments")} / ${t("actionsPerformed")}`;
    })
    .join(", ");
  const selectedFaultLabel = selectedFault ? `${selectedFault.code_panne} - ${selectedFault.description}` : t("fault");
  const backendCorrectiveReports = useMemo(() => {
    return interventionReports
      .map((report) => {
        const workOrder = workOrders.find((item) => item._id === refId(report.ot_id));
        if (!workOrder || !isCorrectiveMaintenanceType(workOrder.type_maintenance)) {
          return null;
        }

        const machineId = refId(workOrder.machine_id);
        const machine =
          typeof workOrder.machine_id === "string"
            ? workOrder.machine_id
            : workOrder.machine_id?.machine_id || tCommon("notAvailable");
        const createdAt = report.date_fin || report.date_debut || workOrder.date_created || "";
        const photoDocument = reportPhotoDocuments.find(
          (document) =>
            refId(document.intervention_report_id) === report._id ||
            refId(document.work_order_id) === workOrder._id,
        ) ?? reportPhotoDocuments.find(
          (document) =>
            machineId &&
            refId(document.machine_id) === machineId &&
            isPhotoNearReport(document, createdAt),
        );

        return {
          id: `backend-${report._id}`,
          type: "corrective" as const,
          workOrderId: workOrder._id,
          reportId: report._id,
          machine,
          summary: report.description_action || tCommon("notAvailable"),
          createdAt,
          status: workOrder.status || report.validation_responsable || "waiting_validation",
          photoDocument,
        };
      })
      .filter(Boolean) as GeneratedReportRow[];
  }, [interventionReports, reportPhotoDocuments, tCommon, workOrders]);

  const correctiveGeneratedReports = useMemo(() => {
    const localReports = generatedReports.filter((item) => item.type === "corrective");
    const backendByKey = new Map<string, GeneratedReportRow>();
    backendCorrectiveReports.forEach((item) => {
      backendByKey.set(reportRowKey(item), item);
    });
    const seen = new Set<string>();
    return [...localReports, ...backendCorrectiveReports]
      .map((item) => {
        const backendMatch =
          backendByKey.get(reportRowKey(item)) ||
          backendCorrectiveReports.find((backendItem) =>
            reportRowsReferToSameRecord(item, backendItem),
          );
        return {
          ...item,
          photoDocument: item.photoDocument || backendMatch?.photoDocument,
          status: backendMatch?.status || item.status,
        };
      })
      .filter((item) => {
        const key = reportRowKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [backendCorrectiveReports, generatedReports]);

  useEffect(() => {
    if (!selectedGeneratedReport) return;
    const refreshedReport = correctiveGeneratedReports.find((item) =>
      reportRowsReferToSameRecord(item, selectedGeneratedReport),
    );
    if (refreshedReport?.photoDocument && !selectedGeneratedReport.photoDocument) {
      setSelectedGeneratedReport(refreshedReport);
    }
  }, [correctiveGeneratedReports, selectedGeneratedReport]);

  useEffect(() => {
    if (!highlightedReportId) return;

    const scrollTimeout = setTimeout(() => {
      document
        .getElementById(correctiveReportElementId(highlightedReportId))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    const clearHighlightTimeout = setTimeout(() => {
      setHighlightedReportId((current) =>
        current === highlightedReportId ? "" : current,
      );
    }, 6000);

    return () => {
      clearTimeout(scrollTimeout);
      clearTimeout(clearHighlightTimeout);
    };
  }, [correctiveGeneratedReports.length, highlightedReportId]);

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

  function toggleTask(task: string): void {
    setCheckedActions((prev) => ({ ...prev, [task]: !prev[task] }));
  }

  async function uploadPhotoIfPresent(
    machineId: string,
    workOrderId: string,
    reportId?: string,
  ): Promise<ReportPhotoDocument | undefined> {
    if (!photo || !user?._id) return undefined;

    const formData = new FormData();
    formData.append("file", photo);
    formData.append("document_id", uniqueId("DOC"));
    formData.append("machine_id", machineId);
    formData.append("work_order_id", workOrderId);
    if (reportId) {
      formData.append("intervention_report_id", reportId);
    }
    formData.append("type_document", "fault_photo");
    formData.append("description", t("photoUpload"));
    formData.append("uploaded_by", user._id);

    const response = await apiService.uploadDocument(formData);
    return normalizeReportPhotoDocument(response.data as ReportPhotoDocument);
  }

  async function submitCorrectiveMaintenance(): Promise<void> {
    if (!user?._id || !selectedMachine) {
      setSubmitValidationReason("missing-user-machine-or-fault");
      showNotification("error", t("notifications.validationFailed"));
      return;
    }

    if (correctiveValidation.missingFields.includes(CORRECTIVE_REQUIRED_FIELDS.faultOrSymptoms)) {
      setSubmitValidationReason("missing-user-machine-or-fault");
      showNotification("error", t("notifications.validationFailed"));
      return;
    }

    if (reportActionLabels.length === 0) {
      setSubmitValidationReason("no-actions-selected");
      showNotification("error", t("notifications.validationFailed"));
      return;
    }

    const resultValue = result === "custom" ? customResult.trim() : result;
    const faultDescription = [
      selectedFault?.description,
      selectedSymptomLabels.length > 0 ? `${t("symptoms.title")}: ${selectedSymptomLabels.join(" | ")}` : "",
      comments.trim(),
      resultValue ? `${t("actionsPerformed")}: ${resultValue}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 2000);

    setSubmitValidationReason("");
    setSubmitting(true);
    try {
      const reportRes = await apiService.createOperatorCorrectiveReport({
        machine_id: selectedMachine,
        code_panne: selectedFault?.code_panne || "OBSERVED_SYMPTOMS",
        fault_description: faultDescription,
        actions: reportActionLabels,
        priority: "high",
      });

      const workOrderId = reportRes?.data?.workOrder?._id as string | undefined;
      if (!workOrderId) {
        throw new Error("Corrective report creation failed");
      }

      const reportId = reportRes?.data?.report?._id as string | undefined;
      const photoDocument = await uploadPhotoIfPresent(
        selectedMachine,
        workOrderId,
        reportId,
      );
      if (photoDocument) {
        setReportPhotoDocuments((prev) => [photoDocument, ...prev]);
      }
      invalidateList(LIST_EVENTS.workOrders);
      const newReport: GeneratedReportRow = {
        id: `${workOrderId}-${reportId || Date.now()}`,
        type: "corrective",
        workOrderId,
        reportId: reportId || "",
        machine: selectedMachineLabel,
        summary: faultDescription || reportActionLabels.join(" | "),
        createdAt: new Date().toISOString(),
        status: "waiting_validation",
        photoDocument,
      };
      addGeneratedReport(newReport);
      setHighlightedReportId(newReport.id);

      showNotification("success", t("notifications.submitSuccess"));
      resetCorrectiveState();
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

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-700">{t("progress")}</div>
                  <div className="text-xs text-slate-500">
                    {selectedMachine ? selectedMachineLabel : tCommon("table.noData")}
                  </div>
                </div>
                <div className="text-sm font-semibold text-slate-900">{correctiveProgress}%</div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${correctiveProgress}%` }} />
              </div>
            </div>
          </div>

          {selectedMachine ? (
            <div className="col-span-full grid gap-4 xl:grid-cols-2">
              <KnowledgeSuggestions
                machineId={selectedMachine || undefined}
                faultCode={selectedFault?.code_panne}
              />
              <AiAssistantPanel
                machineId={selectedMachine || undefined}
                faultCode={selectedFault?.code_panne}
              />
            </div>
          ) : null}

          {selectedMachine ? (
            <div className="col-span-full panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="card-title">{t("correctiveTasks")}</div>
                  <div className="mt-1 text-sm text-slate-500">{selectedFaultLabel}</div>
                </div>
                {faultsLoading ? <span className="text-sm text-slate-500">{tCommon("loading")}</span> : null}
              </div>

              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                <input
                  value={faultSearch}
                  onChange={(event) => setFaultSearch(event.target.value)}
                  className="min-w-52 shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder={tCommon("actions.search")}
                />
                {visiblePannes.map((panne) => (
                  <button
                    key={panne._id}
                    type="button"
                    onClick={() => {
                      setSelectedPanne(panne._id);
                      resetFaultSpecificState();
                    }}
                    data-testid="corrective-fault-select"
                    className={`shrink-0 rounded-lg border px-4 py-2 text-left text-sm ${
                      selectedPanne === panne._id
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <div className="font-semibold">{panne.code_panne}</div>
                    <div className="max-w-48 truncate text-xs">{panne.description}</div>
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-bold text-slate-900">{selectedFault?.code_panne || t("fault")}</div>
                      <div className="mt-1 text-sm text-slate-500">{selectedFault?.description || t("symptoms.title")}</div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
                      {selectedFault?.gravite || t("corrective")}
                    </span>
                  </div>

                  <div className="mt-4 rounded-xl bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-slate-700">{t("progress")}</span>
                      <span className="font-semibold text-slate-900">{correctiveProgress}%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200">
                      <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${correctiveProgress}%` }} />
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-3 text-sm font-semibold text-slate-700">{t("symptoms.title")}</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {visibleSymptomOptions.map((symptom, index) => (
                        <label
                          key={symptom}
                          className={`flex items-center gap-3 rounded-xl border p-3 text-sm transition-colors ${
                            selectedSymptoms[symptom] ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
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
                    {extraSymptomOptions.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowMoreSymptoms((value) => !value)}
                        className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                      >
                    {showMoreSymptoms ? "Less" : "More"}
                      </button>
                    ) : null}
                  </div>

                  {selectedFault && selectedFaultSolutions.length > 0 ? (
                    <div className="mt-4 rounded-xl bg-emerald-50 p-3">
                      <div className="text-sm font-semibold text-emerald-900">{t("solution")}</div>
                      <div className="mt-2 space-y-2 text-sm text-emerald-950">
                        {selectedFaultSolutions.slice(0, 2).map((solution) => (
                          <div key={solution._id} className="rounded-lg bg-white p-3">
                            {solution.cause_probable ? <div className="font-semibold">Cause: {solution.cause_probable}</div> : null}
                            {solution.solution_recommandee ? <div className="mt-1">{solution.solution_recommandee}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {allTasks.length > 0 ? (
                    <div className="mt-4 max-h-65 space-y-2 overflow-y-auto pr-1">
                      {allTasks.slice(0, 6).map((task, index) => (
                        <label
                          key={task}
                          className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${
                            checkedActions[task] ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"
                          }`}
                        >
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
                  ) : null}
                </div>

                <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">{t("actionsPerformed")}</label>
                    <select
                      value={result}
                      onChange={(event) => setResult(event.target.value as CorrectiveResult)}
                      title={t("actionsPerformed")}
                      aria-label={t("actionsPerformed")}
                      className="mt-2 w-full rounded-lg border px-3 py-2"
                    >
                      <option value="solved">{t("solved")}</option>
                      <option value="notSolved">{t("notSolved")}</option>
                      <option value="technicianRequired">{t("technicianRequired")}</option>
                      <option value="custom">{t("custom")}</option>
                    </select>
                    {result === "custom" ? (
                      <input
                        value={customResult}
                        onChange={(event) => setCustomResult(event.target.value)}
                        className="mt-2 w-full rounded-lg border px-3 py-2"
                        placeholder={t("comments")}
                      />
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700">{t("comments")}</label>
                    <textarea
                      value={comments}
                      onChange={(event) => setComments(event.target.value.slice(0, 500))}
                      data-testid="corrective-comments-input"
                      className="mt-2 min-h-28 w-full resize-none rounded-lg border px-3 py-2 text-sm"
                      placeholder={t("comments")}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700">{t("photoUpload")}</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                      title={t("photoUpload")}
                      aria-label={t("photoUpload")}
                      className="mt-2 w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>

                  <button
                    disabled={!canSubmitCorrective}
                    onClick={() => void submitCorrectiveMaintenance()}
                    data-testid="corrective-submit-button"
                    className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submitting ? tCommon("saving") : t("generateReport")}
                  </button>
                  {!canSubmitCorrective && correctiveSubmitHint ? (
                    <div className="text-xs text-slate-500">
                      Required: {correctiveSubmitHint}
                    </div>
                  ) : null}

                  {submitValidationReason ? (
                    <div data-testid="corrective-submit-validation" className="text-sm text-red-600">
                      {submitValidationMessage}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("myReports")}</div>
            {correctiveGeneratedReports.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {correctiveGeneratedReports.map((item, index) => (
                  <article
                    key={item.id}
                    id={correctiveReportElementId(item.id)}
                    data-testid={`corrective-report-card-${index}`}
                    className={`w-full rounded-xl border p-4 shadow-sm transition-all duration-500 ${
                      highlightedReportId === item.id
                        ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-slate-900">{item.machine || tCommon("notAvailable")}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                          <span>{t("corrective")}</span>
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
                          data-testid={`corrective-report-details-${index}`}
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
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("machine")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {selectedGeneratedReport.machine || tCommon("notAvailable")}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("smartCalendar.maintenanceType")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">{t("corrective")}</div>
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

              {selectedGeneratedReport.photoDocument ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-700">{t("photoUpload")}</div>
                  <DocumentAttachmentViewer
                    document={selectedGeneratedReport.photoDocument}
                    title={selectedGeneratedReport.photoDocument.file_name || t("photoUpload")}
                  />
                </div>
              ) : null}

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
