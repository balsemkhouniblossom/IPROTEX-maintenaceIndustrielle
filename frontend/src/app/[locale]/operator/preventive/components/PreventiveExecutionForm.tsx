import { useTranslations } from "next-intl";
import { CUSTOM_OPTION, Kpi, Lubrifiant, LUBRIFICATION_QTY_OPTIONS, MachineCondition } from "../types.ts";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WidgetErrorFallback } from "@/components/WidgetErrorFallback";

type PreventiveExecutionFormProps = {
  condition: MachineCondition;
  onConditionChange: (value: MachineCondition) => void;
  customCondition: string;
  onCustomConditionChange: (value: string) => void;
  comments: string;
  onCommentsChange: (value: string) => void;
  lubrifiants: Lubrifiant[];
  selectedLubrifiant: string;
  onSelectedLubrifiantChange: (value: string) => void;
  selectedLubrificationQtyMode: string;
  onSelectedLubrificationQtyModeChange: (value: string) => void;
  lubrificationQty: string;
  onLubrificationQtyChange: (value: string) => void;
  onPhotoChange: (file: File | null) => void;
  selectedMachineKpi: Kpi | null;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
};

export function PreventiveExecutionForm(props: PreventiveExecutionFormProps) {
  return (
    <ErrorBoundary
      boundaryName="preventive-execution-form"
      fallback={(_error, reset) => <WidgetErrorFallback onRetry={reset} />}
    >
      <PreventiveExecutionFormInner {...props} />
    </ErrorBoundary>
  );
}

function PreventiveExecutionFormInner({
  condition,
  onConditionChange,
  customCondition,
  onCustomConditionChange,
  comments,
  onCommentsChange,
  lubrifiants,
  selectedLubrifiant,
  onSelectedLubrifiantChange,
  selectedLubrificationQtyMode,
  onSelectedLubrificationQtyModeChange,
  lubrificationQty,
  onLubrificationQtyChange,
  onPhotoChange,
  selectedMachineKpi,
  t,
  tCommon,
}: PreventiveExecutionFormProps) {
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <label htmlFor="preventive-execution-condition" className="block text-sm font-semibold text-slate-700">{t("machineCondition")}</label>
        <select
          id="preventive-execution-condition"
          value={condition}
          onChange={(event) => onConditionChange(event.target.value as MachineCondition)}
          title={t("machineCondition")}
          aria-label={t("machineCondition")}
          className="mt-2 w-full rounded-lg border px-3 py-2"
        >
          <option value="good">{t("good")}</option>
          <option value="followUp">{t("followUp")}</option>
          <option value="technicianRequired">{t("technicianRequired")}</option>
          <option value="custom">{t("custom")}</option>
        </select>
        {condition === "custom" ? (
          <input
            value={customCondition}
            onChange={(event) => onCustomConditionChange(event.target.value)}
            className="mt-2 w-full rounded-lg border px-3 py-2"
            placeholder={t("comments")}
          />
        ) : null}
      </div>
      <div>
        <label htmlFor="preventive-execution-comments" className="block text-sm font-semibold text-slate-700">{t("comments")}</label>
        <input
          id="preventive-execution-comments"
          value={comments}
          onChange={(event) => onCommentsChange(event.target.value.slice(0, 180))}
          className="mt-2 w-full rounded-lg border px-3 py-2"
          placeholder={t("comments")}
        />
      </div>
      <div>
        <label htmlFor="preventive-execution-lubrifiant" className="block text-sm font-semibold text-slate-700">{t("lubricant")}</label>
        <select
          id="preventive-execution-lubrifiant"
          value={selectedLubrifiant}
          onChange={(event) => onSelectedLubrifiantChange(event.target.value)}
          title={t("lubricant")}
          aria-label={t("lubricant")}
          className="mt-2 w-full rounded-lg border px-3 py-2"
        >
          <option value="">{tCommon("actions.search")}</option>
          {lubrifiants.map((item) => (
            <option key={item._id} value={item._id}>
              {item.nom} ({item.type})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="preventive-execution-qty-mode" className="block text-sm font-semibold text-slate-700">{t("quantity")}</label>
        <select
          id="preventive-execution-qty-mode"
          value={selectedLubrificationQtyMode}
          onChange={(event) => {
            const value = event.target.value;
            onSelectedLubrificationQtyModeChange(value);
            onLubrificationQtyChange(value === CUSTOM_OPTION ? "" : value);
          }}
          title={t("quantity")}
          aria-label={t("quantity")}
          className="mt-2 w-full rounded-lg border px-3 py-2"
        >
          <option value="">{tCommon("actions.search")}</option>
          {LUBRIFICATION_QTY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value={CUSTOM_OPTION}>{t("custom")}</option>
        </select>
        {selectedLubrificationQtyMode === CUSTOM_OPTION ? (
          <input
            type="number"
            min="0"
            value={lubrificationQty}
            onChange={(event) => onLubrificationQtyChange(event.target.value)}
            title={t("quantity")}
            aria-label={t("quantity")}
            placeholder={t("quantity")}
            className="mt-2 w-full rounded-lg border px-3 py-2"
          />
        ) : null}
      </div>
      <div>
        <label htmlFor="preventive-execution-photo" className="block text-sm font-semibold text-slate-700">{t("photoUpload")}</label>
        <input
          id="preventive-execution-photo"
          type="file"
          accept="image/*"
          onChange={(event) => onPhotoChange(event.target.files?.[0] ?? null)}
          title={t("photoUpload")}
          aria-label={t("photoUpload")}
          className="mt-2 w-full rounded-lg border px-3 py-2"
        />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
        {t("lifecycle.actualExecutionDate")}: {new Date().toLocaleString()}
      </div>
      {selectedMachineKpi ? (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border bg-white p-2">
            {t("mtbf")}: {selectedMachineKpi.mtbf_value ?? tCommon("notAvailable")}
          </div>
          <div className="rounded-lg border bg-white p-2">
            {t("mttr")}: {selectedMachineKpi.mttr_value ?? tCommon("notAvailable")}
          </div>
          <div className="rounded-lg border bg-white p-2">
            {t("availability")}: {selectedMachineKpi.availability_rate ?? tCommon("notAvailable")}
          </div>
        </div>
      ) : null}
    </div>
  );
}
