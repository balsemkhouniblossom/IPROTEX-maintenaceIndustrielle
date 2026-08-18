import { useTranslations } from "next-intl";
import { GeneratedReportRow } from "../types.ts";

export function PreventiveReportsSection({
  reports,
  onSelectReport,
  formatReportDate,
  formatReportStatus,
  reportStatusClasses,
  t,
  tCommon,
}: Readonly<{
  reports: GeneratedReportRow[];
  onSelectReport: (report: GeneratedReportRow) => void;
  formatReportDate: (value?: string) => string;
  formatReportStatus: (status: string) => string;
  reportStatusClasses: (status: string) => string;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}>) {
  return (
    <div className="col-span-full panel">
      <div className="card-title mb-3">{t("myReports")}</div>
      {reports.length === 0 ? (
        <div className="text-sm text-slate-500">{tCommon("table.noData")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {reports.map((item, index) => (
            <article key={item.id} className="w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-slate-900">{item.machine || tCommon("notAvailable")}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    <span>{t("preventive")}</span>
                    <span aria-hidden="true">|</span>
                    <span>{formatReportDate(item.createdAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${reportStatusClasses(item.status)}`}>
                    {formatReportStatus(item.status)}
                  </span>
                  <button
                    type="button"
                    data-testid={`preventive-report-details-${index}`}
                    onClick={() => onSelectReport(item)}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    {t("smartCalendar.maintenanceDetails")}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
