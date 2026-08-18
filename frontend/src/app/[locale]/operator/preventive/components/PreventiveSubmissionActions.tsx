import { useTranslations } from "next-intl";
import { PreventivePlanState } from "../types.ts";

export function PreventiveSubmissionActions({
  selectedPlanState,
  actionSaving,
  taskStarted,
  isBulkCompleting,
  selectedTaskCompleted,
  canGoToNextPlanStep,
  canSubmitFocusedTask,
  isLastPlanStep,
  submitting,
  submitValidationReason,
  submitValidationMessage,
  onStart,
  onComplete,
  onNext,
  onSubmit,
  t,
  tCommon,
}: {
  selectedPlanState: PreventivePlanState | null;
  actionSaving: boolean;
  taskStarted: boolean;
  isBulkCompleting: boolean;
  selectedTaskCompleted: boolean;
  canGoToNextPlanStep: boolean;
  canSubmitFocusedTask: boolean;
  isLastPlanStep: boolean;
  submitting: boolean;
  submitValidationReason: string;
  submitValidationMessage: string;
  onStart: () => void;
  onComplete: () => void;
  onNext: () => void;
  onSubmit: () => void;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  return (
    <>
      <div className="mt-4 grid gap-2 md:grid-cols-4">
        <button
          type="button"
          disabled={!selectedPlanState || actionSaving || taskStarted}
          onClick={onStart}
          className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {actionSaving ? tCommon("saving") : t("smartCalendar.start")}
        </button>
        <button
          type="button"
          disabled={!taskStarted || isBulkCompleting || selectedTaskCompleted}
          onClick={onComplete}
          className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isBulkCompleting ? tCommon("saving") : t("smartCalendar.complete")}
        </button>
        <button
          type="button"
          disabled={!canGoToNextPlanStep}
          onClick={onNext}
          data-testid="preventive-next-step-button"
          className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          {tCommon("next")}
        </button>
        <button type="button"
          disabled={!canSubmitFocusedTask || submitting || !isLastPlanStep}
          onClick={onSubmit}
          data-testid="preventive-submit-button"
          className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? tCommon("saving") : t("generateReport")}
        </button>
      </div>
      {submitValidationReason ? (
        <div data-testid="preventive-submit-validation" className="mt-3 text-sm text-red-600">
          {submitValidationMessage}
        </div>
      ) : null}
    </>
  );
}
