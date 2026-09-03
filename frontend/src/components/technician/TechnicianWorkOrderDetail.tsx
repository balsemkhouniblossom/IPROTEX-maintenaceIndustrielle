"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  BeakerIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ClockIcon,
  ClipboardDocumentCheckIcon,
  Cog6ToothIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { Modal } from "@/components/Modal";
import DocumentAttachmentViewer from "@/components/DocumentAttachmentViewer";
import KnowledgeSuggestions from "@/components/knowledge-base/KnowledgeSuggestions";
import AiAssistantPanel from "@/components/ai-assistant/AiAssistantPanel";
import MachineHealthPanel from "@/components/predictive-maintenance/MachineHealthPanel";
import LiveStatusBadge from "@/components/device-monitoring/LiveStatusBadge";
import { useLiveMonitoring } from "@/hooks/useLiveMonitoring";
import type { LiveMachineStatus } from "@/hooks/useLiveMonitoring";
import type { ViewableDocument } from "@/services/documentViewer";
import { apiService, quiet } from "@/services/api";
import { invalidateList, LIST_EVENTS } from "@/services/listInvalidation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { renderWidgetErrorFallback } from "@/components/WidgetErrorFallback";
import { translateEnumValue } from "@/services/enumTranslations";
import { useWorkOrderDynamicTranslations } from "@/hooks/useDynamicContentTranslations";

type Detail = {
  workOrder: any;
  report?: any;
  parts: any[];
  stock: any[];
  manuals: ManualPreview[];
};
type AvailablePart = {
  _id: string;
  quantite_en_stock: number;
  part_id?: {
    _id?: string;
    part_id?: string;
    nom_piece?: string;
    ref_constructeur?: string;
  };
};

type TechnicianWorkOrderDetailProps = Readonly<{ id: string }>;
type TechnicianTranslator = ReturnType<typeof useTranslations>;
type ManualPreview = ViewableDocument;
type ReportOwner = {
  nom_complet?: string;
  role?: string;
};
type ReportDraft = {
  cause_racine: string;
  description_action: string;
  etat_final: string;
};
type DetailTab = "overview" | "intervention" | "parts" | "documents" | "history";
type ActFn = (action: () => Promise<unknown>) => Promise<void>;

/** Shared work-order mutation wrapper: runs the action, invalidates the
 *  work-orders list and reloads the detail. Used by both detail layouts. */
function useWorkOrderAct(options: {
  saving: boolean;
  setSaving: (saving: boolean) => void;
  setError: (message: string) => void;
  load: () => Promise<void>;
  fallbackError: string;
}): ActFn {
  const { saving, setSaving, setError, load, fallbackError } = options;
  return async (action: () => Promise<unknown>) => {
    if (saving) return;
    try {
      setSaving(true);
      setError("");
      await action();
      invalidateList(LIST_EVENTS.workOrders);
      await load();
    } catch (error: unknown) {
      setError(apiErrorMessage(error, fallbackError));
    } finally {
      setSaving(false);
    }
  };
}
type CompletionResult = {
  reportId: string;
  duration: string;
  status: string;
};

type TechnicianActionButtonsProps = {
  readonly id: string;
  readonly status: string;
  readonly saving: boolean;
  readonly hasAssignedTechnician: boolean;
  readonly isTerminal: boolean;
  readonly report: {
    cause_racine: string;
    description_action: string;
    etat_final: string;
  };
  readonly t: ReturnType<typeof useTranslations>;
  readonly act: (action: () => Promise<unknown>) => Promise<void>;
};

function apiErrorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data
      ?.message || fallback
  );
}

function formatMachineValue(
  machine: Record<string, unknown>,
  key: string,
  locale: string,
): string {
  const value = machine[key];
  if (!value) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (key === "installation_date") {
      return new Date(value.toString()).toLocaleDateString(locale);
    }
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toLocaleDateString(locale);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => formatMachineValue({ item }, "item", locale))
      .filter((item) => item !== "â€”")
      .join(", ");
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    const label = item.name ?? item.machine_id ?? item.nom_complet ?? item.email ?? item._id ?? item.id;
    return label ? formatMachineValue({ label }, "label", locale) : "â€”";
  }
  return "â€”";
}

function isTerminalWorkOrderStatus(status: string): boolean {
  return [
    "completed",
    "validated",
    "cancelled",
    "canceled",
    "CLOTURE",
    "ANNULE",
  ].includes(status);
}

function workOrderMachine(workOrder: Record<string, any>): Record<string, any> {
  return workOrder.machine_id && typeof workOrder.machine_id === "object"
    ? workOrder.machine_id
    : {};
}

function operatorReportOwner(report: any): ReportOwner | undefined {
  const technician = report?.technician_id;
  if (technician && typeof technician === "object" && technician.role === "operator") {
    return technician as ReportOwner;
  }

  return undefined;
}

function maintenancePlanId(workOrder: Record<string, any>): string | undefined {
  const plan = workOrder.plan_id;
  if (plan && typeof plan === "object") {
    return plan._id;
  }

  return plan;
}

function dateInputValue(value: unknown): string | number | Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return value;

  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return (
      dateInputValue(item.date_created) ??
      dateInputValue(item.date_debut) ??
      dateInputValue(item.created_at) ??
      dateInputValue(item.updated_at)
    );
  }

  return undefined;
}

function formatOptionalDate(value: unknown, locale: string, fallback: string): string {
  const input = dateInputValue(value);
  if (input === undefined || input === "") return fallback;

  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString(locale);
}

function firstDateValue(...values: unknown[]): unknown {
  return values.find((value) => dateInputValue(value) !== undefined);
}

function compactMachineLabel(machine: Record<string, any>, fallback: string): string {
  return (
    machine.machine_id ||
    machine.code ||
    machine.reference ||
    machine.serial_no ||
    machine._id ||
    fallback
  );
}

function machineTypeModel(machine: Record<string, any>, fallback: string): string {
  const type = machine.type_id?.name || machine.type || machine.category;
  const model = machine.model || machine.modele;
  return [type, model].filter(Boolean).join(" / ") || fallback;
}

function statusTone(status: string): string {
  if (["completed", "validated"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "in_progress") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "waiting_parts") return "border-amber-200 bg-amber-50 text-amber-800";
  if (["returned", "technician_required", "waiting_validation"].includes(status)) return "border-purple-200 bg-purple-50 text-purple-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function priorityTone(priority?: string): string {
  const normalized = (priority || "").toLowerCase();
  if (normalized === "urgent") return "border-red-200 bg-red-50 text-red-800";
  if (normalized === "high") return "border-orange-200 bg-orange-50 text-orange-800";
  if (normalized === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function isInterventionEditable(status: string): boolean {
  return ["in_progress", "waiting_parts"].includes(status);
}

function isCompletedLike(status: string): boolean {
  return ["completed", "validated", "waiting_validation"].includes(status);
}

function durationLabel(start: unknown, end: unknown, locale: string, fallback: string): string {
  const startInput = dateInputValue(start);
  const endInput = dateInputValue(end);
  if (!startInput || !endInput) return fallback;
  const startDate = new Date(startInput);
  const endDate = new Date(endInput);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return fallback;
  const minutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? `${hours.toLocaleString(locale)} h ${remainder.toLocaleString(locale)} min`
    : `${hours.toLocaleString(locale)} h`;
}

function TechnicianActionButtons({
  id,
  status,
  saving,
  hasAssignedTechnician,
  isTerminal,
  report,
  t,
  act,
}: TechnicianActionButtonsProps) {
  const waitingForValidation = [
    "waiting_validation",
    "technician_required",
    "returned",
  ].includes(status);

  return (
    <div className="flex flex-wrap gap-2">
      {!hasAssignedTechnician && !isTerminal && (
        <button type="button"
          disabled={saving}
          className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          onClick={() => void act(() => apiService.claimTechnicianWorkOrder(id))}
        >
          {t("claim")}
        </button>
      )}
      {waitingForValidation && (
        <>
          <span className="rounded-lg bg-slate-100 px-4 py-2 italic text-slate-600">
            {t("messages.awaitingValidation")}
          </span>
          <button type="button"
            disabled={saving}
            className="rounded-lg bg-amber-700 px-4 py-2 text-white"
            onClick={() =>
              void act(() => apiService.reviewTechnicianWorkOrder(id, "return"))
            }
          >
            {t("actions.return")}
          </button>
          <button type="button"
            disabled={saving}
            className="rounded-lg bg-blue-700 px-4 py-2 text-white"
            onClick={() =>
              void act(() => apiService.reviewTechnicianWorkOrder(id, "intervene"))
            }
          >
            {t("actions.intervene")}
          </button>
        </>
      )}
      {status === "assigned" && (
        <button type="button"
          disabled={saving}
          className="rounded-lg bg-blue-700 px-4 py-2 text-white"
          onClick={() => void act(() => apiService.startTechnicianWorkOrder(id))}
        >
          {t("actions.start")}
        </button>
      )}
      {status === "in_progress" && (
        <>
          <button type="button"
            disabled={saving}
            className="rounded-lg bg-amber-700 px-4 py-2 text-white"
            onClick={() => void act(() => apiService.waitForTechnicianParts(id))}
          >
            {t("actions.waitingParts")}
          </button>
          <button type="button"
            disabled={
              saving ||
              !report.description_action.trim() ||
              !report.etat_final.trim()
            }
            className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-50"
            onClick={() =>
              window.confirm(t("messages.confirmClose")) &&
              void act(async () => {
                await apiService.updateTechnicianReport(id, report);
                return apiService.closeTechnicianWorkOrder(id);
              })
            }
          >
            {t("actions.close")}
          </button>
        </>
      )}
      {status === "waiting_parts" && (
        <button type="button"
          disabled={saving}
          className="rounded-lg bg-blue-700 px-4 py-2 text-white"
          onClick={() => void act(() => apiService.resumeTechnicianWorkOrder(id))}
        >
          {t("actions.resume")}
        </button>
      )}
      {["completed", "validated"].includes(status) && (
        <span className="text-emerald-700">{t("messages.completed")}</span>
      )}
    </div>
  );
}

export default function TechnicianWorkOrderDetail(props: TechnicianWorkOrderDetailProps) {
  return (
    <ErrorBoundary boundaryName="technician-work-order-detail" fallback={renderWidgetErrorFallback}>
      <TechnicianWorkOrderDetailWorkspaceInner {...props} />
    </ErrorBoundary>
  );
}

function WorkOrderSummarySection({
  workOrder,
  status,
  reportOwner,
  locale,
  t,
  tEnums,
  description,
  automaticallyTranslated,
}: Readonly<{
  workOrder: any;
  status: string;
  reportOwner: ReportOwner | undefined;
  locale: string;
  t: TechnicianTranslator;
  tEnums: TechnicianTranslator;
  description: string;
  automaticallyTranslated: boolean;
}>) {
  const statusKey = `status.${status}`;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{workOrder.ot_id}</h2>
          <p>
            {description || t("notAvailable")}
            {automaticallyTranslated ? (
              <span
                className="ms-1 text-xs text-amber-700"
                title={t("dynamicTranslations.safetyNotice")}
              >
                {t("dynamicTranslations.auto")}
              </span>
            ) : null}
          </p>
        </div>
        <span className="rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-800">
          {t.has(statusKey) ? t(statusKey) : translateEnumValue(tEnums, 'workOrderStatuses', status)}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-slate-500">{t("fields.type")}</dt>
          <dd>{translateEnumValue(tEnums, 'maintenanceTypes', workOrder.type_maintenance) || "â€”"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("fields.priority")}</dt>
          <dd>{translateEnumValue(tEnums, 'priorities', workOrder.priorite) || "â€”"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("fields.created")}</dt>
          <dd>{formatOptionalDate(workOrder.date_created, locale, "â€”")}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("fields.technician")}</dt>
          <dd>{workOrder.technician_id?.nom_complet || "â€”"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("operator")}</dt>
          <dd>{reportOwner?.nom_complet || t("notAvailable")}</dd>
        </div>
      </dl>
    </section>
  );
}

function MachineSection({
  machine,
  statusByMachine,
  subscribeToMachine,
  locale,
  t,
}: Readonly<{
  machine: Record<string, any>;
  statusByMachine: Record<string, LiveMachineStatus>;
  subscribeToMachine: (machineId: string) => void;
  locale: string;
  t: TechnicianTranslator;
}>) {
  return (
    <section className="panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("machine.title")}</h2>
        <div className="flex items-center gap-3">
          {machine._id ? (
            <LiveStatusBadge
              machineId={machine._id}
              status={statusByMachine[machine._id]}
              onSubscribe={subscribeToMachine}
            />
          ) : null}
          {machine._id ? (
            <Link
              href={`/${locale}/machines/${machine._id}`}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
              {t("machine.viewTimeline", { default: "View timeline" })}
            </Link>
          ) : null}
        </div>
      </div>
      <dl className="grid gap-3 text-sm md:grid-cols-3">
        {[
          "machine_id",
          "serial_no",
          "reference",
          "fabricant",
          "model",
          "location",
          "status",
          "poids_kg",
          "installation_date",
        ].map((key) => (
          <div key={key}>
            <dt className="text-slate-500">{t(`machine.${key}`)}</dt>
            <dd>{formatMachineValue(machine, key, locale)}</dd>
          </div>
        ))}
        <div>
          <dt className="text-slate-500">{t("machine.type")}</dt>
          <dd>{machine.type_id?.name || "â€”"}</dd>
        </div>
      </dl>
    </section>
  );
}

function ReportSection({
  detail,
  reportOwner,
  report,
  setReport,
  status,
  saving,
  act,
  id,
  locale,
  t,
}: Readonly<{
  detail: Detail;
  reportOwner: ReportOwner | undefined;
  report: ReportDraft;
  setReport: (report: ReportDraft) => void;
  status: string;
  saving: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  id: string;
  locale: string;
  t: TechnicianTranslator;
}>) {
  const hasTerminalStatus = ["completed", "validated", "cancelled"].includes(status);

  return (
    <section className="panel">
      <h2 className="mb-3 text-lg font-semibold">{t("report.title")}</h2>
      {detail.report ? (
        <div className="grid gap-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
            <h3 className="font-semibold">{t("operatorSubmission")}</h3>
            <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-blue-700">{t("operator")}</dt>
                <dd>{reportOwner?.nom_complet || t("notAvailable")}</dd>
              </div>
              <div>
                <dt className="text-blue-700">{t("fields.created")}</dt>
                <dd>{formatOptionalDate(detail.report.date_debut, locale, t("notAvailable"))}</dd>
              </div>
              <div>
                <dt className="text-blue-700">{t("report.cause")}</dt>
                <dd>{detail.report.cause_racine || t("notAvailable")}</dd>
              </div>
              <div>
                <dt className="text-blue-700">{t("report.actions")}</dt>
                <dd>{detail.report.description_action || t("notAvailable")}</dd>
              </div>
              <div>
                <dt className="text-blue-700">{t("report.result")}</dt>
                <dd>{detail.report.etat_final || t("notAvailable")}</dd>
              </div>
            </dl>
          </div>
          <label>
            {t("report.cause")}
            <textarea
              className="mt-1 w-full rounded-lg border p-2"
              value={report.cause_racine}
              onChange={(event) => setReport({ ...report, cause_racine: event.target.value })}
            />
          </label>
          <label>
            {t("report.actions")}
            <textarea
              className="mt-1 w-full rounded-lg border p-2"
              value={report.description_action}
              onChange={(event) => setReport({ ...report, description_action: event.target.value })}
            />
          </label>
          <label>
            {t("report.result")}
            <textarea
              className="mt-1 w-full rounded-lg border p-2"
              value={report.etat_final}
              onChange={(event) => setReport({ ...report, etat_final: event.target.value })}
            />
          </label>
          <button type="button"
            disabled={saving || hasTerminalStatus}
            className="w-fit rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
            onClick={() => void act(() => apiService.updateTechnicianReport(id, report))}
          >
            {t("actions.saveReport")}
          </button>
        </div>
      ) : (
        <p className="text-slate-500">{t("empty.report")}</p>
      )}
    </section>
  );
}

function PartsSection({
  detail,
  available,
  partId,
  quantity,
  saving,
  status,
  setPartId,
  setQuantity,
  act,
  id,
  t,
}: Readonly<{
  detail: Detail;
  available: AvailablePart[];
  partId: string;
  quantity: number;
  saving: boolean;
  status: string;
  setPartId: (partId: string) => void;
  setQuantity: (quantity: number) => void;
  act: (action: () => Promise<unknown>) => Promise<void>;
  id: string;
  t: TechnicianTranslator;
}>) {
  const canEditParts = ["in_progress", "waiting_parts"].includes(status);

  return (
    <section className="panel">
      <h2 className="mb-3 text-lg font-semibold">{t("parts.title")}</h2>
      <div className="flex flex-wrap gap-3">
        <select
          aria-label={t("parts.select")}
          value={partId}
          onChange={(event) => setPartId(event.target.value)}
        >
          <option value="">{t("parts.select")}</option>
          {available.map((stock) => (
            <option key={stock._id} value={stock.part_id?._id}>
              {stock.part_id?.ref_constructeur} Â·{" "}
              {stock.part_id?.nom_piece} ({stock.quantite_en_stock})
            </option>
          ))}
        </select>
        <input
          aria-label={t("parts.quantity")}
          type="number"
          min={1}
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
        <button type="button"
          disabled={saving || !partId || !canEditParts}
          className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          onClick={() =>
            void act(() =>
              apiService.setTechnicianPartQuantity(id, {
                partId,
                quantity,
              }),
            )
          }
        >
          {t("actions.addPart")}
        </button>
      </div>
      {detail.parts.length ? (
        <ul className="mt-4 divide-y">
          {detail.parts.map((line) => (
            <li className="py-2 text-sm" key={line._id}>
              {line.part_id?.ref_constructeur} Â· {line.part_id?.nom_piece}: {line.quantite}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{t("empty.parts")}</p>
      )}
    </section>
  );
}

function ManualsSection({
  manuals,
  previewManual,
  setPreviewManual,
  t,
}: Readonly<{
  manuals: ManualPreview[];
  previewManual: ManualPreview | undefined;
  setPreviewManual: (manual: ManualPreview | undefined) => void;
  t: TechnicianTranslator;
}>) {
  return (
    <>
      <section className="panel">
        <h2 className="mb-3 text-lg font-semibold">{t("manuals.title")}</h2>
        {manuals.length ? (
          <div className="flex flex-wrap gap-2">
            {manuals.map((doc) => (
              <button
                className="rounded-lg border px-3 py-2 text-blue-700"
                type="button"
                onClick={() => setPreviewManual(doc)}
                key={doc._id ?? doc.id ?? doc.file_path ?? doc.file_url ?? doc.file_name ?? "manual"}
              >
                {doc.file_name}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-slate-500">{t("empty.manuals")}</p>
        )}
      </section>
      <Modal
        isOpen={Boolean(previewManual)}
        onClose={() => setPreviewManual(undefined)}
        title={previewManual?.file_name ?? t("actions.openManual")}
        size="xl"
      >
        {previewManual ? (
          <DocumentAttachmentViewer document={previewManual} title={previewManual.file_name ?? undefined} />
        ) : null}
      </Modal>
    </>
  );
}

function TechnicianWorkOrderDetailInner({ id }: TechnicianWorkOrderDetailProps) {
  const t = useTranslations("technician");
  const tEnums = useTranslations("common.enums");
  const locale = useLocale();
  const [detail, setDetail] = useState<Detail>();
  const [available, setAvailable] = useState<AvailablePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewManual, setPreviewManual] = useState<ManualPreview>();
  const [report, setReport] = useState({
    cause_racine: "",
    description_action: "",
    etat_final: "",
  });
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const { statusByMachine, subscribeToMachine } = useLiveMonitoring();
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [d, p] = await Promise.all([
        apiService.getTechnicianWorkOrder(id),
        apiService.getTechnicianParts({ page: 1, limit: 100 }, quiet()),
      ]);
      setDetail(d.data);
      setAvailable(p.data.items || []);
      setReport({
        cause_racine: d.data.report?.cause_racine || "",
        description_action: d.data.report?.description_action || "",
        etat_final: d.data.report?.etat_final || "",
      });
    } catch (error: unknown) {
      setError(apiErrorMessage(error, t("errors.load")));
    } finally {
      setLoading(false);
    }
  }, [id, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const dynamicTranslations = useWorkOrderDynamicTranslations(
    detail?.workOrder ? [detail.workOrder] : [],
    locale,
  );
  const act = useWorkOrderAct({
    saving,
    setSaving,
    setError,
    load,
    fallbackError: t("errors.update"),
  });
  if (loading)
    return (
      <ProtectedRoute requiredRole="technician">
        <DashboardLayout title={t("workOrders.detailTitle")}>
          <div className="panel">{t("loading")}</div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  if (!detail)
    return (
      <ProtectedRoute requiredRole="technician">
        <DashboardLayout title={t("workOrders.detailTitle")}>
          <div className="panel border-red-200 bg-red-50 text-red-800">
            {error || t("errors.notFound")}
            <button type="button" className="ml-3" onClick={() => void load()}>
              {t("actions.retry")}
            </button>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  const wo = detail.workOrder;
  const machine = workOrderMachine(wo);
  const status = wo.status;
  const hasAssignedTechnician = Boolean(wo.technician_id);
  const isTerminal = isTerminalWorkOrderStatus(status);
  const reportOwner = operatorReportOwner(detail.report);
  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={`${t("workOrders.detailTitle")} · ${wo.ot_id}`}>
        <div className="space-y-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              {error}
            </div>
          )}
          <WorkOrderSummarySection
            workOrder={wo}
            status={status}
            reportOwner={reportOwner}
            locale={locale}
            t={t}
            tEnums={tEnums}
            description={dynamicTranslations.textFor(
              wo._id,
              "description",
              wo.description,
            )}
            automaticallyTranslated={dynamicTranslations.isAutomaticallyTranslated(
              wo._id,
              "description",
            )}
          />
          {dynamicTranslations.hasTranslationLocale ? (
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm text-amber-700"
                onClick={() =>
                  dynamicTranslations.setShowOriginal(
                    !dynamicTranslations.showOriginal,
                  )
                }
              >
                {dynamicTranslations.showOriginal
                  ? t("dynamicTranslations.showTranslation")
                  : t("dynamicTranslations.showOriginal")}
              </button>
            </div>
          ) : null}
          <KnowledgeSuggestions
            machineId={machine?._id}
            faultCode={wo.code_panne}
            maintenancePlanId={maintenancePlanId(wo)}
          />

          <AiAssistantPanel
            machineId={machine?._id}
            workOrderId={wo._id}
            faultCode={wo.code_panne}
          />

          <MachineHealthPanel machineId={machine?._id} />

          <MachineSection
            machine={machine}
            statusByMachine={statusByMachine}
            subscribeToMachine={subscribeToMachine}
            locale={locale}
            t={t}
          />
          <ReportSection
            detail={detail}
            reportOwner={reportOwner}
            report={report}
            setReport={setReport}
            status={status}
            saving={saving}
            act={act}
            id={id}
            locale={locale}
            t={t}
          />
          <PartsSection
            detail={detail}
            available={available}
            partId={partId}
            quantity={quantity}
            saving={saving}
            status={status}
            setPartId={setPartId}
            setQuantity={setQuantity}
            act={act}
            id={id}
            t={t}
          />
          <ManualsSection
            manuals={detail.manuals}
            previewManual={previewManual}
            setPreviewManual={setPreviewManual}
            t={t}
          />
          <section className="panel">
            <h2 className="mb-3 text-lg font-semibold">{t("actions.title")}</h2>
            <TechnicianActionButtons
              id={id}
              status={status}
              saving={saving}
              hasAssignedTechnician={hasAssignedTechnician}
              isTerminal={isTerminal}
              report={report}
              t={t}
              act={act}
            />
          </section>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function TechnicianWorkOrderDetailWorkspaceInner({ id }: TechnicianWorkOrderDetailProps) {
  const t = useTranslations("technician");
  const tEnums = useTranslations("common.enums");
  const locale = useLocale();
  const [detail, setDetail] = useState<Detail>();
  const [available, setAvailable] = useState<AvailablePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewManual, setPreviewManual] = useState<ManualPreview>();
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [showTechnicalAnalysis, setShowTechnicalAnalysis] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completionResult, setCompletionResult] = useState<CompletionResult>();
  const [finalResult, setFinalResult] = useState("resolved");
  const [finalNotes, setFinalNotes] = useState("");
  const [report, setReport] = useState<ReportDraft>({
    cause_racine: "",
    description_action: "",
    etat_final: "",
  });
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const { statusByMachine, subscribeToMachine } = useLiveMonitoring();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const detailResponse = await apiService.getTechnicianWorkOrder(id);
      setDetail(detailResponse.data);
      setAvailable(detailResponse.data.stock || []);
      setReport({
        cause_racine: detailResponse.data.report?.cause_racine || "",
        description_action: detailResponse.data.report?.description_action || "",
        etat_final: detailResponse.data.report?.etat_final || "",
      });
      try {
        const partsResponse = await apiService.getTechnicianParts(
          {
            page: 1,
            limit: 100,
          },
          quiet(),
        );
        setAvailable(partsResponse.data.items || []);
      } catch {
        setAvailable(detailResponse.data.stock || []);
      }
    } catch (error: unknown) {
      setError(apiErrorMessage(error, t("errors.load")));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const dynamicTranslations = useWorkOrderDynamicTranslations(
    detail?.workOrder ? [detail.workOrder] : [],
    locale,
  );

  const act = useWorkOrderAct({
    saving,
    setSaving,
    setError,
    load,
    fallbackError: t("errors.update"),
  });

  if (loading) {
    return (
      <ProtectedRoute requiredRole="technician">
        <DashboardLayout title={t("workOrders.detailTitle")}>
          <div className="panel">{t("loading")}</div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  if (!detail) {
    return (
      <ProtectedRoute requiredRole="technician">
        <DashboardLayout title={t("workOrders.detailTitle")}>
          <div className="panel border-red-200 bg-red-50 text-red-800">
            {error || t("errors.notFound")}
            <button type="button" className="ml-3" onClick={() => void load()}>
              {t("actions.retry")}
            </button>
          </div>
        </DashboardLayout>
      </ProtectedRoute>
    );
  }

  const wo = detail.workOrder;
  const machine = workOrderMachine(wo);
  const status = wo.status;
  const isTerminal = isTerminalWorkOrderStatus(status);
  const hasAssignedTechnician = Boolean(wo.technician_id);
  const reportOwner = operatorReportOwner(detail.report);
  const description = dynamicTranslations.textFor(wo._id, "description", wo.description);
  const selectedStock = available.find((stock) => stock.part_id?._id === partId);
  const availableQuantity = selectedStock?.quantite_en_stock ?? 0;
  const startedAt = firstDateValue(wo.date_start, detail.report?.date_debut);
  const endedAt = firstDateValue(wo.date_end, wo.date_closed, detail.report?.date_fin);
  const duration = durationLabel(startedAt, endedAt ?? new Date(), locale, t("notAvailable"));
  const canEditIntervention = isInterventionEditable(status);
  const waitingForValidation = ["waiting_validation", "technician_required", "returned"].includes(status);
  const lifecycleHistory = Array.isArray(wo.lifecycle_history) ? wo.lifecycle_history : [];
  const tabs: Array<{ key: DetailTab; label: string; Icon: typeof ClipboardDocumentCheckIcon }> = [
    { key: "overview", label: t("detailTabs.overview"), Icon: ClipboardDocumentCheckIcon },
    { key: "intervention", label: t("detailTabs.intervention"), Icon: WrenchScrewdriverIcon },
    { key: "parts", label: t("detailTabs.parts"), Icon: Cog6ToothIcon },
    { key: "documents", label: t("detailTabs.documents"), Icon: BookOpenIcon },
    { key: "history", label: t("detailTabs.history"), Icon: ClockIcon },
  ];

  const completeIntervention = () =>
    void act(async () => {
      const resultLabel = t(`completion.results.${finalResult}`);
      const notes = finalNotes.trim();
      const nextReport = {
        ...report,
        etat_final: notes ? `${resultLabel}: ${notes}` : resultLabel,
      };
      await apiService.updateTechnicianReport(id, nextReport);
      const closeResponse = await apiService.closeTechnicianWorkOrder(id);
      setReport(nextReport);
      setCompletionResult({
        reportId: detail.report?._id || detail.report?.report_id || wo.ot_id,
        duration,
        status: closeResponse.data?.status || "waiting_validation",
      });
      setCompleteOpen(false);
    });

  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={`${t("workOrders.detailTitle")} · ${wo.ot_id}`}>
        <div className="space-y-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
              {error}
            </div>
          ) : null}

          {completionResult ? (
            <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <CheckCircleIcon className="mt-0.5 h-6 w-6 shrink-0" />
                  <div>
                    <h2 className="text-lg font-semibold">{t("completion.completedTitle")}</h2>
                    <p className="text-sm">{t("completion.completedMessage")}</p>
                    <p className="mt-2 text-sm">
                      {t("completion.reportId")}: <strong>{completionResult.reportId}</strong>
                      <span className="mx-2">/</span>
                      {t("completion.duration")}: <strong>{completionResult.duration}</strong>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800" onClick={() => setActiveTab("intervention")}>
                    {t("actions.viewReport")}
                  </button>
                  <Link href={`/${locale}/technician/work-orders`} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">
                    {t("completion.backToWork")}
                  </Link>
                </div>
              </div>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${priorityTone(wo.priorite)}`}>
                      {translateEnumValue(tEnums, "priorities", wo.priorite) || t("notAvailable")}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(status)}`}>
                      {t.has(`status.${status}`) ? t(`status.${status}`) : translateEnumValue(tEnums, "workOrderStatuses", status)}
                    </span>
                  </div>
                  <h1 className="text-2xl font-bold text-slate-950">{wo.ot_id}</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-600">
                    {description || t("notAvailable")}
                    {dynamicTranslations.isAutomaticallyTranslated(wo._id, "description") ? (
                      <span className="ms-1 text-xs text-amber-700" title={t("dynamicTranslations.safetyNotice")}>
                        {t("dynamicTranslations.auto")}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-2 lg:min-w-[32rem]">
                  <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">{t("fields.machine")}</p>
                    <p className="font-semibold text-slate-900">{compactMachineLabel(machine, t("notAvailable"))}</p>
                    <p className="text-xs text-slate-500">{machineTypeModel(machine, t("notAvailable"))}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white/80 p-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">{t("fields.due")}</p>
                    <p className="font-semibold text-slate-900">{formatOptionalDate(wo.due_date, locale, t("notAvailable"))}</p>
                    <p className="text-xs text-slate-500">{translateEnumValue(tEnums, "maintenanceTypes", wo.type_maintenance) || t("notAvailable")}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2">
              {tabs.map(({ key, label, Icon }) => (
                <button key={key} type="button" onClick={() => setActiveTab(key)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${activeTab === key ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {dynamicTranslations.hasTranslationLocale ? (
            <div className="flex justify-end">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm text-amber-700" onClick={() => dynamicTranslations.setShowOriginal(!dynamicTranslations.showOriginal)}>
                {dynamicTranslations.showOriginal ? t("dynamicTranslations.showTranslation") : t("dynamicTranslations.showOriginal")}
              </button>
            </div>
          ) : null}

          {activeTab === "overview" ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="panel">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <ClipboardDocumentCheckIcon className="h-5 w-5 text-blue-700" />
                  {t("overview.title")}
                </h2>
                <dl className="grid gap-3 text-sm md:grid-cols-2">
                  <div><dt className="text-slate-500">{t("fields.machine")}</dt><dd className="font-medium">{compactMachineLabel(machine, t("notAvailable"))}</dd></div>
                  <div><dt className="text-slate-500">{t("overview.problem")}</dt><dd>{description || t("notAvailable")}</dd></div>
                  <div><dt className="text-slate-500">{t("overview.reportedBy")}</dt><dd>{reportOwner?.nom_complet || t("notAvailable")}</dd></div>
                  <div><dt className="text-slate-500">{t("fields.priority")}</dt><dd>{translateEnumValue(tEnums, "priorities", wo.priorite) || t("notAvailable")}</dd></div>
                  <div><dt className="text-slate-500">{t("fields.status")}</dt><dd>{t.has(`status.${status}`) ? t(`status.${status}`) : translateEnumValue(tEnums, "workOrderStatuses", status)}</dd></div>
                  <div><dt className="text-slate-500">{t("fields.due")}</dt><dd>{formatOptionalDate(wo.due_date, locale, t("notAvailable"))}</dd></div>
                </dl>
                {wo.code_panne ? (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {t("overview.faultCode")}: <strong>{wo.code_panne}</strong>
                  </p>
                ) : null}
              </section>

              <section className="panel border border-cyan-100 bg-cyan-50/60">
                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-cyan-950">
                  <BeakerIcon className="h-5 w-5" />
                  {t("machineContext.title")}
                </h2>
                <dl className="grid gap-3 text-sm">
                  <div className="flex justify-between gap-4 border-b border-cyan-100 pb-2"><dt className="text-cyan-800">{t("machineContext.health")}</dt><dd className="font-semibold">{t("notAvailable")}</dd></div>
                  <div className="flex justify-between gap-4 border-b border-cyan-100 pb-2"><dt className="text-cyan-800">{t("machineContext.currentStatus")}</dt><dd className="font-semibold">{formatMachineValue(machine, "status", locale)}</dd></div>
                  <div className="flex justify-between gap-4 border-b border-cyan-100 pb-2"><dt className="text-cyan-800">{t("machineContext.openWorkOrders")}</dt><dd className="font-semibold">{isTerminal ? 0 : 1}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-cyan-800">{t("machineContext.lastMaintenance")}</dt><dd className="font-semibold">{formatOptionalDate(firstDateValue(detail.report?.date_fin, wo.date_closed, wo.date_end), locale, t("notAvailable"))}</dd></div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {machine._id ? <LiveStatusBadge machineId={machine._id} status={statusByMachine[machine._id]} onSubscribe={subscribeToMachine} /> : null}
                  {machine._id ? (
                    <Link href={`/${locale}/machines/${machine._id}`} className="rounded-lg border border-cyan-200 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800">
                      {t("machine.viewTimeline", { default: "View timeline" })}
                    </Link>
                  ) : null}
                </div>
              </section>

              <section className="panel xl:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <SparklesIcon className="h-5 w-5 text-purple-700" />
                      {t("aiInsight.title")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">{t("aiInsight.summary")}</p>
                  </div>
                  <button type="button" className="rounded-lg border border-purple-200 px-3 py-2 text-sm font-semibold text-purple-800" onClick={() => setShowTechnicalAnalysis(!showTechnicalAnalysis)}>
                    {showTechnicalAnalysis ? t("aiInsight.hideTechnical") : t("aiInsight.viewTechnical")}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-lg bg-purple-50 p-3"><strong>{t("aiInsight.healthInsight")}</strong><p className="mt-1 text-slate-600">{t("aiInsight.healthCopy")}</p></div>
                  <div className="rounded-lg bg-amber-50 p-3"><strong>{t("aiInsight.possibleAnomaly")}</strong><p className="mt-1 text-slate-600">{wo.code_panne || t("notAvailable")}</p></div>
                  <div className="rounded-lg bg-emerald-50 p-3"><strong>{t("aiInsight.recommendedInspection")}</strong><p className="mt-1 text-slate-600">{t("aiInsight.recommendedCopy")}</p></div>
                </div>
                {showTechnicalAnalysis ? (
                  <div className="mt-4 space-y-4">
                    <MachineHealthPanel machineId={machine?._id} />
                    <AiAssistantPanel machineId={machine?._id} workOrderId={wo._id} faultCode={wo.code_panne} />
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {activeTab === "intervention" ? (
            <section className="panel">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <WrenchScrewdriverIcon className="h-5 w-5 text-blue-700" />
                    {t("intervention.title")}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {startedAt ? `${t("intervention.startedAt")}: ${formatOptionalDate(startedAt, locale, t("notAvailable"))}` : t("intervention.notStarted")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!hasAssignedTechnician && !isTerminal ? <button type="button" disabled={saving} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void act(() => apiService.claimTechnicianWorkOrder(id))}>{t("claim")}</button> : null}
                  {waitingForValidation ? (
                    <>
                      <span className="rounded-lg bg-slate-100 px-4 py-2 text-sm italic text-slate-600">{t("messages.awaitingValidation")}</span>
                      <button type="button" disabled={saving} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void act(() => apiService.reviewTechnicianWorkOrder(id, "return"))}>{t("actions.return")}</button>
                      <button type="button" disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void act(() => apiService.reviewTechnicianWorkOrder(id, "intervene"))}>{t("actions.intervene")}</button>
                    </>
                  ) : null}
                  {status === "assigned" ? <button type="button" disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void act(() => apiService.startTechnicianWorkOrder(id))}>{t("actions.start")}</button> : null}
                  {status === "in_progress" ? (
                    <>
                      <button type="button" disabled={saving} className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50" onClick={() => void act(() => apiService.updateTechnicianReport(id, report))}>{t("actions.saveProgress")}</button>
                      <button type="button" disabled={saving} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void act(() => apiService.waitForTechnicianParts(id))}>{t("actions.waitingParts")}</button>
                      <button type="button" disabled={saving || !report.description_action.trim() || !report.etat_final.trim()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => setCompleteOpen(true)}>{t("actions.completeIntervention")}</button>
                    </>
                  ) : null}
                  {status === "waiting_parts" ? (
                    <>
                      <button type="button" className="rounded-lg border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-800" onClick={() => setActiveTab("parts")}>{t("actions.viewPartsRequest")}</button>
                      <button type="button" disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void act(() => apiService.resumeTechnicianWorkOrder(id))}>{t("actions.resume")}</button>
                    </>
                  ) : null}
                  {isCompletedLike(status) ? <button type="button" className="rounded-lg border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-800">{t("actions.viewReport")}</button> : null}
                </div>
              </div>
              {canEditIntervention ? (
                <div className="grid gap-4">
                  <label className="grid gap-1 text-sm font-medium text-slate-700">{t("intervention.diagnosis")}<textarea className="min-h-24 rounded-lg border p-3 font-normal" value={report.cause_racine} onChange={(event) => setReport({ ...report, cause_racine: event.target.value })} /></label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">{t("intervention.actionPerformed")}<textarea className="min-h-24 rounded-lg border p-3 font-normal" value={report.description_action} onChange={(event) => setReport({ ...report, description_action: event.target.value })} /></label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">{t("intervention.observations")}<textarea className="min-h-20 rounded-lg border p-3 font-normal" value={report.etat_final} onChange={(event) => setReport({ ...report, etat_final: event.target.value })} /></label>
                </div>
              ) : (
                <dl className="grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-lg border p-3"><dt className="text-slate-500">{t("intervention.diagnosis")}</dt><dd>{report.cause_racine || t("notAvailable")}</dd></div>
                  <div className="rounded-lg border p-3"><dt className="text-slate-500">{t("intervention.actionPerformed")}</dt><dd>{report.description_action || t("notAvailable")}</dd></div>
                  <div className="rounded-lg border p-3"><dt className="text-slate-500">{t("intervention.observations")}</dt><dd>{report.etat_final || t("notAvailable")}</dd></div>
                </dl>
              )}
            </section>
          ) : null}

          {activeTab === "parts" ? (
            <section className="panel">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Cog6ToothIcon className="h-5 w-5 text-amber-700" />{t("parts.title")}</h2>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">{t("parts.used")}</h3>
                  {detail.parts.length ? (
                    <ul className="mt-3 divide-y rounded-lg border">
                      {detail.parts.map((line) => <li className="flex justify-between gap-4 p-3 text-sm" key={line._id}><span>{line.part_id?.ref_constructeur} / {line.part_id?.nom_piece}</span><strong>{line.quantite}</strong></li>)}
                    </ul>
                  ) : (
                    <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-slate-500">{t("parts.noneAdded")}</p>
                  )}
                </div>
                <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
                  <h3 className="font-semibold text-amber-950">{t("parts.addPart")}</h3>
                  <div className="mt-3 grid gap-3">
                    <select className="rounded-lg border bg-white p-2 text-sm" aria-label={t("parts.select")} value={partId} onChange={(event) => setPartId(event.target.value)}>
                      <option value="">{t("parts.select")}</option>
                      {available.map((stock) => <option key={stock._id} value={stock.part_id?._id}>{stock.part_id?.ref_constructeur} / {stock.part_id?.nom_piece} ({stock.quantite_en_stock})</option>)}
                    </select>
                    <p className="text-xs text-amber-800">{t("parts.available")}: <strong>{partId ? availableQuantity : t("notAvailable")}</strong></p>
                    <input className="rounded-lg border bg-white p-2 text-sm" aria-label={t("parts.quantity")} type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
                    <button type="button" disabled={saving || !partId || !canEditIntervention || quantity > availableQuantity} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void act(() => apiService.setTechnicianPartQuantity(id, { partId, quantity }))}>{t("actions.addPart")}</button>
                    {partId && quantity > availableQuantity ? <button type="button" disabled={saving || !canEditIntervention} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50" onClick={() => void act(() => apiService.requestTechnicianPart(id, { part_id: partId, quantity }))}>{t("parts.requestPart")}</button> : null}
                    <p className="text-xs text-amber-800">{t("parts.requestStatus")}: {status === "waiting_parts" ? t("status.waiting_parts") : t("notAvailable")}</p>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === "documents" ? (
            <div className="space-y-5">
              <ManualsSection manuals={detail.manuals} previewManual={previewManual} setPreviewManual={setPreviewManual} t={t} />
              <KnowledgeSuggestions machineId={machine?._id} faultCode={wo.code_panne} maintenancePlanId={maintenancePlanId(wo)} />
            </div>
          ) : null}

          {activeTab === "history" ? (
            <section className="panel">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><ClockIcon className="h-5 w-5 text-slate-700" />{t("history.title")}</h2>
              <ol className="space-y-3">
                <li className="rounded-lg border p-3 text-sm"><p className="font-semibold">{t("history.created")}</p><p className="text-slate-500">{formatOptionalDate(wo.date_created, locale, t("notAvailable"))}</p></li>
                {startedAt ? <li className="rounded-lg border p-3 text-sm"><p className="font-semibold">{t("history.started")}</p><p className="text-slate-500">{formatOptionalDate(startedAt, locale, t("notAvailable"))}</p></li> : null}
                {lifecycleHistory.map((entry: any, index: number) => (
                  <li className="rounded-lg border p-3 text-sm" key={`${entry.action}-${entry.at}-${index}`}>
                    <p className="font-semibold">{entry.action || t("history.statusChanged")}</p>
                    <p className="text-slate-500">{formatOptionalDate(entry.at, locale, t("notAvailable"))}</p>
                    <p className="text-slate-600">{entry.from_status ? `${entry.from_status} -> ` : ""}{entry.to_status}</p>
                    {entry.reason ? <p className="mt-1 text-slate-500">{entry.reason}</p> : null}
                  </li>
                ))}
                {endedAt ? <li className="rounded-lg border p-3 text-sm"><p className="font-semibold">{t("history.completed")}</p><p className="text-slate-500">{formatOptionalDate(endedAt, locale, t("notAvailable"))}</p></li> : null}
              </ol>
            </section>
          ) : null}

          <Modal isOpen={completeOpen} onClose={() => setCompleteOpen(false)} title={t("completion.title")} size="lg">
            <div className="space-y-4">
              <dl className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-lg border p-3"><dt className="text-slate-500">{t("intervention.diagnosis")}</dt><dd>{report.cause_racine || t("notAvailable")}</dd></div>
                <div className="rounded-lg border p-3"><dt className="text-slate-500">{t("intervention.actionPerformed")}</dt><dd>{report.description_action || t("notAvailable")}</dd></div>
                <div className="rounded-lg border p-3"><dt className="text-slate-500">{t("completion.partsUsed")}</dt><dd>{detail.parts.length}</dd></div>
                <div className="rounded-lg border p-3"><dt className="text-slate-500">{t("completion.duration")}</dt><dd>{duration}</dd></div>
              </dl>
              <div className="grid gap-2 text-sm">
                <span className="font-semibold">{t("completion.finalResult")}</span>
                {["resolved", "followUp"].map((value) => (
                  <label key={value} className="flex items-center gap-2 rounded-lg border p-3">
                    <input type="radio" name="finalResult" value={value} checked={finalResult === value} onChange={(event) => setFinalResult(event.target.value)} />
                    {t(`completion.results.${value}`)}
                  </label>
                ))}
              </div>
              <label className="grid gap-1 text-sm font-semibold text-slate-700">
                {t("completion.finalNotes")}
                <textarea className="min-h-24 rounded-lg border p-3 font-normal" value={finalNotes} onChange={(event) => setFinalNotes(event.target.value)} />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => setCompleteOpen(false)}>{t("actions.cancel")}</button>
                <button type="button" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={completeIntervention}>{t("actions.completeIntervention")}</button>
              </div>
            </div>
          </Modal>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
