import { useTranslations } from "next-intl";

interface SuccessProps {
  planName: string;
  machineName: string;
  machineCode: string;
  completedAt: string;
  okCount: number;
  problemCount: number;
  workOrderOtId: string;
  onViewResults?: () => void;
  onBack: () => void;
}

export function InspectionSuccess({
  planName,
  machineName,
  machineCode,
  completedAt,
  okCount,
  problemCount,
  workOrderOtId,
  onViewResults,
  onBack,
}: Readonly<SuccessProps>) {
  const t = useTranslations("dashboard.operator.preventiveTasksFlow");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-3xl font-bold text-emerald-700">✓</div>
        <h2 className="mt-2 text-xl font-semibold text-emerald-900">{t("successTitle")}</h2>
        <p className="mt-1 text-sm text-emerald-800">{t("successMessage")}</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">{t("machineLabel")}</div>
            <div className="mt-1 text-base font-semibold text-slate-900">
              {machineName} {machineCode && <span className="text-slate-500">{machineCode}</span>}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">{t("taskLabel")}</div>
            <div className="mt-1 text-base font-semibold text-slate-900">{planName}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">{t("completedAtLabel")}</div>
            <div className="mt-1 text-base font-semibold text-slate-900">{completedAt}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">{t("checksLabel")}</div>
            <div className="mt-1 text-base font-semibold text-slate-900">{okCount + problemCount}</div>
          </div>
        </div>

        <div className="flex gap-4 text-sm">
          <span className="font-semibold text-emerald-700">{t("okLabel")}: {okCount}</span>
          <span className="font-semibold text-amber-700">{t("problemLabel")}: {problemCount}</span>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase text-slate-500">{t("reference")}</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{workOrderOtId}</div>
        </div>
      </div>

      <div className="flex gap-3">
        {onViewResults && (
          <button
            type="button"
            onClick={onViewResults}
            className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            {t("viewResults")}
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t("backToTasks")}
        </button>
      </div>
    </div>
  );
}
