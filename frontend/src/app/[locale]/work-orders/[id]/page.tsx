"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { StatusBadge } from "@/components/StatusBadge";
import { apiService } from "@/services/api";
import { translateEnumValue } from "@/services/enumTranslations";

type Ref = string | { _id: string; machine_id?: string; module_id?: string; nom_complet?: string; plan_id?: string };
type WorkOrderDetail = {
  ot_id: string; description?: string; type_maintenance?: string; status: string; priorite?: string;
  machine_id?: Ref; module_id?: Ref; technician_id?: Ref | null; plan_id?: Ref | null;
  date_created?: string; scheduled_date?: string; date_start?: string; due_date?: string;
  date_end?: string; execution_date?: string; date_closed?: string;
};
type CalendarDetails = {
  spareParts?: Array<{ id: string; name: string; quantity: number }>;
  history?: Array<{ id: string; reportId: string; action?: string; status: string }>;
};

function refId(value?: Ref | null): string {
  return typeof value === "string" ? value : value?._id ?? "";
}

function refLabel(value: Ref | null | undefined, key: "machine_id" | "module_id" | "nom_complet" | "plan_id"): string {
  return typeof value === "object" && value ? value[key] || "—" : "—";
}

function renderParts(calendar: CalendarDetails | null, hasError: boolean, message: (key: string) => string) {
  if (hasError) return <p className="mt-3 text-sm text-amber-700" role="alert">{message("detail.relatedDataUnavailable")}</p>;
  if (!calendar?.spareParts?.length) return <p className="mt-3 text-sm text-slate-600">{message("detail.noParts")}</p>;
  return <ul className="mt-3 space-y-1 text-sm">{calendar.spareParts.map((part) => <li key={part.id}>{part.name} × {part.quantity}</li>)}</ul>;
}

function renderHistory(calendar: CalendarDetails | null, hasError: boolean, locale: string, message: (key: string) => string) {
  if (hasError) return <p className="mt-3 text-sm text-amber-700" role="alert">{message("detail.relatedDataUnavailable")}</p>;
  if (!calendar?.history?.length) return <p className="mt-3 text-sm text-slate-600">{message("detail.noReport")}</p>;
  return <ul className="mt-3 space-y-2 text-sm">{calendar.history.map((report) => <li key={report.id}><span className="font-medium">{report.reportId}</span> <span className="text-slate-600">{report.action || "—"}</span> <Link href={`/${locale}/intervention-reports/${report.id}`} className="ms-2 text-blue-700 underline">{message("detail.viewReport")}</Link></li>)}</ul>;
}

function relatedPlanLabel(planError: boolean, planCode: string, planId: string, message: (key: string) => string): string {
  if (planError) return message("detail.relatedDataUnavailable");
  if (planCode) return planCode;
  return planId ? "—" : message("detail.noPlan");
}

function WorkOrderDetailContent({
  order, calendar, calendarError, planCode, planError, planId, planHref, checklistHref, date, t, tEnums, locale,
}: Readonly<{
  order: WorkOrderDetail;
  calendar: CalendarDetails | null;
  calendarError: boolean;
  planCode: string;
  planError: boolean;
  planId: string;
  planHref: string;
  checklistHref: string;
  date: (value?: string) => string;
  t: ReturnType<typeof useTranslations>;
  tEnums: ReturnType<typeof useTranslations>;
  locale: string;
}>) {
  const technicianLabel = refLabel(order.technician_id, "nom_complet");
  const technicianDisplay = technicianLabel === "—" ? t("unassigned") : technicianLabel;
  const calendarParts = renderParts(calendar, calendarError, t);
  const calendarHistory = renderHistory(calendar, calendarError, locale, t);
  return (
    <>
      <header className="panel flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm text-slate-600">{t("title")}</p><h1 className="text-2xl font-bold">{order.ot_id}</h1></div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={translateEnumValue(tEnums, "workOrderStatuses", order.status)} colorClassName="bg-blue-100 text-blue-800 border-blue-200" />
          <StatusBadge label={translateEnumValue(tEnums, "priorities", order.priorite || "low")} colorClassName="bg-amber-100 text-amber-800 border-amber-200" />
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel"><h2 className="font-semibold">{t("detail.equipment")}</h2><dl className="mt-3 space-y-2 text-sm"><div><dt className="text-slate-500">{t("table.machine")}</dt><dd>{refLabel(order.machine_id, "machine_id")}</dd></div><div><dt className="text-slate-500">{t("detail.equipment")}</dt><dd>{refLabel(order.module_id, "module_id")}</dd></div></dl></section>
        <section className="panel"><h2 className="font-semibold">{t("detail.maintenance")}</h2><dl className="mt-3 space-y-2 text-sm"><div><dt className="text-slate-500">{t("filterMaintenanceType")}</dt><dd>{order.type_maintenance ? translateEnumValue(tEnums, "maintenanceTypes", order.type_maintenance) : "—"}</dd></div><div><dt className="text-slate-500">{t("table.description")}</dt><dd className="whitespace-pre-wrap break-words">{order.description || "—"}</dd></div><div><dt className="text-slate-500">{t("detail.relatedPlan")}</dt><dd>{relatedPlanLabel(planError, planCode, planId, t)}</dd></div></dl>{planId && <div className="mt-3 flex flex-wrap gap-2"><Link className="btn-secondary" href={planHref}>{t("detail.viewPlan")}</Link><Link className="btn-secondary" href={checklistHref}>{t("detail.viewChecklist")}</Link></div>}</section>
        <section className="panel"><h2 className="font-semibold">{t("detail.assignment")}</h2><p className="mt-3 text-sm">{technicianDisplay}</p></section>
        <section className="panel"><h2 className="font-semibold">{t("detail.schedule")}</h2><dl className="mt-3 grid grid-cols-2 gap-3 text-sm">{[[t("table.created"), order.date_created], [t("detail.scheduled"), order.scheduled_date], [t("detail.started"), order.date_start], [t("detail.due"), order.due_date || order.date_end], [t("detail.completed"), order.date_closed || order.execution_date]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd>{date(value)}</dd></div>)}</dl></section>
        <section className="panel"><h2 className="font-semibold">{t("detail.parts")}</h2>{calendarParts}</section>
        <section className="panel"><h2 className="font-semibold">{t("detail.result")}</h2>{calendarHistory}</section>
      </div>
    </>
  );
}
export default function AdminWorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const t = useTranslations("workOrders");
  const tCommon = useTranslations("common");
  const tEnums = useTranslations("common.enums");
  const [order, setOrder] = useState<WorkOrderDetail | null>(null);
  const [calendar, setCalendar] = useState<CalendarDetails | null>(null);
  const [calendarError, setCalendarError] = useState(false);
  const [planCode, setPlanCode] = useState("");
  const [planError, setPlanError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setCalendarError(false);
    setPlanError(false);
    try {
      const response = await apiService.getWorkOrder(id);
      const item = response.data as WorkOrderDetail | null;
      if (!item) throw new Error("Work Order not found");
      setOrder(item);
      const planId = refId(item.plan_id);
      const [calendarResult, planResult] = await Promise.allSettled([
        apiService.getCalendarEventDetails(id),
        planId ? apiService.getMaintenancePlan(planId) : Promise.resolve(null),
      ]);
      setCalendar(calendarResult.status === "fulfilled" ? calendarResult.value.data as CalendarDetails : null);
      setCalendarError(calendarResult.status === "rejected");
      setPlanCode(planResult.status === "fulfilled" && planResult.value ? String(planResult.value.data?.plan_id ?? "") : "");
      setPlanError(Boolean(planId && planResult.status === "rejected"));
    } catch {
      setError(true);
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const date = (value?: string) => value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value)) : "—";
  const planId = refId(order?.plan_id);
  const planHref = `/${locale}/maintenance-plans?planId=${encodeURIComponent(planId)}`;
  const checklistHref = `/${locale}/preventive-task-checklist?planId=${encodeURIComponent(planId)}&workOrderId=${encodeURIComponent(id)}`;

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <DashboardLayout title={t("title")}>
        <div className="w-full space-y-4">
          <Link href={`/${locale}/work-orders`} className="text-sm text-blue-700 underline">{t("detail.back")}</Link>
          {loading ? <output className="panel">{t("detail.loading")}</output> : null}
          {error ? <div className="panel" role="alert"><p>{t("detail.loadFailed")}</p><button type="button" className="btn-secondary mt-3" onClick={() => void load()}>{tCommon("retry")}</button></div> : null}
          {!loading && !error && order ? <WorkOrderDetailContent order={order} calendar={calendar} calendarError={calendarError} planCode={planCode} planError={planError} planId={planId} planHref={planHref} checklistHref={checklistHref} date={date} t={t} tEnums={tEnums} locale={locale} /> : null}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
