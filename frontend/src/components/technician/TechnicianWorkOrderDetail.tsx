"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
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
import { apiService } from "@/services/api";
import { invalidateList, LIST_EVENTS } from "@/services/listInvalidation";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { renderWidgetErrorFallback } from "@/components/WidgetErrorFallback";

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
      <TechnicianWorkOrderDetailInner {...props} />
    </ErrorBoundary>
  );
}

function WorkOrderSummarySection({
  workOrder,
  status,
  reportOwner,
  locale,
  t,
}: Readonly<{
  workOrder: any;
  status: string;
  reportOwner: ReportOwner | undefined;
  locale: string;
  t: TechnicianTranslator;
}>) {
  const statusKey = `status.${status}`;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{workOrder.ot_id}</h2>
          <p>{workOrder.description || t("notAvailable")}</p>
        </div>
        <span className="rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-800">
          {t.has(statusKey) ? t(statusKey) : status}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-slate-500">{t("fields.type")}</dt>
          <dd>{workOrder.type_maintenance || "â€”"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("fields.priority")}</dt>
          <dd>{workOrder.priorite || "â€”"}</dd>
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
        apiService.getTechnicianParts({ page: 1, limit: 100 }),
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
  const act = async (action: () => Promise<unknown>) => {
    if (saving) return;
    try {
      setSaving(true);
      setError("");
      await action();
      // Every action here (start/complete/report update) changes this
      // work order's status server-side — the Admin Work Orders list has
      // no other way to learn its snapshot is now stale.
      invalidateList(LIST_EVENTS.workOrders);
      await load();
    } catch (error: unknown) {
      setError(apiErrorMessage(error, t("errors.update")));
    } finally {
      setSaving(false);
    }
  };
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
          />
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
