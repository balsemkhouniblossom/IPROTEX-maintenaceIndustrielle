import { useTranslations } from "next-intl";

interface InspectionViewProps {
  planName: string;
  machineName: string;
  machineCode: string;
  items: { _id: string; instruction: string }[];
  itemResults: Record<string, "ok" | "problem">;
  loading: boolean;
  onToggle: (itemId: string, result: "ok" | "problem") => void;
  onProblemClick: (itemId: string, instruction: string) => void;
  onSubmit: (observation?: string) => void;
  onBack: () => void;
  submitting: boolean;
  observation: string;
  onObservationChange: (value: string) => void;
  allAnswered: boolean;
  okCount: number;
  problemCount: number;
  readOnly?: boolean;
}

export function InspectionView({
  planName,
  machineName,
  machineCode,
  items,
  itemResults,
  loading,
  onToggle,
  onProblemClick,
  onSubmit,
  onBack,
  submitting,
  observation,
  onObservationChange,
  allAnswered,
  okCount,
  problemCount,
  readOnly = false,
}: InspectionViewProps) {
  const t = useTranslations("dashboard.operator.preventiveTasksFlow");

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
        <div className="text-sm text-slate-500">{t("loadingChecklist")}</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
        <div className="text-sm text-slate-500">{t("noChecks")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <div>
          <div className="text-base font-semibold text-blue-900">
            {planName} — {machineName} {machineCode && <span className="text-blue-700">{machineCode}</span>}
          </div>
          <div className="mt-1 text-sm text-blue-700">
            {t("progress")}: {okCount + problemCount} / {items.length} {t("checksCompleted")}
          </div>
        </div>
        <div className="flex gap-3 text-sm">
          <span className="font-semibold text-emerald-700">{okCount} {t("okLabel")}</span>
          <span className="font-semibold text-amber-700">{problemCount} {t("problemLabel")}</span>
        </div>
      </div>

      {!allAnswered && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {t("completeRemaining")}
        </div>
      )}

      <div className="space-y-4">
        {items.map((item, index) => {
          const result = itemResults[item._id];
          return (
            <div
              key={item._id}
              className={`rounded-2xl border p-5 ${
                result === "ok"
                  ? "border-emerald-200 bg-emerald-50"
                  : result === "problem"
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-900">
                    {index + 1}. {item.instruction}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onToggle(item._id, "ok")}
                    disabled={readOnly}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      result === "ok"
                        ? "bg-emerald-600 text-white"
                        : "border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
                    }`}
                  >
                    ✓ OK
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggle(item._id, "problem")}
                    disabled={readOnly}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      result === "problem"
                        ? "bg-amber-600 text-white"
                        : "border border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
                    }`}
                  >
                    ⚠ Problem
                  </button>
                </div>
              </div>
              {result === "problem" && !readOnly && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => onProblemClick(item._id, item.instruction)}
                    className="text-sm font-semibold text-red-700 underline hover:text-red-900"
                  >
                    {t("reportThisProblem")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">{t("observationLabel")}</label>
        <textarea
          value={observation}
          onChange={(e) => onObservationChange(e.target.value.slice(0, 500))}
          readOnly={readOnly}
          placeholder={t("observationPlaceholder")}
          rows={3}
          className="w-full resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm"
        />
        <div className="mt-1 text-xs text-slate-500">{observation.length}/500</div>
      </div>

      <div className="flex items-center justify-between pt-4">
        {!readOnly && <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t("back")}
        </button>}
        {!readOnly && <button
          type="button"
          onClick={() => onSubmit(observation)}
          disabled={!allAnswered || submitting}
          className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? t("submitting") : t("completeInspection")}
        </button>}
      </div>
    </div>
  );
}
