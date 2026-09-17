"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import DashboardLayout from "@/components/DashboardLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { apiService } from "@/services/api";

type Ref = string | { _id: string; ot_id?: string; nom_complet?: string };
type Report = {
  report_id: string; ot_id: Ref; technician_id: Ref;
  date_debut?: string; date_fin?: string; cause_racine?: string;
  description_action?: string; etat_final?: string; validation_responsable?: string;
};

export default function AdminInterventionReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const t = useTranslations("interventionReports");
  const tCommon = useTranslations("common");
  const tWorkOrders = useTranslations("workOrders");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const response = await apiService.getInterventionReport(id);
      setReport(response.data as Report);
    } catch { setError(true); setReport(null); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const date = (value?: string) => value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value)) : "—";
  const orderId = typeof report?.ot_id === "object" ? report.ot_id._id : report?.ot_id;
  const orderLabel = typeof report?.ot_id === "object" ? report.ot_id.ot_id || "—" : "—";
  const technicianLabel = typeof report?.technician_id === "object" ? report.technician_id.nom_complet || "—" : "—";
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <DashboardLayout title={t("title")}>
        <div className="space-y-4">
          {orderId && <Link className="text-blue-700 underline" href={`/${locale}/work-orders/${orderId}`}>{tWorkOrders("detail.backToWorkOrder")}</Link>}
          {loading ? <output className="panel">{tCommon("loading")}</output> : null}
          {error ? <div role="alert" className="panel"><p>{tCommon("error")}</p><button type="button" className="btn-secondary mt-3" onClick={() => void load()}>{tCommon("retry")}</button></div> : null}
          {!loading && !error && report ? <>
            <header className="panel"><p className="text-sm text-slate-600">{t("title")}</p><h1 className="text-2xl font-bold">{report.report_id}</h1></header>
            <dl className="panel grid gap-4 sm:grid-cols-2">
              {[[t("table.workOrder"), orderLabel], [t("table.technician"), technicianLabel], [t("table.startDate"), date(report.date_debut)], [t("table.endDate"), date(report.date_fin)], [t("form.rootCause"), report.cause_racine || "—"], [t("form.actionDescription"), report.description_action || "—"], [t("table.finalState"), report.etat_final || "—"], [t("form.responsibleValidation"), report.validation_responsable || "—"]].map(([label, value]) => <div key={label}><dt className="font-semibold text-slate-600">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}
            </dl>
          </> : null}
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}
