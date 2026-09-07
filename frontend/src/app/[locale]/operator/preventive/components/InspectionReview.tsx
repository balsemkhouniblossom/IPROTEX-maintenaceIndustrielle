import { useTranslations } from "next-intl";

interface ReviewProps {
  planName: string;
  machineName: string;
  machineCode: string;
  okCount: number;
  problemCount: number;
  problems: { itemId: string; instruction: string }[];
  observation: string;
  correctiveWo: string | null;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function InspectionReview({
  planName,
  machineName,
  machineCode,
  okCount,
  problemCount,
  problems,
  observation,
  correctiveWo,
  onBack,
  onSubmit,
  submitting,
}: Readonly<ReviewProps>) {
  const t = useTranslations("dashboard.operator.preventiveTasksFlow");

  return (
    <div className="mx-auto max-w-xl space-y-6">
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
            <div className="text-xs font-semibold uppercase text-slate-500">{t("checksLabel")}</div>
            <div className="mt-1 text-base font-semibold text-slate-900">{okCount + problemCount}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">{t("resultsLabel")}</div>
            <div className="mt-1 text-base font-semibold text-slate-900">
              {t("okLabel")}: {okCount} | {t("problemLabel")}: {problemCount}
            </div>
          </div>
        </div>

        {observation && (
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">{t("observationLabel")}</div>
            <div className="mt-1 text-sm text-slate-700">{observation}</div>
          </div>
        )}

        {correctiveWo && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-sm font-semibold text-blue-900">{t("problemReportedTitle")}</div>
            <div className="mt-1 text-sm text-blue-800">
              {t("reference")}: {correctiveWo}
            </div>
          </div>
        )}

        {problems.length > 0 && !correctiveWo && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-900">{t("problemsDetected")}</div>
            <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
              {problems.map((p) => (
                <li key={p.itemId}>{p.instruction}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t("back")}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? t("submitting") : t("completeInspection")}
        </button>
      </div>
    </div>
  );
}
