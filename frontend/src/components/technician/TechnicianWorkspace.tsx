"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { Modal } from "@/components/Modal";
import Pagination from "@/components/Pagination";
import DocumentAttachmentViewer from "@/components/DocumentAttachmentViewer";
import { apiService } from "@/services/api";
import { translateEnumValue } from "@/services/enumTranslations";
import { useWorkOrderDynamicTranslations } from "@/hooks/useDynamicContentTranslations";

type WorkOrder = {
  _id: string;
  ot_id: string;
  status: string;
  priorite?: string;
  type_maintenance?: string;
  description?: string;
  reschedule_reason?: string;
  lifecycle_history?: Array<{ reason?: string }>;
  date_created?: string;
  date_start?: string;
  scheduled_date?: string;
  due_date?: string;
  date_end?: string;
  date_closed?: string;
  original_due_date?: string;
  machine_id?:
    | string
    | {
        _id?: string;
        machine_id?: string;
        reference?: string;
        serial_no?: string;
        fabricant?: string;
        model?: string;
        status?: string;
        location?: string;
        type_id?: { name?: string };
      }
    | null;
  technician_id?: string | { nom_complet?: string };
  operator?: { _id?: string; user_id?: string; nom_complet?: string };
};
type PageData<T> = {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
};
type DashboardData = {
  counters: Record<string, number>;
  urgentTasks: WorkOrder[];
  current: WorkOrder[];
  waitingPartsTasks: WorkOrder[];
  upcoming: WorkOrder[];
  recent: WorkOrder[];
  manuals: Manual[];
};
type Manual = {
  _id: string;
  file_name: string;
  file_path: string;
  preview_path?: string;
  type_document: string;
  description?: string;
  machine_id?: {
    machine_id?: string;
    type_id?: { _id?: string; name?: string } | string | null;
  } | null;
};
type StockPart = {
  _id: string;
  stock_id: string;
  part_id?: string | {
    _id?: string;
    part_id?: string;
    nom_piece?: string;
    ref_constructeur?: string;
    fabricant?: string;
    categorie_piece?: string;
  };
  quantite_en_stock?: number;
  quantite_reservee?: number;
  seuil_alerte_stock?: number;
  quantite_minimale?: number;
  emplacement?: string;
};
type WorkOrderTab = {
  key: "all" | "assigned" | "inProgress" | "waitingParts" | "completed";
  status?: "assigned" | "in_progress" | "waiting_parts" | "completed";
};
type DashboardSummaryCard = {
  key: "assigned" | "inProgress" | "waitingParts" | "urgent";
  labelKey: string;
  href: string;
  accentClass: string;
  valueClass: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const terminal = new Set(["completed", "validated", "cancelled", "canceled"]);
const review = new Set([
  "waiting_validation",
  "technician_required",
  "returned",
]);
const TECHNICIAN_PAGE_SIZE = 20;
const TECHNICIAN_WORK_ORDER_TABS: WorkOrderTab[] = [
  { key: "all" },
  { key: "assigned", status: "assigned" },
  { key: "inProgress", status: "in_progress" },
  { key: "waitingParts", status: "waiting_parts" },
  { key: "completed", status: "completed" },
];

function ManualPreviewModal({
  manual,
  onClose,
  title,
}: Readonly<{
  manual?: Manual;
  onClose: () => void;
  title: string;
}>) {
  return (
    <Modal
      isOpen={Boolean(manual)}
      onClose={onClose}
      title={manual?.file_name || title}
      size="xl"
    >
      {manual ? (
        <DocumentAttachmentViewer document={manual} title={manual.file_name} />
      ) : null}
    </Modal>
  );
}

function machineName(order: WorkOrder): string | undefined {
  const machine = order.machine_id;
  if (typeof machine === "string") return machine || undefined;
  if (!machine || typeof machine !== "object") return undefined;
  return machine.machine_id || machine.reference || machine.model || undefined;
}

function machineModel(order: WorkOrder): string | undefined {
  const machine = order.machine_id;
  if (!machine || typeof machine !== "object") return undefined;
  return machine.model || machine.type_id?.name || machine.fabricant || undefined;
}

function machineStatus(order: WorkOrder): string | undefined {
  const machine = order.machine_id;
  if (!machine || typeof machine !== "object") return undefined;
  return machine.status;
}

function machineOptionValue(order: WorkOrder): string | undefined {
  const machine = order.machine_id;
  if (!machine || typeof machine !== "object") return undefined;
  return machine._id;
}

function machineFilterLabel(order: WorkOrder): string | undefined {
  const label = machineName(order);
  const model = machineModel(order);
  if (!label) return undefined;
  return model && model !== label ? `${label} - ${model}` : label;
}

function formatOrderDate(value: string | undefined, locale: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(locale);
}

function partName(part: StockPart["part_id"], fallback: string): string {
  if (!part) return fallback;
  if (typeof part === "string") return part || fallback;
  return part.nom_piece || part.part_id || fallback;
}

function availableQuantity(part: StockPart): number {
  return (part.quantite_en_stock ?? 0) - (part.quantite_reservee ?? 0);
}

function isClosedStatus(status: string): boolean {
  return terminal.has(status);
}

function isWorkOrderOverdue(order: WorkOrder): boolean {
  const value = order.due_date || order.scheduled_date || order.date_start;
  if (!value || isClosedStatus(order.status)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date < new Date();
}

function priorityBadgeClass(priority?: string): string {
  const value = priority?.toLowerCase();
  if (value === "urgent") return "border-red-200 bg-red-50 text-red-700";
  if (value === "high") return "border-orange-200 bg-orange-50 text-orange-700";
  if (value === "medium") return "border-yellow-200 bg-yellow-50 text-yellow-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function maintenanceBadgeClass(type?: string): string {
  const value = type?.toLowerCase();
  if (value === "preventive") return "border-blue-200 bg-blue-50 text-blue-700";
  if (value === "corrective") return "border-orange-200 bg-orange-50 text-orange-700";
  if (value === "inspection") return "border-violet-200 bg-violet-50 text-violet-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function uniqueOrders(orders: WorkOrder[]): WorkOrder[] {
  const seen = new Set<string>();
  return orders.filter((order) => {
    if (seen.has(order._id)) return false;
    seen.add(order._id);
    return true;
  });
}

function priorityRank(order: WorkOrder): number {
  const value = order.priorite?.toLowerCase();
  if (value === "urgent") return 0;
  if (value === "high") return 1;
  if (value === "medium") return 2;
  return 3;
}

function dueDateValue(order: WorkOrder): number {
  const value = order.due_date || order.scheduled_date || order.date_start || order.date_created;
  if (!value) return Number.MAX_SAFE_INTEGER;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function dueUrgencyRank(order: WorkOrder): number {
  const value = order.due_date || order.scheduled_date || order.date_start;
  if (!value) return 3;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 3;

  const diffDays = Math.round((startOfLocalDay(date) - startOfLocalDay(new Date())) / 86400000);
  if (diffDays < 0) return 0;
  if (diffDays === 0) return 1;
  return 2;
}

function compareTechnicianPriorityOrders(left: WorkOrder, right: WorkOrder): number {
  return (
    priorityRank(left) - priorityRank(right) ||
    dueUrgencyRank(left) - dueUrgencyRank(right) ||
    dueDateValue(left) - dueDateValue(right)
  );
}

function formatDueLabel(order: WorkOrder, locale: string, todayLabel: string, tomorrowLabel: string): string {
  const value = order.due_date || order.scheduled_date || order.date_start;
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const diffDays = Math.round((startOfLocalDay(date) - startOfLocalDay(new Date())) / 86400000);
  if (diffDays === 0) return todayLabel;
  if (diffDays === 1) return tomorrowLabel;
  return date.toLocaleDateString(locale, { day: "2-digit", month: "short" });
}

function initialWorkOrderFilters(fixedStatus?: string) {
  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const status = params.get("status");
  const initialStatus = TECHNICIAN_WORK_ORDER_TABS.some((tab) => tab.status === status)
    ? status || ""
    : "";

  return {
    status: fixedStatus || initialStatus,
    search: params.get("search") || "",
    maintenanceType: "",
    priority: params.get("priority") || "",
    machineId: "",
    dueDate: "",
    dateFrom: "",
    dateTo: "",
  };
}

function DashboardSectionTitle({
  children,
  icon: Icon,
  iconClassName,
}: Readonly<{
  children: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  iconClassName: string;
}>) {
  return (
    <div className="mb-4 border-b border-slate-300 pb-3">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-900">
        <Icon className={`h-5 w-5 ${iconClassName}`} />
        {children}
      </h2>
    </div>
  );
}

function ErrorBox({
  message,
  retry,
  label,
}: Readonly<{
  message: string;
  retry: () => void;
  label: string;
}>) {
  return (
    <div className="panel border border-red-200 bg-red-50 text-red-800">
      <p>{message}</p>
      <button type="button"
        className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-white"
        onClick={retry}
      >
        {label}
      </button>
    </div>
  );
}

function OrderCard({
  order,
  locale,
  viewLabel,
  description,
  automaticallyTranslated,
}: Readonly<{
  order: WorkOrder;
  locale: string;
  viewLabel: string;
  description: string;
  automaticallyTranslated: boolean;
}>) {
  const t = useTranslations("technician");
  const tEnums = useTranslations("common.enums");
  const statusKey = `status.${order.status}`;
  const dateRows = [
    {
      label: t("fields.created"),
      value: formatOrderDate(order.date_created, locale),
    },
    {
      label: t.has("fields.startDate") ? t("fields.startDate") : "Start",
      value: formatOrderDate(
        order.due_date || order.scheduled_date || order.date_start,
        locale,
      ),
    },
    {
      label: t.has("fields.endDate") ? t("fields.endDate") : "End",
      value: formatOrderDate(order.date_end || order.date_closed, locale),
    },
  ];
  return (
    <article className="technician-order-card rounded-xl border p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="technician-order-title font-semibold">{order.ot_id}</h3>
          <p className="technician-order-muted text-sm">
            {machineName(order) || t("notAvailable")}
          </p>
        </div>
        <span className="technician-order-status rounded-full px-2 py-1 text-xs">
          {t.has(statusKey) ? t(statusKey) : translateEnumValue(tEnums, 'workOrderStatuses', order.status)}
        </span>
      </div>
      <p className="technician-order-description mt-3 line-clamp-2 text-sm">
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
      <p className="technician-order-text mt-2 text-sm">
        <span className="font-medium">{t("operator")}:</span>{" "}
        {order.operator?.nom_complet || t("notAvailable")}
      </p>
      <div className="technician-order-muted mt-3 flex flex-wrap gap-2 text-xs [&>span:nth-child(n+4)]:hidden">
        <span>{translateEnumValue(tEnums, 'maintenanceTypes', order.type_maintenance) || "—"}</span>
        <span>•</span>
        <span>{translateEnumValue(tEnums, 'priorities', order.priorite) || "—"}</span>
        <span>•</span>
        <span>
          {order.date_created
            ? new Date(order.date_created).toLocaleDateString(locale)
            : "—"}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {dateRows.map((row) => (
          <div
            key={row.label}
            className="technician-order-date rounded-lg border px-2 py-1.5"
          >
            <dt className="technician-order-muted">{row.label}</dt>
            <dd className="technician-order-title mt-0.5 font-medium">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        className="technician-order-link mt-4 inline-flex rounded-lg px-3 py-2 text-sm"
        href={`/${locale}/technician/work-orders/${order._id}`}
      >
        {viewLabel}
      </Link>
    </article>
  );
}

function TechnicianWorkOrderCard({
  order,
  locale,
  description,
  automaticallyTranslated,
  onStart,
  onResume,
  actionBusy,
}: Readonly<{
  order: WorkOrder;
  locale: string;
  description: string;
  automaticallyTranslated: boolean;
  onStart: (id: string) => void;
  onResume: (id: string) => void;
  actionBusy: boolean;
}>) {
  const t = useTranslations("technician");
  const tEnums = useTranslations("common.enums");
  const priority = translateEnumValue(tEnums, "priorities", order.priorite) || t("notAvailable");
  const maintenanceType =
    translateEnumValue(tEnums, "maintenanceTypes", order.type_maintenance) ||
    order.type_maintenance ||
    t("notAvailable");
  const status = t.has(`status.${order.status}`)
    ? t(`status.${order.status}`)
    : translateEnumValue(tEnums, "workOrderStatuses", order.status);
  const overdue = isWorkOrderOverdue(order);
  const machineState = machineStatus(order);
  const canStart = ["assigned", "technician_required", "returned"].includes(order.status);
  const canResume = ["in_progress", "waiting_parts"].includes(order.status);
  const completed = isClosedStatus(order.status);

  return (
    <article
      className={`panel border-s-4 p-5 ${
        overdue
          ? "border-s-red-500 bg-red-50/40 dark:bg-red-950/20"
          : order.priorite?.toLowerCase() === "urgent"
            ? "border-s-red-500"
            : order.priorite?.toLowerCase() === "high"
              ? "border-s-orange-500"
              : "border-s-blue-500"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-slate-950 dark:text-slate-100">{order.ot_id}</h3>
          <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">
            {machineName(order) || t("notAvailable")}
          </p>
          <p className="text-sm text-slate-500">{machineModel(order) || t("notAvailable")}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${priorityBadgeClass(order.priorite)}`}>
          {priority}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${maintenanceBadgeClass(order.type_maintenance)}`}>
          {maintenanceType}
        </span>
        {overdue ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold uppercase text-red-700">
            <ExclamationTriangleIcon className="h-3.5 w-3.5" />
            {t("badges.overdue")}
          </span>
        ) : null}
        {machineState ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            {t("machine.status")}: {translateEnumValue(tEnums, "machineStates", machineState) || machineState}
          </span>
        ) : null}
      </div>

      <p className="mt-4 line-clamp-3 text-sm text-slate-700 dark:text-slate-200">
        {description || t("notAvailable")}
        {automaticallyTranslated ? (
          <span className="ms-1 text-xs text-amber-700" title={t("dynamicTranslations.safetyNotice")}>
            {t("dynamicTranslations.auto")}
          </span>
        ) : null}
      </p>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline text-slate-500">{t("fields.due")}:</dt>{" "}
          <dd className="inline font-medium">
            {formatDueLabel(order, locale, t("dates.today"), t("dates.tomorrow"))}
          </dd>
        </div>
        <div>
          <dt className="inline text-slate-500">{t("filters.status")}:</dt>{" "}
          <dd className="inline font-medium">{status}</dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Link
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:border-blue-400 dark:text-slate-100"
          href={`/${locale}/technician/work-orders/${order._id}`}
        >
          <EyeIcon className="h-4 w-4 text-blue-600" />
          {completed ? t("actions.viewReport") : t("actions.viewDetails")}
        </Link>
        {canStart ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={actionBusy}
            onClick={() => onStart(order._id)}
          >
            <PlayIcon className="h-4 w-4" />
            {actionBusy ? t("loading") : t("actions.start")}
          </button>
        ) : null}
        {order.status === "waiting_parts" ? (
          <Link
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:border-amber-500"
            href={`/${locale}/technician/work-orders/${order._id}`}
          >
            <ClockIcon className="h-4 w-4" />
            {t("actions.viewPartsRequest")}
          </Link>
        ) : null}
        {canResume ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={actionBusy}
            onClick={() => onResume(order._id)}
          >
            <WrenchScrewdriverIcon className="h-4 w-4" />
            {actionBusy ? t("loading") : t("actions.continueIntervention")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function TechnicianDashboard() {
  const t = useTranslations("technician");
  const tEnums = useTranslations("common.enums");
  const locale = useLocale();
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [startingId, setStartingId] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData((await apiService.getTechnicianDashboard()).data);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  const handleStart = useCallback(
    async (orderId: string) => {
      try {
        setActionError("");
        setStartingId(orderId);
        await apiService.startTechnicianWorkOrder(orderId);
        await load();
      } catch {
        setActionError(t("errors.update"));
      } finally {
        setStartingId("");
      }
    },
    [load, t],
  );
  const priorityOrders = useMemo(
    () =>
      uniqueOrders([...(data?.urgentTasks ?? []), ...(data?.current ?? [])])
        .sort(compareTechnicianPriorityOrders)
        .slice(0, 3),
    [data],
  );
  const upcomingOrders = useMemo(
    () =>
      uniqueOrders([
        ...(data?.upcoming ?? []),
        ...(data?.current ?? []),
        ...(data?.waitingPartsTasks ?? []),
      ])
        .filter((order) => !priorityOrders.some((priority) => priority._id === order._id))
        .sort((a, b) => dueDateValue(a) - dueDateValue(b))
        .slice(0, 4),
    [data, priorityOrders],
  );
  const visibleWorkOrders = useMemo(
    () =>
      data
        ? [
            ...data.urgentTasks,
            ...data.current,
            ...data.waitingPartsTasks,
            ...(data.upcoming ?? []),
            ...data.recent,
          ]
        : [],
    [data],
  );
  const dynamicTranslations = useWorkOrderDynamicTranslations(
    visibleWorkOrders,
    locale,
  );
  const summaryCards: DashboardSummaryCard[] = [
    {
      key: "assigned",
      labelKey: "workOrderTabs.assigned",
      href: `/${locale}/technician/work-orders?status=assigned`,
      accentClass: "border-s-4 border-blue-500 bg-blue-50/60 dark:bg-blue-950/20",
      valueClass: "text-blue-700 dark:text-blue-300",
      Icon: ClipboardDocumentListIcon,
    },
    {
      key: "inProgress",
      labelKey: "workOrderTabs.inProgress",
      href: `/${locale}/technician/work-orders?status=in_progress`,
      accentClass: "border-s-4 border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20",
      valueClass: "text-emerald-700 dark:text-emerald-300",
      Icon: WrenchScrewdriverIcon,
    },
    {
      key: "waitingParts",
      labelKey: "workOrderTabs.waitingParts",
      href: `/${locale}/technician/work-orders?status=waiting_parts`,
      accentClass: "border-s-4 border-amber-500 bg-amber-50/60 dark:bg-amber-950/20",
      valueClass: "text-amber-700 dark:text-amber-300",
      Icon: ClockIcon,
    },
    {
      key: "urgent",
      labelKey: "dashboard.cards.urgent",
      href: `/${locale}/technician/work-orders?priority=URGENT`,
      accentClass: "border-s-4 border-red-500 bg-red-50/60 dark:bg-red-950/20",
      valueClass: "text-red-700 dark:text-red-300",
      Icon: ExclamationTriangleIcon,
    },
  ];
  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={t("dashboard.title")}>
        {loading && (
          <div className="panel">{t("loading")}</div>
        )}
        {!loading && error && (
          <ErrorBox
            message={error}
            retry={() => void load()}
            label={t("actions.retry")}
          />
        )}
        {!loading && !error && (
          data && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {summaryCards.map(({ key, labelKey, href, accentClass, valueClass, Icon }) => (
                  <Link
                    className={`panel block p-4 text-center no-underline transition hover:border-blue-300 hover:shadow-sm ${accentClass}`}
                    href={href}
                    key={key}
                  >
                    <p className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      <Icon className={`h-5 w-5 ${valueClass}`} />
                      <span>{t(labelKey)}</span>
                    </p>
                    <p className={`mt-1 text-3xl font-bold leading-none ${valueClass}`}>
                      {data.counters[key] || 0}
                    </p>
                  </Link>
                ))}
              </div>

              <section className="panel">
                <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-300 pb-3">
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-900">
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
                    {t("dashboard.sections.todaysPriority")}
                  </h2>
                  <div className="flex items-center gap-3">
                    {dynamicTranslations.hasTranslationLocale ? (
                      <button
                        type="button"
                        className="text-sm text-amber-700"
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
                    ) : null}
                    <Link
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700"
                      href={`/${locale}/technician/work-orders`}
                    >
                      <EyeIcon className="h-4 w-4" />
                      {t("actions.viewAll")}
                    </Link>
                  </div>
                </div>
                {actionError ? (
                  <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {actionError}
                  </p>
                ) : null}
                {priorityOrders.length ? (
                  <div className="divide-y">
                    {priorityOrders.map((order) => {
                      const priority = translateEnumValue(tEnums, "priorities", order.priorite) || t("notAvailable");
                      const description = dynamicTranslations.textFor(order._id, "description", order.description);
                      const canStart = ["assigned", "technician_required", "returned"].includes(order.status);
                      return (
                        <article className="py-4 first:pt-0 last:pb-0" key={order._id}>
                          <div
                            className={`flex flex-col gap-3 border-s-4 px-3 lg:flex-row lg:items-start lg:justify-between ${
                              order.priorite?.toLowerCase() === "urgent"
                                ? "border-s-red-500"
                                : "border-s-amber-500"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                    order.priorite?.toLowerCase() === "urgent"
                                      ? "bg-red-600"
                                      : "bg-orange-500"
                                  }`}
                                  aria-hidden="true"
                                />
                                <h3 className="font-semibold text-slate-950">{order.ot_id}</h3>
                              </div>
                              <dl className="mt-2 grid gap-1 text-sm text-slate-700 md:grid-cols-2">
                                <div>
                                  <dt className="inline font-medium">{t("machine.title")}:</dt>{" "}
                                  <dd className="inline">{machineName(order) || t("notAvailable")}</dd>
                                </div>
                                <div>
                                  <dt className="inline font-medium">{t("fields.priority")}:</dt>{" "}
                                  <dd className="inline">{priority}</dd>
                                </div>
                                <div>
                                  <dt className="inline font-medium">{t("fields.due")}:</dt>{" "}
                                  <dd className="inline">
                                    {formatDueLabel(order, locale, t("dates.today"), t("dates.tomorrow"))}
                                  </dd>
                                </div>
                              </dl>
                              <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                                {description ||
                                  translateEnumValue(tEnums, "maintenanceTypes", order.type_maintenance) ||
                                  t("notAvailable")}
                                {dynamicTranslations.isAutomaticallyTranslated(order._id, "description") ? (
                                  <span className="ms-1 text-xs text-amber-700">
                                    {t("dynamicTranslations.auto")}
                                  </span>
                                ) : null}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Link
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:border-blue-400"
                                href={`/${locale}/technician/work-orders/${order._id}`}
                              >
                                <EyeIcon className="h-4 w-4 text-blue-600" />
                                {t("actions.viewWorkOrder")}
                              </Link>
                              {canStart ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                                  disabled={startingId === order._id}
                                  onClick={() => void handleStart(order._id)}
                                >
                                  <PlayIcon className="h-4 w-4" />
                                  {startingId === order._id ? t("loading") : t("actions.start")}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm text-slate-500 dark:bg-slate-900/20">
                    <div className="flex items-center gap-2 font-semibold text-slate-600">
                      <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
                      {t("placeholders.workOrder")}
                    </div>
                    <div className="mt-2">{t("placeholders.machine")}</div>
                    <div>{t("fields.priority")}: {t("placeholders.priority")}</div>
                    <div>{t("fields.due")}: {t("placeholders.due")}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2">
                        <EyeIcon className="h-4 w-4 text-blue-600" />
                        {t("actions.viewWorkOrder")}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-slate-600">
                        <PlayIcon className="h-4 w-4" />
                        {t("actions.start")}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="mb-3 border-b border-slate-300 pb-3">
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-900">
                    <ClockIcon className="h-5 w-5 text-amber-600" />
                    {t("dashboard.sections.upcomingWork")}
                  </h2>
                </div>
                {upcomingOrders.length ? (
                  <div className="space-y-3">
                    {upcomingOrders.map((order) => (
                      <Link
                        className="block rounded-lg border border-slate-200 border-s-4 border-s-amber-500 bg-amber-50/40 p-3 text-sm hover:border-blue-300 dark:bg-amber-950/20"
                        href={`/${locale}/technician/work-orders/${order._id}`}
                        key={order._id}
                      >
                        <div className="flex items-center gap-2 font-semibold text-slate-950">
                          <ClipboardDocumentListIcon className="h-4 w-4 text-amber-700" />
                          {order.ot_id}
                        </div>
                        <div className="mt-1 text-slate-600">
                          {t("machine.title")}: {machineName(order) || t("notAvailable")}
                        </div>
                        <div className="mt-1 text-slate-500">
                          {t("fields.due")}: {formatDueLabel(order, locale, t("dates.today"), t("dates.tomorrow"))}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 text-sm text-slate-500">
                    {[0, 1].map((item) => (
                      <div
                        className="rounded-lg border border-dashed border-slate-300 border-s-4 border-s-amber-400 bg-amber-50/30 p-3 dark:bg-amber-950/20"
                        key={item}
                      >
                        <div className="flex items-center gap-2 font-semibold text-slate-600">
                          <ClipboardDocumentListIcon className="h-4 w-4 text-amber-700" />
                          {t("placeholders.workOrder")}
                        </div>
                        <div className="mt-1">{t("placeholders.machine")}</div>
                        <div>{t("placeholders.due")}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="mb-3 border-b border-slate-300 pb-3">
                  <h2 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-900">
                    <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                    {t("dashboard.sections.recentlyCompleted")}
                  </h2>
                </div>
                {data.recent.length ? (
                  <div className="divide-y text-sm">
                    {data.recent.slice(0, 6).map((order) => (
                      <Link
                        className="grid gap-2 border-s-4 border-s-emerald-500 px-3 py-2 first:pt-0 last:pb-0 md:grid-cols-[1fr_1fr_auto]"
                        href={`/${locale}/technician/work-orders/${order._id}`}
                        key={order._id}
                      >
                        <span className="inline-flex items-center gap-2 font-medium text-slate-950">
                          <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
                          {order.ot_id}
                        </span>
                        <span className="text-slate-600">{machineName(order) || t("notAvailable")}</span>
                        <span className="text-slate-500">
                          {t.has(`status.${order.status}`)
                            ? t(`status.${order.status}`)
                            : translateEnumValue(tEnums, "workOrderStatuses", order.status)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y text-sm text-slate-500">
                    {[0, 1].map((item) => (
                      <div
                        className="grid gap-2 border-s-4 border-s-emerald-400 px-3 py-2 first:pt-0 last:pb-0 md:grid-cols-[1fr_1fr_auto]"
                        key={item}
                      >
                        <span className="inline-flex items-center gap-2 font-medium text-slate-600">
                          <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
                          {t("placeholders.workOrder")}
                        </span>
                        <span>{t("placeholders.machineShort")}</span>
                        <span>{t("status.completed")}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export function TechnicianOrders({ fixedStatus }: Readonly<{ fixedStatus?: string }>) {
  const t = useTranslations("technician");
  const tEnums = useTranslations("common.enums");
  const locale = useLocale();
  const [data, setData] = useState<PageData<WorkOrder>>();
  const [tabCounts, setTabCounts] = useState<Record<WorkOrderTab["key"], number>>({
    all: 0,
    assigned: 0,
    inProgress: 0,
    waitingParts: 0,
    completed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyOrderId, setBusyOrderId] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(() => initialWorkOrderFilters(fixedStatus));
  const dueDateRange = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const week = new Date(today);
    week.setDate(today.getDate() + 7);
    const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

    if (filters.dueDate === "overdue") {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return { dateTo: toIsoDate(yesterday) };
    }
    if (filters.dueDate === "today") {
      return { dateFrom: toIsoDate(today), dateTo: toIsoDate(today) };
    }
    if (filters.dueDate === "week") {
      return { dateFrom: toIsoDate(tomorrow), dateTo: toIsoDate(week) };
    }
    return {
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    };
  }, [filters.dateFrom, filters.dateTo, filters.dueDate]);
  const countFilters = useMemo(
    () => ({
      search: filters.search.trim() || undefined,
      maintenanceType: filters.maintenanceType || undefined,
      priority: filters.priority || undefined,
      machineId: filters.machineId || undefined,
      ...dueDateRange,
    }),
    [dueDateRange, filters.machineId, filters.maintenanceType, filters.priority, filters.search],
  );
  const query = useMemo(
    () => ({
      page,
      limit: TECHNICIAN_PAGE_SIZE,
      ...countFilters,
      status: fixedStatus || filters.status || undefined,
    }),
    [page, countFilters, filters.status, fixedStatus],
  );
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData((await apiService.getTechnicianWorkOrders(query)).data);
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [query, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const handleStart = useCallback(
    async (orderId: string) => {
      try {
        setActionError("");
        setBusyOrderId(orderId);
        await apiService.startTechnicianWorkOrder(orderId);
        await load();
      } catch {
        setActionError(t("errors.update"));
      } finally {
        setBusyOrderId("");
      }
    },
    [load, t],
  );
  const handleResume = useCallback(
    async (orderId: string) => {
      try {
        setActionError("");
        setBusyOrderId(orderId);
        await apiService.resumeTechnicianWorkOrder(orderId);
        await load();
      } catch {
        setActionError(t("errors.update"));
      } finally {
        setBusyOrderId("");
      }
    },
    [load, t],
  );
  useEffect(() => {
    if (fixedStatus) return;

    let active = true;
    async function loadTabCounts() {
      const results = await Promise.all(
        TECHNICIAN_WORK_ORDER_TABS.map(async (tab) => {
          const response = await apiService.getTechnicianWorkOrders({
            page: 1,
            limit: 1,
            ...countFilters,
            status: tab.status || undefined,
          });
          return [tab.key, Number(response.data?.totalItems) || 0] as const;
        }),
      );
      if (active) {
        setTabCounts(Object.fromEntries(results) as Record<WorkOrderTab["key"], number>);
      }
    }

    void loadTabCounts().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [countFilters, fixedStatus]);
  const dynamicTranslations = useWorkOrderDynamicTranslations(
    data?.items ?? [],
    locale,
  );
  const machineOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const order of data?.items ?? []) {
      const value = machineOptionValue(order);
      const label = machineFilterLabel(order);
      if (value && label) options.set(value, label);
    }
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [data]);
  const activeTabKey =
    TECHNICIAN_WORK_ORDER_TABS.find((tab) => (tab.status || "") === filters.status)?.key ?? "all";
  const emptyMessageKey =
    activeTabKey === "waitingParts"
      ? "waitingParts"
      : activeTabKey === "completed"
        ? "completed"
        : "workOrders";
  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={t("workOrders.myTitle")}>
        <div className="space-y-5">
          {!fixedStatus && (
            <div className="panel space-y-4">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("filters.status")}>
                {TECHNICIAN_WORK_ORDER_TABS.map((tab) => {
                  const selected = filters.status === (tab.status || "");
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        selected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"
                      }`}
                      onClick={() => {
                        setPage(1);
                        setFilters({ ...filters, status: tab.status || "" });
                      }}
                    >
                      <span>{t(`workOrderTabs.${tab.key}`)}</span>
                      <span className={`ms-2 rounded-full px-2 py-0.5 text-xs ${
                        selected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"
                      }`}>
                        {tabCounts[tab.key]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <label className="relative block">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  aria-label={t("filters.search")}
                  className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3"
                  placeholder={t("filters.searchPlaceholder")}
                  value={filters.search}
                  onChange={(event) => {
                    setPage(1);
                    setFilters({ ...filters, search: event.target.value });
                  }}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-4">
              <select
                aria-label={t("filters.priority")}
                value={filters.priority}
                onChange={(e) => {
                  setPage(1);
                  setFilters({ ...filters, priority: e.target.value });
                }}
              >
                <option value="">{t("filters.allPriorities")}</option>
                <option value="URGENT">{t("priority.urgent")}</option>
                <option value="high">{t("priority.high")}</option>
                <option value="medium">{t("priority.medium")}</option>
                <option value="low">{t("priority.low")}</option>
              </select>
              <select
                aria-label={t("filters.machine")}
                value={filters.machineId}
                onChange={(e) => {
                  setPage(1);
                  setFilters({ ...filters, machineId: e.target.value });
                }}
              >
                <option value="">{t("filters.allMachines")}</option>
                {machineOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("filters.maintenanceType")}
                value={filters.maintenanceType}
                onChange={(e) => {
                  setPage(1);
                  setFilters({ ...filters, maintenanceType: e.target.value });
                }}
              >
                <option value="">{t("filters.allTypes")}</option>
                <option value="preventive">{t("types.preventive")}</option>
                <option value="corrective">{t("types.corrective")}</option>
              </select>
              <select
                aria-label={t("filters.dueDate")}
                value={filters.dueDate}
                onChange={(e) => {
                  setPage(1);
                  setFilters({ ...filters, dueDate: e.target.value });
                }}
              >
                <option value="">{t("filters.anyDueDate")}</option>
                <option value="overdue">{t("badges.overdue")}</option>
                <option value="today">{t("dates.today")}</option>
                <option value="week">{t("dates.next7Days")}</option>
              </select>
              </div>
            </div>
          )}
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
          {loading && (
            <div className="panel">{t("loading")}</div>
          )}
          {!loading && error && (
            <ErrorBox
              message={error}
              retry={() => void load()}
              label={t("actions.retry")}
            />
          )}
          {!loading && !error && actionError ? (
            <div className="panel border border-red-200 bg-red-50 text-sm text-red-700">
              {actionError}
            </div>
          ) : null}
          {!loading && !error && data?.items.length ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.items.map((item) => (
                  <TechnicianWorkOrderCard
                    key={item._id}
                    order={item}
                    locale={locale}
                    description={dynamicTranslations.textFor(
                      item._id,
                      "description",
                      item.description,
                    )}
                    automaticallyTranslated={dynamicTranslations.isAutomaticallyTranslated(
                      item._id,
                      "description",
                    )}
                    onStart={handleStart}
                    onResume={handleResume}
                    actionBusy={busyOrderId === item._id}
                  />
                ))}
              </div>
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                totalItems={data.totalItems}
                limit={TECHNICIAN_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          ) : null}
          {!loading && !error && !data?.items.length && (
            <div className="panel border-s-4 border-s-emerald-500 bg-emerald-50/40 text-slate-600">
              <CheckCircleIcon className="mb-3 h-6 w-6 text-emerald-600" />
              {t(`empty.${emptyMessageKey}`)}
            </div>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export function TechnicianManuals() {
  const t = useTranslations("technician");
  const [data, setData] = useState<PageData<Manual>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewManual, setPreviewManual] = useState<Manual>();
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData(
        (await apiService.getTechnicianManuals({ page: 1, limit: 100 })).data,
      );
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={t("manuals.title")}>
        {loading && (
          <div className="panel">{t("loading")}</div>
        )}
        {!loading && error && (
          <ErrorBox
            message={error}
            retry={() => void load()}
            label={t("actions.retry")}
          />
        )}
        {!loading && !error && data?.items.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((doc) => (
              <article className="panel" key={doc._id}>
                <h2 className="font-semibold">{doc.file_name}</h2>
                <p className="text-sm text-slate-500">
                  {doc.type_document} ·{" "}
                  {doc.machine_id?.machine_id || t("notAvailable")}
                </p>
                <p className="my-3 text-sm">
                  {doc.description || t("notAvailable")}
                </p>
                <button
                  type="button"
                  className="inline-flex rounded-lg bg-blue-700 px-3 py-2 text-white"
                  onClick={() => setPreviewManual(doc)}
                >
                  {t("actions.openManual")}
                </button>
              </article>
            ))}
          </div>
        ) : null}
        {!loading && !error && !data?.items.length && (
          <div className="panel">{t("empty.manuals")}</div>
        )}
        <ManualPreviewModal
          manual={previewManual}
          onClose={() => setPreviewManual(undefined)}
          title={t("actions.openManual")}
        />
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export function TechnicianParts() {
  const t = useTranslations("technician");
  const [data, setData] = useState<PageData<StockPart>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      setData(
        (await apiService.getTechnicianParts({
          page,
          limit: TECHNICIAN_PAGE_SIZE,
        })).data,
      );
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  }, [page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={t("parts.title")}>
        <div className="space-y-5">
          {loading && (
            <div className="panel">{t("loading")}</div>
          )}
          {!loading && error && (
            <ErrorBox
              message={error}
              retry={() => void load()}
              label={t("actions.retry")}
            />
          )}
          {!loading && !error && data?.items.length ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.items.map((item) => (
                  <article className="panel" key={item._id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">
                          {partName(item.part_id, t("notAvailable"))}
                        </h2>
                        <p className="text-sm text-slate-500">
                          {item.stock_id}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                        {availableQuantity(item)}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg border px-3 py-2">
                        <dt className="text-slate-500">{t("parts.stock")}</dt>
                        <dd className="mt-1 font-medium">
                          {item.quantite_en_stock ?? 0}
                        </dd>
                      </div>
                      <div className="rounded-lg border px-3 py-2">
                        <dt className="text-slate-500">{t("parts.reserved")}</dt>
                        <dd className="mt-1 font-medium">
                          {item.quantite_reservee ?? 0}
                        </dd>
                      </div>
                      <div className="rounded-lg border px-3 py-2">
                        <dt className="text-slate-500">{t("parts.minimum")}</dt>
                        <dd className="mt-1 font-medium">
                          {item.quantite_minimale ?? item.seuil_alerte_stock ?? 0}
                        </dd>
                      </div>
                      <div className="rounded-lg border px-3 py-2">
                        <dt className="text-slate-500">{t("parts.location")}</dt>
                        <dd className="mt-1 font-medium">
                          {item.emplacement || t("notAvailable")}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                totalItems={data.totalItems}
                limit={TECHNICIAN_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          ) : null}
          {!loading && !error && !data?.items.length && (
            <div className="panel">{t("empty.parts")}</div>
          )}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export { terminal, review };
