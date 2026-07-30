"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DocumentTextIcon,
  EyeIcon,
} from "@heroicons/react/24/outline";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/contexts/AuthContext";
import { apiService } from "@/services/api";
import { isCorrectiveMaintenanceType } from "@/services/maintenanceType";
import { useTranslations } from "next-intl";
import { fetchAllPaginated, normalizeApiItems, readPaginationMeta } from "@/services/pagination";

type EntityRef = string | { _id?: string };

interface WorkOrder {
  _id: string;
  ot_id: string;
  type_maintenance?: string;
  status: string;
  machine_id?: { machine_id?: string } | string;
  date_created?: string;
}

interface InterventionReport {
  _id: string;
  report_id: string;
  ot_id: EntityRef;
  technician_id: EntityRef;
  description_action?: string;
  etat_final?: string;
  validation_responsable?: string;
  date_debut?: string;
  date_fin?: string;
}

interface DraftReport {
  _id: string;
  report_id: string;
  ot_id: string;
  description_action: string;
  etat_final: string;
  validation_responsable: string;
  date_debut: string;
  date_fin: string;
  updatedAt: string;
}

interface ReportFormData {
  report_id: string;
  ot_id: string;
  description_action: string;
  etat_final: string;
  validation_responsable: string;
  date_debut: string;
  date_fin: string;
}

function refId(value: EntityRef | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id ?? "";
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function toInputDateTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 16);
}

function fromInputDateTime(value: string): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

export default function OperatorMyReportsPage() {
  const t = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
  const { user } = useAuth();

  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<InterventionReport[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [drafts, setDrafts] = useState<DraftReport[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"report" | "draft" | "create">("create");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(12);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [formData, setFormData] = useState<ReportFormData>({
    report_id: "",
    ot_id: "",
    description_action: "",
    etat_final: "",
    validation_responsable: "waiting_validation",
    date_debut: "",
    date_fin: "",
  });

  const draftStorageKey = useMemo(() => {
    const suffix = user?._id || "anonymous";
    return `operator-report-drafts:${suffix}`;
  }, [user?._id]);

  const selectedReport = useMemo(
    () => reports.find((item) => item._id === selectedReportId) || null,
    [reports, selectedReportId],
  );

  const selectedDraft = useMemo(
    () => drafts.find((item) => item._id === selectedDraftId) || null,
    [drafts, selectedDraftId],
  );

  function showNotification(type: "success" | "error" | "info", message: string): void {
    setNotification({ type, message });
    window.setTimeout(() => setNotification(null), 4000);
  }

  const loadDraftsFromStorage = useCallback((): void => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) {
        setDrafts([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setDrafts([]);
        return;
      }
      setDrafts(parsed as DraftReport[]);
    } catch (error) {
      console.error("Failed to parse draft reports", error);
      setDrafts([]);
    }
  }, [draftStorageKey]);

  function persistDrafts(nextDrafts: DraftReport[]): void {
    setDrafts(nextDrafts);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(draftStorageKey, JSON.stringify(nextDrafts));
  }

  function handleStatusFilterChange(value: string): void {
    setStatusFilter(value);
    showNotification("info", t("notifications.filterUpdated"));
  }

  function resetForm(defaultWorkOrderId = ""): void {
    const now = toInputDateTime(new Date().toISOString());
    setFormData({
      report_id: uniqueId("REP-DR"),
      ot_id: defaultWorkOrderId,
      description_action: "",
      etat_final: "",
      validation_responsable: "waiting_validation",
      date_debut: now,
      date_fin: now,
    });
  }

  function mapReportToForm(report: InterventionReport): ReportFormData {
    return {
      report_id: report.report_id || "",
      ot_id: refId(report.ot_id),
      description_action: report.description_action || "",
      etat_final: report.etat_final || "",
      validation_responsable: report.validation_responsable || "waiting_validation",
      date_debut: toInputDateTime(report.date_debut),
      date_fin: toInputDateTime(report.date_fin),
    };
  }

  function mapDraftToForm(draft: DraftReport): ReportFormData {
    return {
      report_id: draft.report_id,
      ot_id: draft.ot_id,
      description_action: draft.description_action,
      etat_final: draft.etat_final,
      validation_responsable: draft.validation_responsable,
      date_debut: toInputDateTime(draft.date_debut),
      date_fin: toInputDateTime(draft.date_fin),
    };
  }

  function openCreateDraftEditor(): void {
    setEditorMode("create");
    setSelectedReportId("");
    setSelectedDraftId("");
    resetForm();
    setEditorOpen(true);
  }

  function openReportEditor(report: InterventionReport): void {
    setEditorMode("report");
    setSelectedReportId(report._id);
    setSelectedDraftId("");
    setFormData(mapReportToForm(report));
    setEditorOpen(true);
  }

  function openDraftEditor(draft: DraftReport): void {
    setEditorMode("draft");
    setSelectedDraftId(draft._id);
    setSelectedReportId("");
    setFormData(mapDraftToForm(draft));
    setEditorOpen(true);
  }

  async function refreshReports(): Promise<void> {
    const [reportsRes, workOrderItems] = await Promise.all([
      apiService.getMyInterventionReports({ page, limit }),
      fetchAllPaginated<WorkOrder>((pagination) => apiService.getMyWorkOrders(pagination)),
    ]);

    setReports(normalizeApiItems<InterventionReport>(reportsRes.data));
    setWorkOrders(workOrderItems);
    const pagination = readPaginationMeta(reportsRes.data);
    setTotalPages(pagination?.totalPages || 1);
    setTotalItems(Number((reportsRes.data as { totalItems?: unknown })?.totalItems) || 0);
  }

  function validateForm(): boolean {
    if (!formData.report_id.trim()) {
      showNotification("error", t("report"));
      return false;
    }
    if (!formData.ot_id) {
      showNotification("error", t("workOrder"));
      return false;
    }
    if (!formData.description_action.trim()) {
      showNotification("error", t("actionsPerformed"));
      return false;
    }
    return true;
  }

  async function handleSaveReport(): Promise<void> {
    if (!selectedReport || !user?._id || !validateForm()) return;

    setSubmitting(true);
    try {
      await apiService.updateInterventionReport(selectedReport._id, {
        report_id: formData.report_id.trim(),
        ot_id: formData.ot_id,
        technician_id: user._id,
        description_action: formData.description_action.trim(),
        etat_final: formData.etat_final.trim() || undefined,
        validation_responsable: formData.validation_responsable || "waiting_validation",
        date_debut: fromInputDateTime(formData.date_debut),
        date_fin: fromInputDateTime(formData.date_fin),
      });

      await refreshReports();
      setEditorOpen(false);
      showNotification("success", t("notifications.submitSuccess"));
    } catch (error) {
      console.error("Failed to update report", error);
      showNotification("error", t("notifications.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteReport(reportId: string): Promise<void> {
    if (!window.confirm(tCommon("confirm"))) {
      return;
    }

    try {
      await apiService.deleteInterventionReport(reportId);
      await refreshReports();
      setEditorOpen(false);
      showNotification("success", tCommon("success"));
    } catch (error) {
      console.error("Failed to delete report", error);
      showNotification("error", t("notifications.loadFailed"));
    }
  }

  function handleSaveDraft(): void {
    if (!validateForm()) return;

    const nowIso = new Date().toISOString();

    const nextDraft: DraftReport = {
      _id: selectedDraft?._id || uniqueId("DRAFT"),
      report_id: formData.report_id.trim(),
      ot_id: formData.ot_id,
      description_action: formData.description_action.trim(),
      etat_final: formData.etat_final.trim(),
      validation_responsable: formData.validation_responsable || "waiting_validation",
      date_debut: fromInputDateTime(formData.date_debut),
      date_fin: fromInputDateTime(formData.date_fin),
      updatedAt: nowIso,
    };

    const nextDrafts = selectedDraft
      ? drafts.map((draft) => (draft._id === selectedDraft._id ? nextDraft : draft))
      : [nextDraft, ...drafts];

    persistDrafts(nextDrafts);
    setEditorMode("draft");
    setSelectedDraftId(nextDraft._id);
    showNotification("success", tCommon("success"));
  }

  function handleDeleteDraft(draftId: string): void {
    const nextDrafts = drafts.filter((draft) => draft._id !== draftId);
    persistDrafts(nextDrafts);
    if (selectedDraftId === draftId) {
      setEditorOpen(false);
    }
    showNotification("success", tCommon("success"));
  }

  async function handleSubmitDraft(): Promise<void> {
    if (!user?._id || !validateForm()) return;

    setSubmitting(true);
    try {
      await apiService.createInterventionReport({
        report_id: formData.report_id.trim(),
        ot_id: formData.ot_id,
        technician_id: user._id,
        description_action: formData.description_action.trim(),
        etat_final: formData.etat_final.trim() || undefined,
        validation_responsable: formData.validation_responsable || "waiting_validation",
        date_debut: fromInputDateTime(formData.date_debut),
        date_fin: fromInputDateTime(formData.date_fin),
      });

      if (selectedDraftId) {
        persistDrafts(drafts.filter((draft) => draft._id !== selectedDraftId));
      }

      await refreshReports();
      setEditorOpen(false);
      showNotification("success", t("notifications.submitSuccess"));
    } catch (error) {
      console.error("Failed to submit draft", error);
      showNotification("error", t("notifications.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [reportsRes, workOrderItems] = await Promise.all([
          apiService.getMyInterventionReports({ page, limit }),
          fetchAllPaginated<WorkOrder>((pagination) => apiService.getMyWorkOrders(pagination)),
        ]);

        setReports(normalizeApiItems<InterventionReport>(reportsRes.data));
        setWorkOrders(workOrderItems);
        const pagination = readPaginationMeta(reportsRes.data);
        setTotalPages(pagination?.totalPages || 1);
        setTotalItems(Number((reportsRes.data as { totalItems?: unknown })?.totalItems) || 0);
        loadDraftsFromStorage();
        showNotification("success", t("notifications.dataLoaded"));
      } catch (error) {
        console.error("Failed to load my reports", error);
        showNotification("error", t("notifications.loadFailed"));
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [draftStorageKey, limit, loadDraftsFromStorage, page, t]);

  const myReports = useMemo(() => {
    return reports
      .map((report) => {
        const workOrderId = refId(report.ot_id);
        const workOrder = workOrders.find((item) => item._id === workOrderId);
        return { report, workOrder };
      })
      .filter((item) => (statusFilter === "all" ? true : item.workOrder?.status === statusFilter));
  }, [reports, statusFilter, workOrders]);

  const selectedReportWorkOrder = useMemo(() => {
    if (!selectedReport) return null;
    const workOrderId = refId(selectedReport.ot_id);
    return workOrders.find((item) => item._id === workOrderId) || null;
  }, [selectedReport, workOrders]);

  function machineLabel(workOrder?: WorkOrder | null): string {
    if (!workOrder?.machine_id) return tCommon("notAvailable");
    return typeof workOrder.machine_id === "string"
      ? workOrder.machine_id
      : workOrder.machine_id.machine_id || tCommon("notAvailable");
  }

  function maintenanceTypeLabel(workOrder?: WorkOrder | null): string {
    return isCorrectiveMaintenanceType(workOrder?.type_maintenance) ? t("corrective") : t("preventive");
  }

  function submittedAt(report?: InterventionReport | null, workOrder?: WorkOrder | null): string {
    const value = report?.date_fin || report?.date_debut || workOrder?.date_created;
    if (!value) return tCommon("notAvailable");
    return new Date(value).toLocaleString();
  }

  function statusLabel(status?: string): string {
    switch (status) {
      case "waiting_validation":
        return t("waitingValidation");
      case "completed":
      case "validated":
        return t("validated");
      case "returned":
        return t("returned");
      case "technician_required":
        return t("technicianRequired");
      default:
        return status || tCommon("notAvailable");
    }
  }

  function statusClasses(status?: string): string {
    switch (status) {
      case "completed":
      case "validated":
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

  return (
    <ProtectedRoute requiredRole="operator">
      <DashboardLayout title={t("myReports")}>
        {notification ? (
          <div
            data-testid="my-reports-notification"
            className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
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
          <section className="col-span-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="card-title mb-2">{t("myReports")}</div>
            <p className="mb-5 text-sm text-slate-600">{t("machineInterventionHistory")}</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1fr_240px]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm text-slate-500">{t("report")}</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">{myReports.length}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm opacity-80">{t("waitingValidation")}</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">
                  {myReports.filter((item) => item.workOrder?.status === "waiting_validation").length}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm opacity-80">{t("completed")}</div>
                <div className="mt-2 text-3xl font-bold text-slate-900">
                  {myReports.filter((item) => ["completed", "validated"].includes(item.workOrder?.status || "")).length}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">{t("validation")}</label>
                <select
                  value={statusFilter}
                  onChange={(event) => handleStatusFilterChange(event.target.value)}
                  data-testid="my-reports-status-filter"
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                  title={t("validation")}
                  aria-label={t("validation")}
                >
                  <option value="all">{t("all")}</option>
                  <option value="waiting_validation">{t("waitingValidation")}</option>
                  <option value="completed">{t("completed")}</option>
                  <option value="returned">{t("returned")}</option>
                  <option value="technician_required">{t("technicianRequired")}</option>
                </select>
              </div>
            </div>
          </section>

          <section className="col-span-full panel">
            <div className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <DocumentTextIcon className="h-5 w-5" />
              {t("report")}
            </div>
            {loading ? (
              <div className="text-sm text-slate-500">{tCommon("loading")}</div>
            ) : myReports.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {myReports.map(({ report, workOrder }, index) => (
                  <article
                    key={report._id}
                    className="w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-slate-900">{machineLabel(workOrder)}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                          <span>{maintenanceTypeLabel(workOrder)}</span>
                          <span aria-hidden="true">|</span>
                          <span>{submittedAt(report, workOrder)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(workOrder?.status || report.validation_responsable)}`}>
                          {statusLabel(workOrder?.status || report.validation_responsable)}
                        </span>
                        <button
                          type="button"
                          data-testid={`my-report-card-${index}`}
                          onClick={() => openReportEditor(report)}
                          aria-label={t("smartCalendar.maintenanceDetails")}
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                          <EyeIcon className="h-4 w-4" />
                          {t("smartCalendar.maintenanceDetails")}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="text-xs text-slate-500">{totalItems} {t("report")}</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  {tCommon("pagination.previous")}
                </button>
                <span className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  {tCommon("pagination.next")}
                </button>
              </div>
            </div>
          </section>
        </div>

        <Modal
          isOpen={editorOpen}
          onClose={() => setEditorOpen(false)}
          title={t("smartCalendar.maintenanceDetails")}
          size="lg"
        >
          {selectedReport ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("machine")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">{machineLabel(selectedReportWorkOrder)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("smartCalendar.maintenanceType")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">{maintenanceTypeLabel(selectedReportWorkOrder)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("dashboard.submissionDate")}</div>
                  <div className="mt-1 text-base font-semibold text-slate-900">{submittedAt(selectedReport, selectedReportWorkOrder)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase text-slate-500">{t("validation")}</div>
                  <div className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClasses(selectedReportWorkOrder?.status || selectedReport.validation_responsable)}`}>
                    {statusLabel(selectedReportWorkOrder?.status || selectedReport.validation_responsable)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-700">{t("actionsPerformed")}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {selectedReport.description_action || tCommon("notAvailable")}
                </div>
              </div>

              {selectedReport.etat_final ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-semibold text-slate-700">{t("machineCondition")}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">{selectedReport.etat_final}</div>
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
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
