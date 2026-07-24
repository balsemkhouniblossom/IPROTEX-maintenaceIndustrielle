"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  name: string;
}

interface Machine {
  _id: string;
  machine_id: string;
  model?: string;
  type_id: EntityRef;
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
  solution_recommandee?: string;
}

interface DocumentEntity {
  _id: string;
  machine_id: EntityRef;
  file_path: string;
  file_name?: string;
  type_document?: string;
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

export default function OperatorReportProblemPage() {
  const t = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const locale = Array.isArray(params?.locale)
    ? params.locale[0]
    : params?.locale || "en";

  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [submitValidationReason, setSubmitValidationReason] = useState("");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [machineTypes, setMachineTypes] = useState<MachineType[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [pannes, setPannes] = useState<Panne[]>([]);
  const [solutions, setSolutions] = useState<PanneSolution[]>([]);
  const [documents, setDocuments] = useState<DocumentEntity[]>([]);

  const [selectedType, setSelectedType] = useState("");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [selectedPanne, setSelectedPanne] = useState("");
  const [checkedActions, setCheckedActions] = useState<Record<string, boolean>>({});
  const [customAction, setCustomAction] = useState("");
  const [customActions, setCustomActions] = useState<string[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [showSuccessActions, setShowSuccessActions] = useState(false);
  const [isLoadingFaults, setIsLoadingFaults] = useState(false);

  function showNotification(type: "success" | "error" | "info", message: string): void {
    setNotification({ type, message });
    window.setTimeout(() => setNotification(null), 4000);
  }

  function resetFaultFlowState(): void {
    setSelectedPanne("");
    setCheckedActions({});
    setCustomAction("");
    setCustomActions([]);
    setPhoto(null);
    setSubmitValidationReason("");
    setShowSuccessActions(false);
  }

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [machineTypeItems, machineItems, documentItems] = await Promise.all([
          fetchAllPaginated<MachineType>((pagination) => apiService.getOperatorMachineTypes(pagination)),
          fetchAllPaginated<Machine>((pagination) => apiService.getMyMachines(pagination)),
          fetchAllPaginated<DocumentEntity>((pagination) => apiService.getOperatorManuals(pagination)),
        ]);

        setMachineTypes(machineTypeItems);
        setMachines(machineItems);
        setPannes([]);
        setSolutions([]);
        setDocuments(documentItems);
        showNotification("success", t("notifications.dataLoaded"));
      } catch (error) {
        console.error("Failed to load report-problem data", error);
        showNotification("error", t("notifications.loadFailed"));
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  useEffect(() => {
    async function loadMachineAwareFaults() {
      if (!selectedMachine && !selectedType) {
        setPannes([]);
        setSolutions([]);
        return;
      }

      try {
        setIsLoadingFaults(true);
        const faults = await fetchAllPaginated<Panne>((pagination) =>
          apiService.getOperatorFaults({
            ...pagination,
            machineId: selectedMachine || undefined,
            machineTypeId: selectedType || undefined,
          }),
        );
        setPannes(faults);
      } catch (error) {
        console.error("Failed to load machine-aware faults", error);
        setPannes([]);
      } finally {
        setIsLoadingFaults(false);
      }
    }

    void loadMachineAwareFaults();
  }, [selectedMachine, selectedType]);

  useEffect(() => {
    async function loadFaultSolutions() {
      if (!selectedPanne) {
        setSolutions([]);
        return;
      }

      try {
        const response = await apiService.getOperatorFaultSolutions({
          page: 1,
          limit: 100,
          panneId: selectedPanne,
          machineId: selectedMachine || undefined,
          machineTypeId: selectedType || undefined,
        });
        setSolutions(normalizeApiItems<PanneSolution>(response.data));
      } catch (error) {
        console.error("Failed to load fault solutions", error);
        setSolutions([]);
      }
    }

    void loadFaultSolutions();
  }, [selectedMachine, selectedPanne, selectedType]);

  const machinesForType = useMemo(
    () => machines.filter((machine) => refId(machine.type_id) === selectedType),
    [machines, selectedType],
  );

  const selectedFault = useMemo(
    () => pannes.find((item) => item._id === selectedPanne) ?? null,
    [pannes, selectedPanne],
  );

  const autoActions = useMemo(() => {
    return Array.from(
      new Set(
        solutions
          .filter((solution) => refId(solution.panne_id) === selectedPanne)
          .flatMap((solution) => tokenize(solution.solution_recommandee)),
      ),
    );
  }, [solutions, selectedPanne]);

  const actionList = useMemo(() => [...autoActions, ...customActions], [autoActions, customActions]);

  const manualDocument = useMemo(
    () => {
      const selectedTypeMachineIds = new Set(
        machines
          .filter((machine) => refId(machine.type_id) === selectedType)
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
          if (selectedType) return selectedTypeMachineIds.has(documentMachineId);
          return false;
        }) ?? null
      );
    },
    [documents, machines, selectedMachine, selectedType],
  );

  function toggleAction(action: string): void {
    setCheckedActions((prev) => ({ ...prev, [action]: !prev[action] }));
  }

  function addCustomAction(): void {
    const value = customAction.trim();
    if (!value) {
      showNotification("error", t("notifications.validationFailed"));
      return;
    }
    if (!customActions.includes(value)) {
      setCustomActions((prev) => [...prev, value]);
      showNotification("info", t("notifications.customActionAdded"));
    }
    setCheckedActions((prev) => ({ ...prev, [value]: true }));
    setCustomAction("");
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

  async function submitReport(): Promise<void> {
    if (!user?._id || !selectedMachine || !selectedFault) {
      setSubmitValidationReason("missing-user-machine-or-fault");
      showNotification("error", t("notifications.validationFailed"));
      return;
    }

    const selectedActions = actionList.filter((item) => checkedActions[item]);
    if (selectedActions.length === 0) {
      setSubmitValidationReason("no-actions-selected");
      showNotification("error", t("notifications.validationFailed"));
      return;
    }

    setSubmitValidationReason("");
    setSubmitting(true);
    try {
      const reportRes = await apiService.createOperatorCorrectiveReport({
        machine_id: selectedMachine,
        code_panne: selectedFault.code_panne,
        fault_description: selectedFault.description,
        actions: selectedActions,
        priority: "high",
      });

      const workOrderId = reportRes?.data?.workOrder?._id as string | undefined;
      if (!workOrderId) {
        throw new Error("Corrective report creation failed");
      }

      await uploadPhotoIfPresent(selectedMachine);
      showNotification("success", t("notifications.submitSuccess"));
      setShowSuccessActions(true);
    } catch (error) {
      console.error("Failed to submit report", error);
      setSubmitValidationReason("submit-failed");
      showNotification("error", t("notifications.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("reportProblem")}>
        {notification ? (
          <div
            data-testid="report-problem-notification"
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              notification.type === "success"
                ? "bg-green-100 text-green-800 border border-green-200"
                : notification.type === "error"
                  ? "bg-red-100 text-red-800 border border-red-200"
                  : "bg-blue-100 text-blue-800 border border-blue-200"
            }`}
          >
            {notification.message}
          </div>
        ) : null}
        <div className="bento-grid">
          <div className="col-span-full panel">
            <div className="card-title mb-4">{t("reportProblem")}</div>

            {loading ? (
              <div className="text-sm text-slate-500">{tCommon("loading")}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm mb-2">{t("machineCategory")}</label>
                  <select
                    value={selectedType}
                    onChange={(event) => {
                      setSelectedType(event.target.value);
                      setSelectedMachine("");
                      resetFaultFlowState();
                    }}
                    data-testid="report-problem-category-select"
                    className="w-full border rounded-lg px-3 py-2"
                    title={t("machineCategory")}
                    aria-label={t("machineCategory")}
                  >
                    <option value="">{tCommon("actions.search")}</option>
                    {machineTypes.map((type) => (
                      <option key={type._id} value={type._id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm mb-2">{t("machine")}</label>
                  <select
                    value={selectedMachine}
                    onChange={(event) => {
                      setSelectedMachine(event.target.value);
                      resetFaultFlowState();
                    }}
                    data-testid="report-problem-machine-select"
                    className="w-full border rounded-lg px-3 py-2"
                    title={t("machine")}
                    aria-label={t("machine")}
                  >
                    <option value="">{tCommon("actions.search")}</option>
                    {machinesForType.map((machine) => (
                      <option key={machine._id} value={machine._id}>
                        {machine.machine_id} {machine.model ? `- ${machine.model}` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm mb-2">{t("fault")}</label>
                  <select
                    value={selectedPanne}
                    onChange={(event) => {
                      setSelectedPanne(event.target.value);
                      setCheckedActions({});
                      setCustomActions([]);
                      setSubmitValidationReason("");
                      setShowSuccessActions(false);
                    }}
                    data-testid="report-problem-fault-select"
                    className="w-full border rounded-lg px-3 py-2"
                    title={t("fault")}
                    aria-label={t("fault")}
                    disabled={!selectedMachine && !selectedType}
                  >
                    <option value="">{tCommon("actions.search")}</option>
                    {pannes.map((panne) => (
                      <option key={panne._id} value={panne._id}>
                        {panne.code_panne} - {panne.description}
                      </option>
                    ))}
                  </select>
                  {!selectedMachine ? (
                    <p className="mt-2 text-xs text-amber-700">{t("selectMachineForHistory")}</p>
                  ) : isLoadingFaults ? (
                    <p className="mt-2 text-xs text-slate-500">{tCommon("loading")}</p>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("solution")}</div>
            <div className="text-sm text-slate-600 mb-3">
              {selectedFault
                ? `${selectedFault.code_panne} | ${selectedFault.description} | ${selectedFault.gravite || tCommon("notAvailable")}`
                : tCommon("table.noData")}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {actionList.length === 0 && <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>}
              {actionList.map((action, index) => (
                <label key={action} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(checkedActions[action])}
                    onChange={() => toggleAction(action)}
                    data-testid={`report-problem-action-checkbox-${index}`}
                  />
                  <span>{action}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input
                value={customAction}
                onChange={(event) => setCustomAction(event.target.value)}
                data-testid="report-problem-custom-action-input"
                className="flex-1 border rounded-lg px-3 py-2"
                placeholder={t("actionsPerformed")}
              />
              <button
                onClick={addCustomAction}
                data-testid="report-problem-add-custom-action"
                className="px-4 py-2 rounded-lg bg-slate-900 text-white"
              >
                {tCommon("add")}
              </button>
            </div>
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

          <div className="col-span-full panel">
            <div className="card-title mb-3">{t("photoUpload")}</div>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
              className="w-full border rounded-lg px-3 py-2"
              title={t("photoUpload")}
              aria-label={t("photoUpload")}
              placeholder={t("photoUpload")}
            />
          </div>

          <div className="col-span-full panel">
            {submitValidationReason ? (
              <div data-testid="report-problem-submit-validation" className="text-sm text-red-600 mb-3">
                {submitValidationReason === "missing-user-machine-or-fault"
                  ? t("notifications.validationFailed")
                  : submitValidationReason === "no-actions-selected"
                    ? t("actionsPerformed")
                    : tCommon("error")}
              </div>
            ) : null}
            <button
              disabled={submitting}
              onClick={() => void submitReport()}
              data-testid="report-problem-submit-button"
              className="w-full md:w-auto px-5 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white"
            >
              {submitting ? tCommon("saving") : t("generateReport")}
            </button>

            {showSuccessActions ? (
              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
                <button
                  type="button"
                  onClick={() => router.push(`/${locale}/operator/my-reports`)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  {t("myReports")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetFaultFlowState();
                    setShowSuccessActions(false);
                  }}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800"
                >
                  {t("startWorking")}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/${locale}/operator`)}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800"
                >
                  {t("title")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
