"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { Modal } from "@/components/Modal";
import Pagination from "@/components/Pagination";
import DocumentAttachmentViewer from "@/components/DocumentAttachmentViewer";
import { apiService } from "@/services/api";

type WorkOrder = {
  _id: string;
  ot_id: string;
  status: string;
  priorite?: string;
  type_maintenance?: string;
  description?: string;
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
        model?: string;
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

const terminal = new Set(["completed", "validated", "cancelled", "canceled"]);
const review = new Set([
  "waiting_validation",
  "technician_required",
  "returned",
]);
const TECHNICIAN_PAGE_SIZE = 20;

function manualTypeLabel(manual: Manual): string | undefined {
  const type = manual.machine_id?.type_id;
  return type && typeof type === "object" ? type.name : undefined;
}

function ManualPreviewModal({
  manual,
  onClose,
  title,
}: {
  manual?: Manual;
  onClose: () => void;
  title: string;
}) {
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
  return machine.machine_id || machine.model || undefined;
}

function formatOrderDate(value: string | undefined, locale: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(locale);
}

function ErrorBox({
  message,
  retry,
  label,
}: {
  message: string;
  retry: () => void;
  label: string;
}) {
  return (
    <div className="panel border border-red-200 bg-red-50 text-red-800">
      <p>{message}</p>
      <button
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
}: {
  order: WorkOrder;
  locale: string;
  viewLabel: string;
}) {
  const t = useTranslations("technician");
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
          {t.has(statusKey) ? t(statusKey) : order.status}
        </span>
      </div>
      <p className="technician-order-description mt-3 line-clamp-2 text-sm">
        {order.description || t("notAvailable")}
      </p>
      <p className="technician-order-text mt-2 text-sm">
        <span className="font-medium">{t("operator")}:</span>{" "}
        {order.operator?.nom_complet || t("notAvailable")}
      </p>
      <div className="technician-order-muted mt-3 flex flex-wrap gap-2 text-xs [&>span:nth-child(n+4)]:hidden">
        <span>{order.type_maintenance || "—"}</span>
        <span>•</span>
        <span>{order.priorite || "—"}</span>
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

export function TechnicianDashboard() {
  const t = useTranslations("technician");
  const locale = useLocale();
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [previewManual, setPreviewManual] = useState<Manual>();
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
  const cards = [
    "assigned",
    "inProgress",
    "waitingParts",
    "waitingReview",
    "completedToday",
    "urgent",
  ];
  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={t("dashboard.title")}>
        {loading ? (
          <div className="panel">{t("loading")}</div>
        ) : error ? (
          <ErrorBox
            message={error}
            retry={() => void load()}
            label={t("actions.retry")}
          />
        ) : (
          data && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {cards.map((key) => (
                  <div className="panel" key={key}>
                    <p className="text-sm text-slate-500">
                      {t(`dashboard.cards.${key}`)}
                    </p>
                    <p className="mt-2 text-3xl font-bold">
                      {data.counters[key] || 0}
                    </p>
                  </div>
                ))}
              </div>
              {(
                [
                  ["urgentTasks", data.urgentTasks],
                  ["current", data.current],
                  ["waitingPartsTasks", data.waitingPartsTasks],
                  ["recent", data.recent],
                ] as const
              ).map(([key, items]) => (
                <section className="panel" key={key}>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">
                      {t(`dashboard.sections.${key}`)}
                    </h2>
                    <Link
                      className="text-sm text-blue-700"
                      href={`/${locale}/technician/work-orders`}
                    >
                      {t("actions.viewAll")}
                    </Link>
                  </div>
                  {items.length ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {items.map((item) => (
                        <OrderCard
                          key={item._id}
                          order={item}
                          locale={locale}
                          viewLabel={t("actions.viewDetails")}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {t("empty.workOrders")}
                    </p>
                  )}
                </section>
              ))}
              <section className="panel">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">
                    {t("manuals.title")}
                  </h2>
                  <Link
                    className="text-sm text-blue-700"
                    href={`/${locale}/technician/manuals`}
                  >
                    {t("actions.viewAll")}
                  </Link>
                </div>
                {data.manuals?.length ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {data.manuals.map((doc) => (
                      <button
                        key={doc._id}
                        type="button"
                        className="rounded-lg border p-3 text-left hover:border-blue-500"
                        onClick={() => setPreviewManual(doc)}
                      >
                        <span className="font-medium">{doc.file_name}</span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {manualTypeLabel(doc) ||
                            doc.machine_id?.machine_id ||
                            t("notAvailable")}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t("empty.manuals")}</p>
                )}
              </section>
              <ManualPreviewModal
                manual={previewManual}
                onClose={() => setPreviewManual(undefined)}
                title={t("actions.openManual")}
              />
            </div>
          )
        )}
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export function TechnicianOrders({ fixedStatus }: { fixedStatus?: string }) {
  const t = useTranslations("technician");
  const locale = useLocale();
  const [data, setData] = useState<PageData<WorkOrder>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    status: fixedStatus || "",
    maintenanceType: "",
    priority: "",
    dateFrom: "",
    dateTo: "",
  });
  const query = useMemo(
    () => ({
      page,
      limit: TECHNICIAN_PAGE_SIZE,
      ...filters,
      status: fixedStatus || filters.status || undefined,
    }),
    [page, filters, fixedStatus],
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
  return (
    <ProtectedRoute requiredRole="technician">
      <DashboardLayout title={t("workOrders.title")}>
        <div className="space-y-5">
          {!fixedStatus && (
            <div className="panel grid gap-3 md:grid-cols-5">
              <select
                aria-label={t("filters.status")}
                value={filters.status}
                onChange={(e) => {
                  setPage(1);
                  setFilters({ ...filters, status: e.target.value });
                }}
              >
                <option value="">{t("filters.allStatuses")}</option>
                {[
                  "waiting_validation",
                  "assigned",
                  "in_progress",
                  "waiting_parts",
                  "completed",
                  "returned",
                ].map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
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
              <input
                aria-label={t("filters.dateFrom")}
                type="date"
                value={filters.dateFrom}
                onChange={(e) =>
                  setFilters({ ...filters, dateFrom: e.target.value })
                }
              />
              <input
                aria-label={t("filters.dateTo")}
                type="date"
                value={filters.dateTo}
                onChange={(e) =>
                  setFilters({ ...filters, dateTo: e.target.value })
                }
              />
            </div>
          )}
          {loading ? (
            <div className="panel">{t("loading")}</div>
          ) : error ? (
            <ErrorBox
              message={error}
              retry={() => void load()}
              label={t("actions.retry")}
            />
          ) : data?.items.length ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.items.map((item) => (
                  <OrderCard
                    key={item._id}
                    order={item}
                    locale={locale}
                    viewLabel={t("actions.viewDetails")}
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
          ) : (
            <div className="panel text-slate-500">{t("empty.workOrders")}</div>
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
        {loading ? (
          <div className="panel">{t("loading")}</div>
        ) : error ? (
          <ErrorBox
            message={error}
            retry={() => void load()}
            label={t("actions.retry")}
          />
        ) : data?.items.length ? (
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
        ) : (
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

export { terminal, review };
