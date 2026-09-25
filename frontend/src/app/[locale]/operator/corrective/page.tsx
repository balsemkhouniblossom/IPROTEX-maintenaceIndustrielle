"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslations } from "next-intl";
import KnowledgeSuggestions from "@/components/knowledge-base/KnowledgeSuggestions";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import { extractApiErrorMessage } from "@/services/apiErrors";
import { invalidateList, LIST_EVENTS } from "@/services/listInvalidation";
import { translateEnumValue } from "@/services/enumTranslations";

type Step = "machine" | "problem" | "description" | "urgency" | "review" | "success";

interface Machine {
  _id: string;
  machine_id: string;
  type_id?: string | { _id?: string };
  model?: string;
  status?: string;
}

interface Panne {
  _id: string;
  code_panne: string;
  description: string;
  gravite?: string;
  component?: string;
}

interface RecommendedPart {
  _id: string;
  part_id: string | { _id: string; part_id?: string; nom_piece?: string };
  recommended_quantity: number;
  priority: string;
  note?: string;
}

interface WorkOrder {
  _id: string;
  type_maintenance?: string;
  status?: string;
  machine_id?: string | { _id?: string; machine_id?: string };
  date_created?: string;
  ot_id?: string;
}

interface SubmissionResult {
  workOrder: WorkOrder;
  report: { _id: string; report_id: string; ot_id: string | WorkOrder };
  duplicate: boolean;
  attachmentFailed: boolean;
}

function refId(value: string | { _id?: string } | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id || "";
}

const CLOSED_WORK_ORDER_STATUSES = new Set([
  "completed",
  "validated",
  "cancelled",
  "canceled",
  "CLOTURE",
  "ANNULE",
]);

const URGENCY_PRIORITY_MAP: Record<string, string> = {
  normal: "medium",
  high: "high",
  machineStopped: "urgent",
};

function getFaultCategory(description: string): string {
  const lower = description.toLowerCase();
  if (/\b(vibration|noise|sound|bearing|belt|shaft|gear|knock|mechanical|grinding|rattle|brush)\b/.test(lower)) return "mechanical";
  if (/\b(electrical|power|circuit|fuse|wiring|electric|short|overload|voltage|spark|burn)\b/.test(lower)) return "electrical";
  if (/\b(overheat|heat|temperature|cooling|thermal|hot|warm|boil|steam)\b/.test(lower)) return "thermal";
  if (/\b(leak|oil|water|fluid|hydraulic|air|gas|spill|drip|seep)\b/.test(lower)) return "leakage";
  if (/\b(blocked|stop|jam|stuck|start|startup|switch|press|seize)\b/.test(lower)) return "blockage";
  return "other";
}

function faultSeverityKey(value: string): "info" | "warning" | "problem" | "critical" {
  const normalized = value.toLowerCase();
  if (normalized.includes("critical") || normalized.includes("urgent")) return "critical";
  if (normalized.includes("warning") || normalized.includes("avertissement")) return "warning";
  if (normalized.includes("trouble") || normalized.includes("problem") || normalized.includes("probl")) return "problem";
  return "info";
}

function machineStatusClass(status: string | undefined): string {
  if (status === "Operational" || status === "operational") return "border border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "Maintenance" || status === "maintenance") return "border border-amber-200 bg-amber-50 text-amber-800";
  return "border border-slate-200 bg-slate-50 text-slate-700";
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().toUpperCase()}`;
}

async function uploadFaultPhoto({
  photo,
  machineId,
  workOrderId,
  reportId,
  userId,
  description,
}: {
  photo: File | null;
  machineId: string;
  workOrderId: string;
  reportId: string;
  userId: string;
  description: string;
}): Promise<boolean> {
  if (!photo || !workOrderId || !reportId) return false;
  const formData = new FormData();
  formData.append("file", photo);
  formData.append("document_id", uniqueId("DOC"));
  formData.append("machine_id", machineId);
  formData.append("work_order_id", workOrderId);
  formData.append("intervention_report_id", reportId);
  formData.append("type_document", "fault_photo");
  formData.append("description", description);
  formData.append("uploaded_by", userId);
  await apiService.uploadDocument(formData);
  return true;
}

type SuccessScreenProps = Readonly<{
  result: SubmissionResult;
  machine: Machine | null;
  selectedFaults: Panne[];
  otherProblem: string;
  urgency: string;
  observation: string;
  photo: File | null;
  retryingPhoto: boolean;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
  onRetryPhoto: () => Promise<void>;
  onViewStatus: () => void;
  onBack: () => void;
}>;

function SuccessScreen({ result, machine, selectedFaults, otherProblem, urgency, observation, photo, retryingPhoto, t, tCommon, onRetryPhoto, onViewStatus, onBack }: SuccessScreenProps) {
  const { workOrder, attachmentFailed, duplicate } = result;
  const problem = [
    ...selectedFaults.map((fault) => fault.description),
    otherProblem.trim(),
  ].filter(Boolean).join("; ") || tCommon("notAvailable");
  const statusTitle = attachmentFailed ? t("partialSuccessTitle") : t("successTitle");
  const statusMessage = attachmentFailed ? t("partialSuccessMessage") : t("successMessage");
  return <ProtectedRoute requiredRole="operator"><DashboardLayout title={statusTitle}><div className="mx-auto max-w-xl space-y-6">
    <div className={`rounded-2xl border p-6 text-center ${attachmentFailed ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><div className="text-3xl font-bold">✓</div><h2 className="mt-2 text-xl font-semibold">{statusTitle}</h2><p className="mt-1 text-sm">{statusMessage}</p></div>
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"><div className="grid grid-cols-2 gap-4"><SummaryField label={t("machineLabel")} value={machine?.machine_id || tCommon("notAvailable")} detail={machine?.model} /><SummaryField label={t("reference")} value={workOrder.ot_id || workOrder._id} /><SummaryField label={t("problemLabel")} value={problem} /><SummaryField label={t("urgencyLabel")} value={urgency ? t(urgency) : t("normal")} /></div>{observation ? <SummaryField label={t("descriptionLabel")} value={observation} /> : null}{photo ? <PhotoPreview photo={photo} label={t("photoUpload")} /> : null}
      {attachmentFailed ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="font-semibold">{t("partialSuccessTitle")}</div><button type="button" onClick={onRetryPhoto} disabled={retryingPhoto} className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">{retryingPhoto ? t("retryingPhoto") : t("retryPhoto")}</button></div> : <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{duplicate ? t("existingReportReused") : t("reportedStatus")}</span>}
    </div><div className="flex gap-3"><button type="button" onClick={onViewStatus} className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">{t("viewStatus")}</button><button type="button" onClick={onBack} className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700">{t("backToMachines")}</button></div>
  </div></DashboardLayout></ProtectedRoute>;
}

function SummaryField({ label, value, detail }: Readonly<{ label: string; value: string; detail?: string }>) {
  return <div><div className="text-xs font-semibold uppercase text-slate-500">{label}</div><div className="mt-1 text-base font-semibold text-slate-900">{value}</div>{detail ? <div className="text-sm text-slate-500">{detail}</div> : null}</div>;
}

function PhotoPreview({ photo, label }: Readonly<{ photo: File; label: string }>) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(photo);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo]);

  return (
    <div>
      <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
      {previewUrl ? (
        <Image
          src={previewUrl}
          alt={`${label}: ${photo.name}`}
          width={1200}
          height={800}
          unoptimized
          className="mt-2 max-h-72 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain"
        />
      ) : null}
      <div className="mt-2 break-all text-xs text-slate-600">{photo.name}</div>
    </div>
  );
}

function ReportProblemFlow() {
  const t = useTranslations("dashboard.operator.reportProblemFlow");
  const tCommon = useTranslations("common");
  const tEnums = useTranslations("common.enums");
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [step, setStep] = useState<Step>("machine");
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [selectedFaults, setSelectedFaults] = useState<Panne[]>([]);
  const [isOtherSelected, setIsOtherSelected] = useState(false);
  const [otherProblem, setOtherProblem] = useState("");
  const [observation, setObservation] = useState("");
  const [urgency, setUrgency] = useState("");
  const [interventionStartedAt, setInterventionStartedAt] = useState("");
  const [interventionEndedAt, setInterventionEndedAt] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  const [machines, setMachines] = useState<Machine[]>([]);
  const [faults, setFaults] = useState<Panne[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [machineSearch, setMachineSearch] = useState("");
  const [faultSearch, setFaultSearch] = useState("");
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingPhoto, setRetryingPhoto] = useState(false);
  const [recommendedParts, setRecommendedParts] = useState<RecommendedPart[]>([]);

  const initialMachineId = searchParams.get("machine") || "";

  const selectedMachineData = useMemo(
    () => machines.find((m) => m._id === selectedMachine) || null,
    [machines, selectedMachine],
  );

  const activeIssue = useMemo(() => {
    if (!selectedMachine || workOrders.length === 0) return null;
    return (
      workOrders.find((wo) => {
        const machineId = refId(wo.machine_id);
        if (machineId !== selectedMachine) return false;
        if (wo.type_maintenance !== "corrective") return false;
        if (CLOSED_WORK_ORDER_STATUSES.has(wo.status || "")) return false;
        return true;
      }) || null
    );
  }, [selectedMachine, workOrders]);

  const filteredMachines = useMemo(() => {
    if (!machineSearch.trim()) return machines;
    const q = machineSearch.trim().toLowerCase();
    return machines.filter(
      (m) =>
        m.machine_id.toLowerCase().includes(q) ||
        m.model?.toLowerCase().includes(q) ||
        m.status?.toLowerCase().includes(q),
    );
  }, [machines, machineSearch]);

  const filteredFaults = useMemo(() => {
    if (!faultSearch.trim()) return faults;
    const q = faultSearch.trim().toLowerCase();
    return faults.filter(
      (f) =>
        f.description.toLowerCase().includes(q) ||
        f.code_panne.toLowerCase().includes(q),
    );
  }, [faults, faultSearch]);

  const faultGroups = useMemo(() => {
    const groups: Record<string, Panne[]> = {};
    filteredFaults.forEach((f) => {
      const cat = getFaultCategory(f.description);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(f);
    });
    return groups;
  }, [filteredFaults]);

  const canProceedFromProblem = useMemo(() => {
    return Boolean(
      selectedFaults.length > 0 ||
        (isOtherSelected && otherProblem.trim()),
    );
  }, [selectedFaults, isOtherSelected, otherProblem]);

  const selectedFault = selectedFaults[0] || null;
  const selectedProblemSummary = useMemo(
    () =>
      [
        ...selectedFaults.map((fault) => fault.description),
        isOtherSelected ? otherProblem.trim() : "",
      ]
        .filter(Boolean)
        .join("; "),
    [selectedFaults, isOtherSelected, otherProblem],
  );

  useEffect(() => {
    let cancelled = false;
    if (!selectedFault) {
      setRecommendedParts([]);
      return;
    }
    apiService.getOperatorFaultParts(selectedFault._id)
      .then((response) => {
        if (!cancelled) setRecommendedParts(response.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setRecommendedParts([]);
      });
    return () => { cancelled = true; };
  }, [selectedFault]);

  const canSubmitReview = useMemo(() => {
    if (!selectedMachine) return false;
    if (urgency === "machineStopped") {
      if (!interventionStartedAt || !interventionEndedAt) return false;
      if (new Date(interventionEndedAt) <= new Date(interventionStartedAt)) return false;
    }
    return canProceedFromProblem;
  }, [selectedMachine, canProceedFromProblem, urgency, interventionStartedAt, interventionEndedAt]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [machineItems, workOrderItems] = await Promise.all([
          fetchAllPaginated<Machine>((p) =>
            apiService.getOperatorReportableMachines(p),
          ),
          fetchAllPaginated<WorkOrder>((p) => apiService.getMyWorkOrders(p)),
        ]);
        setMachines(machineItems);
        setWorkOrders(workOrderItems);
      } catch (e) {
        console.error("Failed to load data", e);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!initialMachineId) return;
    const preselected = machines.find((m) => m._id === initialMachineId);
    if (preselected) {
      setSelectedMachine(preselected._id);
      setStep("problem");
    }
  }, [loading, initialMachineId, machines]);

  useEffect(() => {
    setFaults([]);
    if (!selectedMachine) {
      return;
    }
    let cancelled = false;
    async function loadFaults() {
      try {
        const faultItems = await fetchAllPaginated<Panne>((pagination) =>
          apiService.getOperatorFaults({
            ...pagination,
            machineId: selectedMachine,
          }),
        );
        if (!cancelled) {
          setFaults(faultItems);
        }
      } catch (e) {
        console.error("Failed to load faults", e);
        if (!cancelled) setFaults([]);
      }
    }
    void loadFaults();
    return () => {
      cancelled = true;
    };
  }, [selectedMachine]);

  function resetMachineSpecificDraft() {
    setSelectedFaults([]);
    setIsOtherSelected(false);
    setOtherProblem("");
    setObservation("");
    setUrgency("");
    setInterventionStartedAt("");
    setInterventionEndedAt("");
    setPhoto(null);
    setFaultSearch("");
    setFaults([]);
  }

  function handleMachineSelect(machineId: string) {
    resetMachineSpecificDraft();
    setSelectedMachine(machineId);
    setStep("problem");
  }

  function handleFaultSelect(fault: Panne | null) {
    if (!fault) {
      setIsOtherSelected((current) => !current);
      return;
    }
    setSelectedFaults((current) =>
      current.some((selected) => selected._id === fault._id)
        ? current.filter((selected) => selected._id !== fault._id)
        : [...current, fault],
    );
  }

  function handleBack() {
    switch (step) {
      case "problem":
        setStep("machine");
        break;
      case "description":
        setStep("problem");
        break;
      case "urgency":
        setStep("description");
        break;
      case "review":
        setStep("urgency");
        break;
    }
  }

  async function handleSubmit() {
    if (!selectedMachine || !user?._id) return;
    if (!selectedFaults.length && (!isOtherSelected || !otherProblem.trim())) return;

    setSubmitting(true);
    setError(null);
    try {
      const catalogueOtherFault = faults.find(
        (fault) => fault.component?.trim().toLowerCase() === "autre",
      );
      const codePanne = selectedFault?.code_panne || catalogueOtherFault?.code_panne;
      if (!codePanne) {
        throw new Error("No 'Autre panne technique' reference is configured for this machine type.");
      }
      const problemLabels = [
        ...selectedFaults.map((fault) => fault.description),
        isOtherSelected ? otherProblem.trim() : "",
      ].filter(Boolean);
      const actions = problemLabels;
      const faultDescription = [observation.trim(), problemLabels.join("; ")]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 2000);

      const reportRes = await apiService.createOperatorCorrectiveReport({
        machine_id: selectedMachine,
        code_panne: codePanne,
        fault_description: faultDescription || undefined,
        actions,
        priority: urgency ? URGENCY_PRIORITY_MAP[urgency] : undefined,
        machine_stopped: urgency === "machineStopped",
        intervention_started_at:
          urgency === "machineStopped" ? new Date(interventionStartedAt).toISOString() : undefined,
        intervention_ended_at:
          urgency === "machineStopped" ? new Date(interventionEndedAt).toISOString() : undefined,
      });

      const workOrder = reportRes.data.workOrder;
      const report = reportRes.data.report;

      invalidateList(LIST_EVENTS.workOrders);

      let attachmentFailed = false;
      try {
        await uploadFaultPhoto({
          photo,
          machineId: selectedMachine,
          workOrderId: workOrder._id,
          reportId: report._id,
          userId: user._id,
          description: t("photoUpload"),
        });
      } catch (photoError) {
        attachmentFailed = true;
        console.error("Photo upload failed after report creation", photoError);
      }

      setResult({ workOrder, report, duplicate: reportRes.data.duplicate, attachmentFailed });
      setStep("success");
    } catch (e) {
      setError(extractApiErrorMessage(e, tCommon("error")));
    } finally {
      setSubmitting(false);
    }
  }

  async function retryPhotoUpload() {
    if (!result || !photo || !selectedMachine || !user?._id) return;
    setRetryingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("file", photo);
      formData.append("document_id", uniqueId("DOC"));
      formData.append("machine_id", selectedMachine);
      formData.append("work_order_id", result.workOrder._id);
      formData.append("intervention_report_id", result.report._id);
      formData.append("type_document", "fault_photo");
      formData.append("description", t("photoUpload"));
      formData.append("uploaded_by", user._id);
      await apiService.uploadDocument(formData);
      setResult((current) => current ? { ...current, attachmentFailed: false } : current);
    } catch (photoError) {
      console.error("Photo retry failed after report creation", photoError);
    } finally {
      setRetryingPhoto(false);
    }
  }

  function resetAndGoBack() {
    setSelectedMachine(null);
    resetMachineSpecificDraft();
    setResult(null);
    setError(null);
    setStep("machine");
  }

  const stepIndex = ["machine", "problem", "description", "urgency", "review"].indexOf(step);

  if (loading) {
    return (
      <ProtectedRoute requiredRole="operator">
        <DashboardLayout title={t("title")}>
          <div className="operator-dashboard-theme panel">{tCommon("loading")}</div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  if (step === "success" && result) {
    return <SuccessScreen result={result} machine={selectedMachineData} selectedFaults={selectedFaults} otherProblem={isOtherSelected ? otherProblem : ""} urgency={urgency} observation={observation} photo={photo} retryingPhoto={retryingPhoto} t={t} tCommon={tCommon} onRetryPhoto={retryPhotoUpload} onViewStatus={() => {
      const reportId = result.report._id || result.report.report_id;
      router.push(`../my-reports?reportId=${encodeURIComponent(reportId)}&workOrderId=${encodeURIComponent(result.workOrder._id)}`);
    }} onBack={resetAndGoBack} />;
    /*
      The success panel is rendered by SuccessScreen. Keeping it separate prevents
      the workflow controller from owning both transition logic and presentation.
    */
    /*
      <ProtectedRoute requiredRole="operator">
        <DashboardLayout title={t("successTitle")}>
          <div className="mx-auto max-w-xl space-y-6">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
              <div className={`text-3xl font-bold ${result.attachmentFailed ? "text-amber-700" : "text-emerald-700"}`}>✓</div>
              <h2 className={`mt-2 text-xl font-semibold ${result.attachmentFailed ? "text-amber-900" : "text-emerald-900"}`}>
                {result.attachmentFailed ? t("partialSuccessTitle") : t("successTitle")}
              </h2>
              <p className={`mt-1 text-sm ${result.attachmentFailed ? "text-amber-800" : "text-emerald-800"}`}>
                {result.attachmentFailed ? t("partialSuccessMessage") : t("successMessage")}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("machineLabel")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {machine?.machine_id || tCommon("notAvailable")}
                  </div>
                  {machine?.model && <div className="text-sm text-slate-500">{machine.model}</div>}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("reference")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">{wo.ot_id || wo._id}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("problemLabel")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {selectedProblemSummary || tCommon("notAvailable")}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("urgencyLabel")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">
                    {urgency ? t(urgency) : t("normal")}
                  </div>
                </div>
              </div>
              {observation && (
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("descriptionLabel")}</div>
                  <div className="mt-1 text-sm text-slate-700">{observation}</div>
                </div>
              )}
              <div>
                {result.duplicate && (
                  <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                    {t("existingReportReused")}
                  </div>
                )}
                {result.attachmentFailed ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="font-semibold">{t("partialSuccessTitle")}</div>
                    <div className="mt-1">{t("partialSuccessMessage")}</div>
                    <button
                      type="button"
                      onClick={retryPhotoUpload}
                      disabled={retryingPhoto}
                      className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
                    >
                      {retryingPhoto ? t("retryingPhoto") : t("retryPhoto")}
                    </button>
                  </div>
                ) : (
                  <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                    {result.duplicate ? t("existingReportReused") : t("reportedStatus")}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  const reportId = result.report._id || result.report.report_id;
                  router.push(`../my-reports?reportId=${encodeURIComponent(reportId)}&workOrderId=${encodeURIComponent(wo._id)}`);
                }}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                {t("viewStatus")}
              </button>
              <button
                type="button"
                onClick={resetAndGoBack}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t("backToMachines")}
              </button>
            </div>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );*/
  }

  const steps = [
    { key: "machine", label: t("step1Title") },
    { key: "problem", label: t("step2Title") },
    { key: "description", label: t("step3Title") },
    { key: "urgency", label: t("step4Title") },
    { key: "review", label: t("reviewTitle") },
  ];

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("title")}>
        <div className="mx-auto max-w-3xl">
          {selectedMachineData && step !== "machine" && (
            <div className="mb-6 flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <div>
                <div className="text-xs font-semibold uppercase text-blue-500">{t("reportingFor")}</div>
                <div className="text-base font-semibold text-blue-900">
                  {selectedMachineData.machine_id}
                  {selectedMachineData.model && (
                    <span className="ml-2 text-sm text-blue-700">{selectedMachineData.model}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetMachineSpecificDraft();
                  setSelectedMachine(null);
                  setStep("machine");
                }}
                className="text-sm font-semibold text-blue-700 hover:text-blue-900"
              >
                {t("changeMachine")}
              </button>
            </div>
          )}

          {activeIssue && step !== "success" && (
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">{t("activeIssueWarning")}</div>
              <div className="mt-1 text-sm text-amber-800">
                {t("reference")}: {activeIssue.ot_id || activeIssue._id} | {activeIssue.status}
              </div>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    router.push(`../my-reports?workOrderId=${encodeURIComponent(activeIssue._id)}`);
                  }}
                  className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-200"
                >
                  {t("viewExistingIssue")}
                </button>
                <button
                  type="button"
                  onClick={() => setStep("problem")}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
                >
                  {t("reportAnother")}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          )}

          <div className="mb-8">
            <div className="flex items-center">
              {steps.map((s, i) => (
                <div key={s.key} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                        i <= stepIndex ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {i + 1}
                    </div>
                    <div
                      className={`mt-1 text-xs ${
                        i <= stepIndex ? "text-slate-900" : "text-slate-500"
                      }`}
                    >
                      {s.label}
                    </div>
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className={`mx-2 h-0.5 flex-1 ${
                        i < stepIndex ? "bg-slate-900" : "bg-slate-200"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {step === "machine" && (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">{t("searchMachine")}</label>
                <input
                  type="text"
                  value={machineSearch}
                  onChange={(e) => setMachineSearch(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredMachines.map((machine) => (
                  <button
                    key={machine._id}
                    type="button"
                    onClick={() => handleMachineSelect(machine._id)}
                    className={`rounded-2xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                      selectedMachine === machine._id
                        ? "border-blue-500 bg-blue-50 shadow-md"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="text-base font-semibold text-slate-900">{machine.machine_id}</div>
                    <div className="mt-1 text-sm text-slate-500">{machine.model || tCommon("notAvailable")}</div>
                    <div className="mt-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${machineStatusClass(machine.status)}`}
                      >
                        {translateEnumValue(
                          tEnums,
                          "machineStates",
                          machine.status,
                        ) || t("operationalStatus")}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {filteredMachines.length === 0 && (
                <div className="text-center text-sm text-slate-500">{t("noMachines")}</div>
              )}
            </div>
          )}

          {step === "problem" && (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">{t("selectProblemCategory")}</label>
                <p className="mb-2 text-xs text-slate-500">
                  {t("selectMultipleProblems")}
                </p>
                <input
                  type="text"
                  value={faultSearch}
                  onChange={(e) => setFaultSearch(e.target.value)}
                  placeholder={tCommon("actions.search")}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm"
                />
              </div>

              {filteredFaults.length > 0 ? (
                <div className="space-y-6">
                  {Object.entries(faultGroups).map(([category, categoryFaults]) => (
                    <div key={category}>
                      <div className="mb-3 text-sm font-semibold text-slate-700">
                        {t(`faultCategories.${category}`)}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {categoryFaults.map((fault) => (
                          <button
                            key={fault._id}
                            type="button"
                            aria-pressed={selectedFaults.some(
                              (selected) => selected._id === fault._id,
                            )}
                            onClick={() => handleFaultSelect(fault)}
                            className={`rounded-xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                              selectedFaults.some((selected) => selected._id === fault._id)
                                ? "border-blue-500 bg-blue-50 shadow-md"
                                : "border-slate-200 bg-white"
                            }`}
                          >
                            <div className="text-sm font-semibold text-slate-900">{fault.description}</div>
                            {fault.gravite && (
                              <div className="mt-1 text-xs text-slate-500">
                                {t(`faultSeverities.${faultSeverityKey(fault.gravite)}`)}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
                  <div className="text-sm text-slate-600">{t("noFaults")}</div>
                </div>
              )}

              <button
                type="button"
                aria-pressed={isOtherSelected}
                onClick={() => handleFaultSelect(null)}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  isOtherSelected ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="text-sm font-semibold text-slate-900">{t("other")}</div>
                <div className="mt-1 text-xs text-slate-500">{t("describePlaceholder")}</div>
              </button>

              {isOtherSelected && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <label htmlFor="other-problem" className="mb-2 block text-sm font-semibold text-slate-800">
                    {t("other")}
                  </label>
                  <textarea
                    id="other-problem"
                    value={otherProblem}
                    onChange={(e) => setOtherProblem(e.target.value.slice(0, 500))}
                    placeholder={t("describePlaceholder")}
                    required
                    rows={3}
                    className="w-full resize-none rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm"
                    aria-describedby="other-problem-help"
                  />
                  <div id="other-problem-help" className="mt-1 text-xs text-amber-800">
                    {otherProblem.trim().length}/500
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "description" && (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">{t("descriptionLabel")}</label>
                <textarea
                  value={observation}
                  onChange={(e) => setObservation(e.target.value.slice(0, 500))}
                  placeholder={t("describePlaceholder")}
                  rows={4}
                  className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm"
                />
                <div className="mt-1 text-xs text-slate-500">{observation.length}/500</div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">{t("photoUpload")}</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm"
                />
                {photo && <div className="mt-3"><PhotoPreview photo={photo} label={t("photoUpload")} /></div>}
              </div>
              <KnowledgeSuggestions machineId={selectedMachine || undefined} faultCode={selectedFault?.code_panne} />
            </div>
          )}

          {step === "urgency" && (
            <div className="space-y-4">
              <label className="mb-2 block text-sm font-semibold text-slate-700">{t("selectUrgency")}</label>
              {(["normal", "high", "machineStopped"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setUrgency(option)}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    urgency === option ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">{t(option)}</div>
                </button>
              ))}
              {urgency === "machineStopped" && (
                <div className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">
                    {t("interventionStartTime")}
                    <input type="datetime-local" value={interventionStartedAt}
                      onChange={(event) => setInterventionStartedAt(event.target.value)}
                      className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    {t("interventionEndTime")}
                    <input type="datetime-local" value={interventionEndedAt}
                      min={interventionStartedAt || undefined}
                      onChange={(event) => setInterventionEndedAt(event.target.value)}
                      className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
                  </label>
                  <p className="text-xs text-amber-900 sm:col-span-2">{t("machineStoppedTimeHelp")}</p>
                </div>
              )}
            </div>
          )}

          {step === "review" && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">{t("machineLabel")}</div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {selectedMachineData?.machine_id || tCommon("notAvailable")}
                    </div>
                    {selectedMachineData?.model && (
                      <div className="text-sm text-slate-500">{selectedMachineData.model}</div>
                    )}
                  </div>
                  {urgency === "machineStopped" && (
                    <div className="col-span-2 rounded-xl bg-amber-50 p-3 text-sm">
                      <strong>{t("machineStoppedInterval")}</strong>
                      <div>{t("interventionStartTime")}: {new Date(interventionStartedAt).toLocaleString()}</div>
                      <div>{t("interventionEndTime")}: {new Date(interventionEndedAt).toLocaleString()}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">{t("problemLabel")}</div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {selectedProblemSummary || tCommon("notAvailable")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">{t("descriptionLabel")}</div>
                    <div className="mt-1 text-sm text-slate-700">
                      {observation || tCommon("notAvailable")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">{t("urgencyLabel")}</div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {urgency ? t(urgency) : t("normal")}
                    </div>
                  </div>
                </div>
                {photo && <PhotoPreview photo={photo} label={t("photoUpload")} />}
                {recommendedParts.length > 0 ? (
                  <section className="border-t border-slate-200 pt-4">
                    <h3 className="text-sm font-semibold text-slate-900">Recommended machine parts</h3>
                    <ul className="mt-2 space-y-2">
                      {recommendedParts.map((link) => {
                        const part = typeof link.part_id === "string" ? null : link.part_id;
                        return <li key={link._id} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                          <span className="font-semibold">{part?.part_id ?? (typeof link.part_id === "string" ? link.part_id : "")}</span>
                          {part?.nom_piece ? ` · ${part.nom_piece}` : ""} · Qty {link.recommended_quantity} · {link.priority}
                          {link.note ? <div className="mt-1 text-xs text-slate-500">{link.note}</div> : null}
                        </li>;
                      })}
                    </ul>
                  </section>
                ) : null}
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <div>
              {step !== "machine" && step !== "success" && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {t("back")}
                </button>
              )}
            </div>
            <div className="flex gap-3">
              {step !== "machine" && step !== "success" && (
                <button
                  type="button"
                  onClick={resetAndGoBack}
                  className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {t("cancel")}
                </button>
              )}
              {step === "problem" && selectedMachine && (
                <button
                  type="button"
                  onClick={() => setStep("description")}
                  disabled={!canProceedFromProblem}
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {tCommon("next")}
                </button>
              )}
              {step === "description" && (
                <button
                  type="button"
                  onClick={() => setStep("urgency")}
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
                >
                  {tCommon("next")}
                </button>
              )}
              {step === "urgency" && (
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  disabled={urgency === "machineStopped" && (!interventionStartedAt || !interventionEndedAt || new Date(interventionEndedAt) <= new Date(interventionStartedAt))}
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {tCommon("next")}
                </button>
              )}
              {step === "review" && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmitReview || submitting}
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? t("submitting") : t("submitReport")}
                </button>
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export default function OperatorCorrectivePage() {
  return (
    <Suspense fallback={<div className="operator-dashboard-theme min-h-screen bg-white" />}>
      <ReportProblemFlow />
    </Suspense>
  );
}
