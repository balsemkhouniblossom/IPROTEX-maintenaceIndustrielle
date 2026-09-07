"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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

const FAULT_CATEGORY_LABELS: Record<string, string> = {
  mechanical: "Mechanical",
  electrical: "Electrical",
  thermal: "Thermal",
  leakage: "Leakage",
  blockage: "Blockage / Start",
  other: "Other",
};

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().toUpperCase()}`;
}

function ReportProblemFlow() {
  const t = useTranslations("dashboard.operator.reportProblemFlow");
  const tCommon = useTranslations("common");
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [step, setStep] = useState<Step>("machine");
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [selectedFault, setSelectedFault] = useState<Panne | null>(null);
  const [otherProblem, setOtherProblem] = useState("");
  const [observation, setObservation] = useState("");
  const [urgency, setUrgency] = useState("");
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
    return Boolean(selectedFault || otherProblem.trim());
  }, [selectedFault, otherProblem]);

  const canSubmitReview = useMemo(() => {
    if (!selectedMachine) return false;
    return canProceedFromProblem;
  }, [selectedMachine, canProceedFromProblem]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [machineItems, workOrderItems] = await Promise.all([
          fetchAllPaginated<Machine>((p) => apiService.getMyMachines(p)),
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
    setSelectedFault(null);
    setOtherProblem("");
    setObservation("");
    setUrgency("");
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
    setSelectedFault(fault);
    if (fault) setOtherProblem("");
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
    if (!selectedFault && !otherProblem.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const codePanne = selectedFault?.code_panne || "OBSERVED_SYMPTOMS";
      const problemLabel = selectedFault?.description || otherProblem.trim();
      const actions = [problemLabel];
      const faultDescription = [observation.trim(), problemLabel].filter(Boolean).join(" | ").slice(0, 2000);

      const reportRes = await apiService.createOperatorCorrectiveReport({
        machine_id: selectedMachine,
        code_panne: codePanne,
        fault_description: faultDescription || undefined,
        actions,
        priority: urgency ? URGENCY_PRIORITY_MAP[urgency] : undefined,
      });

      const workOrder = reportRes.data.workOrder;
      const report = reportRes.data.report;

      invalidateList(LIST_EVENTS.workOrders);

      let attachmentFailed = false;
      if (photo && workOrder._id && report._id) {
        try {
          const formData = new FormData();
          formData.append("file", photo);
          formData.append("document_id", uniqueId("DOC"));
          formData.append("machine_id", selectedMachine);
          formData.append("work_order_id", workOrder._id);
          formData.append("intervention_report_id", report._id);
          formData.append("type_document", "fault_photo");
          formData.append("description", t("photoUpload"));
          formData.append("uploaded_by", user._id);
          await apiService.uploadDocument(formData);
        } catch (photoError) {
          attachmentFailed = true;
          console.error("Photo upload failed after report creation", photoError);
        }
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
    const wo = result.workOrder;
    const machine = selectedMachineData;
    return (
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
                    {selectedFault?.description || otherProblem || tCommon("notAvailable")}
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
    );
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
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          machine.status === "Operational" || machine.status === "operational"
                            ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                            : machine.status === "Maintenance" || machine.status === "maintenance"
                            ? "border border-amber-200 bg-amber-50 text-amber-800"
                            : "border border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        {machine.status || t("operationalStatus")}
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
                        {FAULT_CATEGORY_LABELS[category] || category}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {categoryFaults.map((fault) => (
                          <button
                            key={fault._id}
                            type="button"
                            onClick={() => handleFaultSelect(fault)}
                            className={`rounded-xl border p-4 text-left transition hover:-translate-y-1 hover:shadow-lg ${
                              selectedFault?._id === fault._id
                                ? "border-blue-500 bg-blue-50 shadow-md"
                                : "border-slate-200 bg-white"
                            }`}
                          >
                            <div className="text-sm font-semibold text-slate-900">{fault.description}</div>
                            {fault.gravite && (
                              <div className="mt-1 text-xs text-slate-500">{fault.gravite}</div>
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
                onClick={() => handleFaultSelect(null)}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  !selectedFault ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="text-sm font-semibold text-slate-900">{t("other")}</div>
                <div className="mt-1 text-xs text-slate-500">{t("describePlaceholder")}</div>
              </button>

              {!selectedFault && (
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
                {photo && <div className="mt-2 text-xs text-slate-600">{photo.name}</div>}
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
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">{t("problemLabel")}</div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {selectedFault?.description || otherProblem || tCommon("notAvailable")}
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
                {photo && (
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">{t("photoUpload")}</div>
                    <div className="mt-1 text-sm text-slate-700">{photo.name}</div>
                  </div>
                )}
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
                  className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white"
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
