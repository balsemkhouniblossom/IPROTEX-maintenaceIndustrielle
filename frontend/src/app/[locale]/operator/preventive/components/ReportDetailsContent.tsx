import { useTranslations } from "next-intl";
import { GeneratedReportRow } from "../types.ts";

export function ReportDetailsContent({
  report,
  onClose,
  formatReportDate,
  formatReportStatus,
  reportStatusClasses,
  t,
  tCommon,
}: {
  report: GeneratedReportRow;
  onClose: () => void;
  formatReportDate: (value?: string) => string;
  formatReportStatus: (status: string) => string;
  reportStatusClasses: (status: string) => string;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="operator-dashboard-theme space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">{t("machine")}</div>
          <div className="mt-1 text-base font-semibold text-slate-900">
            {report.machine || tCommon("notAvailable")}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">{t("smartCalendar.maintenanceType")}</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{t("preventive")}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">{t("dashboard.submissionDate")}</div>
          <div className="mt-1 text-base font-semibold text-slate-900">
            {formatReportDate(report.createdAt)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">{t("validation")}</div>
          <div className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${reportStatusClasses(report.status)}`}>
            {formatReportStatus(report.status)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-700">{t("actionsPerformed")}</div>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
          {report.summary || tCommon("notAvailable")}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          {tCommon("close")}
        </button>
      </div>
    </div>
  );
}
