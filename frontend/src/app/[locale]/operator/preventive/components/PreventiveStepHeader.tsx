import { useTranslations } from "next-intl";
import { DocumentEntity, PreventivePlanState } from "../types.ts";

export function PreventiveStepHeader({
  selectedPlanState,
  selectedPlanLabel,
  selectedPlanStateLabel,
  manualDocument,
  onPreviewManual,
  t,
  tCommon,
  tChecklist,
}: Readonly<{
  selectedPlanState: PreventivePlanState | null;
  selectedPlanLabel: string;
  selectedPlanStateLabel: string;
  manualDocument: DocumentEntity | null;
  onPreviewManual: (document: DocumentEntity) => void;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
  tChecklist: ReturnType<typeof useTranslations>;
}>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="card-title">{tChecklist("heading")}</div>
        <div className="mt-1 text-sm text-slate-500">
          {selectedPlanState ? `${selectedPlanLabel} - ${selectedPlanStateLabel}` : tCommon("table.noData")}
        </div>
      </div>
      {manualDocument ? (
        <button
          type="button"
          onClick={() => onPreviewManual(manualDocument)}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
        >
          {t("openManual")}
        </button>
      ) : null}
    </div>
  );
}
