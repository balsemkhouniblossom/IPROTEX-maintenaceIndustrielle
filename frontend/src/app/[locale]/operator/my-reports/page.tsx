"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DocumentTextIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { Modal } from "@/components/Modal";
import { useAuth } from "@/contexts/AuthContext";
import { apiService } from "@/services/api";
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
          <section className="col-span-full rounded-4xl border border-slate-200 bg-linear-to-br from-white via-slate-50 to-indigo-50 p-6 shadow-sm">
            <div className="card-title mb-2">{t("myReports")}</div>
            <p className="text-sm text-slate-600 mb-5">{t("machineInterventionHistory")}</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm text-slate-500">{t("report")}</div>
                <div className="text-3xl font-bold text-slate-900 mt-2">{myReports.length}</div>
              </div>
              <div className="rounded-3xl border border-violet-200 bg-violet-50 p-4 shadow-sm text-violet-900">
                <div className="text-sm opacity-80">{t("waitingValidation")}</div>
                <div className="text-3xl font-bold mt-2">{myReports.filter((item) => item.workOrder?.status === "waiting_validation").length}</div>
              </div>
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm text-emerald-900">
                <div className="text-sm opacity-80">{t("completed")}</div>
                <div className="text-3xl font-bold mt-2">{myReports.filter((item) => item.workOrder?.status === "completed").length}</div>
              </div>
              <div>
                <label className="block text-sm mb-2 font-semibold text-slate-700">{t("validation")}</label>
                <select
                  value={statusFilter}
                  onChange={(event) => handleStatusFilterChange(event.target.value)}
                  data-testid="my-reports-status-filter"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 bg-white"
                  title={t("validation")}
                  aria-label={t("validation")}
                >
                  <option value="all">{t("all")}</option>
                  <option value="waiting_validation">{t("waitingValidation")}</option>
                  <option value="completed">{t("completed")}</option>
                  <option value="returned">{t("returned")}</option>
                  <option value="technician_required">{t("technicianRequired")}</option>
                </select>
                <button
                  type="button"
                  onClick={openCreateDraftEditor}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 transition hover:bg-blue-100"
                  data-testid="my-reports-create-draft"
                >
                  <PlusIcon className="h-4 w-4" />
                  {tCommon("add")}
                </button>
              </div>
            </div>
          </section>

          <section className="col-span-full panel">
            <div className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <DocumentTextIcon className="h-5 w-5" />
              {t("report")}
            </div>
            {drafts.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {drafts.map((draft, index) => (
                  <article
                    key={draft._id}
                    className="relative w-full rounded-3xl border border-amber-200 bg-amber-50 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                  >
                    <button
                      type="button"
                      className="absolute inset-0 rounded-3xl"
                      onClick={() => openDraftEditor(draft)}
                      aria-label={`${tCommon("edit")} ${draft.report_id}`}
                      data-testid={`my-report-draft-card-${index}`}
                    />
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-slate-900">{draft.report_id}</div>
                      <div className="rounded-full border border-amber-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                        {t("report")}
                      </div>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{t("workOrder")}: {draft.ot_id || tCommon("notAvailable")}</div>
                    <div className="mt-3 line-clamp-3 text-sm text-slate-700">{draft.description_action || tCommon("notAvailable")}</div>
                    <div className="mt-3 text-xs text-slate-500">{new Date(draft.updatedAt).toLocaleString()}</div>
                    <div className="relative z-10 mt-4 flex justify-end gap-2">
                      <span
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800"
                      >
                        <PencilSquareIcon className="h-3.5 w-3.5" /> {tCommon("edit")}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteDraft(draft._id);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                        data-testid={`my-report-draft-delete-${index}`}
                      >
                        <TrashIcon className="h-3.5 w-3.5" /> {tCommon("delete")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="col-span-full panel">
            {loading ? (
              <div className="text-sm text-slate-500">{tCommon("loading")}</div>
            ) : myReports.length === 0 ? (
              <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {myReports.map(({ report, workOrder }, index) => (
                  <article
                    key={report._id}
                    className="relative w-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                  >
                    <button
                      type="button"
                      className="absolute inset-0 rounded-3xl"
                      data-testid={`my-report-card-${index}`}
                      onClick={() => openReportEditor(report)}
                      aria-label={`${tCommon("edit")} ${report.report_id}`}
                    />
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-semibold text-slate-900">{report.report_id}</div>
                      <div className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {workOrder?.type_maintenance === "preventive" ? t("preventive") : t("corrective")}
                      </div>
                    </div>
                    <div className="text-sm text-slate-500 mt-1">{t("workOrder")}: {workOrder?.ot_id ?? tCommon("notAvailable")}</div>
                    <div className="text-sm mt-3 text-slate-700 line-clamp-3">{report.description_action || tCommon("notAvailable")}</div>
                    <div className="grid grid-cols-2 gap-2 mt-4 text-xs text-slate-600">
                      <div>{t("validation")}: {workOrder?.status ?? tCommon("notAvailable")}</div>
                      <div>{t("machine")}: {typeof workOrder?.machine_id === "string" ? workOrder.machine_id : (workOrder?.machine_id?.machine_id ?? "-")}</div>
                    </div>
                    <div className="relative z-10 mt-4 flex justify-end gap-2">
                      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                        <PencilSquareIcon className="h-3.5 w-3.5" /> {tCommon("edit")}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteReport(report._id);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                        data-testid={`my-report-delete-${index}`}
                      >
                        <TrashIcon className="h-3.5 w-3.5" /> {tCommon("delete")}
                      </button>
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
          title={editorMode === "report" ? tCommon("edit") : t("report")}
          size="lg"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("report")}</label>
              <input
                value={formData.report_id}
                onChange={(event) => setFormData((prev) => ({ ...prev, report_id: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("workOrder")}</label>
              <select
                value={formData.ot_id}
                onChange={(event) => setFormData((prev) => ({ ...prev, ot_id: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
                aria-label={t("workOrder")}
                title={t("workOrder")}
              >
                <option value="">{t("workOrder")}</option>
                {workOrders.map((workOrder) => (
                  <option key={workOrder._id} value={workOrder._id}>
                    {workOrder.ot_id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("smartCalendar.start")}</label>
              <input
                type="datetime-local"
                value={formData.date_debut}
                onChange={(event) => setFormData((prev) => ({ ...prev, date_debut: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("smartCalendar.due")}</label>
              <input
                type="datetime-local"
                value={formData.date_fin}
                onChange={(event) => setFormData((prev) => ({ ...prev, date_fin: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("actionsPerformed")}</label>
              <textarea
                value={formData.description_action}
                onChange={(event) => setFormData((prev) => ({ ...prev, description_action: event.target.value }))}
                className="min-h-28 w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("machineCondition")}</label>
              <input
                value={formData.etat_final}
                onChange={(event) => setFormData((prev) => ({ ...prev, etat_final: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">{t("validation")}</label>
              <select
                value={formData.validation_responsable}
                onChange={(event) => setFormData((prev) => ({ ...prev, validation_responsable: event.target.value }))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 bg-white"
                aria-label={t("validation")}
                title={t("validation")}
              >
                <option value="waiting_validation">{t("waitingValidation")}</option>
                <option value="validated">{t("validated")}</option>
                <option value="returned">{t("returned")}</option>
                <option value="technician_required">{t("technicianRequired")}</option>
              </select>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {editorMode === "report" ? (
                <button
                  type="button"
                  onClick={() => selectedReport && void handleDeleteReport(selectedReport._id)}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                  disabled={submitting}
                >
                  <TrashIcon className="h-4 w-4" /> {tCommon("delete")}
                </button>
              ) : null}

              {editorMode !== "report" ? (
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                  disabled={submitting}
                >
                  {tCommon("save")}
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                disabled={submitting}
              >
                {tCommon("cancel")}
              </button>

              {editorMode === "report" ? (
                <button
                  type="button"
                  onClick={() => void handleSaveReport()}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  disabled={submitting}
                >
                  {submitting ? tCommon("saving") : tCommon("update")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSubmitDraft()}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  disabled={submitting}
                >
                  {submitting ? tCommon("saving") : t("generateReport")}
                </button>
              )}
            </div>
          </div>
        </Modal>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
