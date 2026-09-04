"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  ShieldExclamationIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import {
  canValidateAiAnomaly,
  machineDisplayName,
  type AiAnomalyAnalysis,
  type AiAnomalyMachineOption,
  type AiAnomalyRiskLevel,
  type AiAnomalyValidationStatus,
} from "@/services/aiAnomaly";
import {
  analysisAgeLabel,
  formatAnalysisDateTime,
  persistenceLabelKey,
  riskLevelLabel,
  riskLevelTone,
  suggestedChecksForCodes,
} from "@/components/technician/machineHealthPresentation";
import type { MachineHealthLocaleTranslator } from "@/components/technician/machineHealthPresentation";

const RISK_DOT: Record<AiAnomalyRiskLevel, string> = {
  NORMAL: "bg-green-500",
  MONITOR: "bg-blue-500",
  HIGH: "bg-amber-500",
  CRITICAL: "bg-red-500",
};

export type MachineHealthDetailProps = Readonly<{
  analysis: AiAnomalyAnalysis;
  machines: AiAnomalyMachineOption[];
  locale: string;
  t: MachineHealthLocaleTranslator;
  userRole: string | undefined;
  backHref: string;
  onSubmitValidation: (
    payload: { validation_status: "CONFIRMED" | "REJECTED"; validation_comment?: string },
  ) => Promise<void>;
  submitting: boolean;
}>;

const VALIDATION_STATUS_LABEL: Record<AiAnomalyValidationStatus, string> = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
};

export default function MachineHealthDetail({
  analysis,
  machines,
  locale,
  t,
  userRole,
  backHref,
  onSubmitValidation,
  submitting,
}: MachineHealthDetailProps) {
  const tone = riskLevelTone(analysis.risk_level);
  const [showTechnical, setShowTechnical] = useState(false);
  const [validationStatus, setValidationStatus] = useState<"CONFIRMED" | "REJECTED">(
    "CONFIRMED",
  );
  const [comment, setComment] = useState("");
  const canValidate = canValidateAiAnomaly(userRole, analysis);

  const riskScore = Math.round(analysis.risk_score);
  const machineLabel = machineDisplayName(analysis.machine_id, machines);
  const persistenceText = t(persistenceLabelKey(), {
    current: 1,
    total: 5,
  });

  const suggestions = useMemo(
    () => suggestedChecksForCodes(analysis.reason_codes, t("defaultSuggestion")),
    [analysis.reason_codes, t],
  );

  const ageLabel = analysisAgeLabel(
    analysis.measurement_timestamp,
    locale,
    t("lastAnalysisToday"),
    t("lastAnalysis"),
  );

  const fullDate = formatAnalysisDateTime(
    analysis.measurement_timestamp,
    locale,
    t("lastAnalysis"),
  );

  const onConfirm = useCallback(async () => {
    await onSubmitValidation({
      validation_status: validationStatus,
      validation_comment: comment.trim() || undefined,
    });
    setComment("");
  }, [comment, onSubmitValidation, validationStatus]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900"
        >
          ← {t("backToList")}
        </Link>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.border} ${tone.background} ${tone.text}`}
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${RISK_DOT[analysis.risk_level]}`} />
          {riskLevelLabel(analysis.risk_level, t)}
        </span>
      </div>

      <section className={`rounded-lg border bg-white p-5 shadow-sm ${tone.border}`}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{machineLabel}</h1>
            <p className="text-sm text-slate-500" title={fullDate}>
              {t("lastAnalysis")}: {ageLabel}
            </p>
          </div>
          <div className="text-end">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("riskScore")}
            </p>
            <p className="text-3xl font-bold text-slate-900">
              {riskScore}
              <span className="text-base font-semibold text-slate-500"> / 100</span>
            </p>
          </div>
        </header>

        <div className="mt-4">
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={riskScore}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full ${tone.bar}`}
              style={{ width: `${Math.max(0, Math.min(100, riskScore))}%` }}
            />
          </div>
        </div>

        <p
          className={`mt-4 text-sm font-medium ${analysis.persistent_alert ? tone.text : "text-slate-600"}`}
        >
          <span aria-hidden className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${tone.dot}`} />
          {analysis.persistent_alert
            ? t("persistentAnomaly")
            : t("noPersistentAnomaly")}
          {analysis.persistent_alert ? (
            <span className="ms-2 text-xs font-normal text-slate-500">
              ({persistenceText})
            </span>
          ) : null}
        </p>
      </section>

      <section className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          {t("suggestedChecks")}
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {suggestions.map((suggestion) => (
            <li key={suggestion} className="flex items-start gap-2">
              <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              <span>{suggestion}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border bg-white shadow-sm">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
          onClick={() => setShowTechnical((current) => !current)}
          aria-expanded={showTechnical}
        >
          <span className="text-sm font-semibold text-slate-900">
            {t("technicalDetails")}
          </span>
          {showTechnical ? (
            <ChevronDownIcon className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-slate-500" />
          )}
        </button>
        {showTechnical ? (
          <dl className="grid gap-3 border-t px-5 py-4 text-sm md:grid-cols-2">
            <DetailField label={t("modelVersion")} value={analysis.model_version} />
            <DetailField
              label={t("analysisType")}
              value={t(`source.${analysis.input_source}`)}
            />
            <DetailField
              label={t("persistence")}
              value={persistenceText}
            />
            <DetailField label={t("riskScore")} value={`${riskScore}/100`} />
            <DetailField
              label={t("zScore")}
              value={analysis.component_scores.zScore.toFixed(3)}
            />
            <DetailField
              label={t("isolationForest")}
              value={analysis.component_scores.isolationForest.toFixed(3)}
            />
            {analysis.validation_status !== "PENDING" ? (
              <DetailField
                label={t("validationStatus")}
                value={t(
                  `validationStatuses.${VALIDATION_STATUS_LABEL[analysis.validation_status]}`,
                )}
              />
            ) : null}
            {analysis.validated_by ? (
              <DetailField
                label={t("validatedBy")}
                value={analysis.validated_by}
              />
            ) : null}
            {analysis.validation_comment ? (
              <DetailField
                label={t("comment")}
                value={analysis.validation_comment}
                fullWidth
              />
            ) : null}
          </dl>
        ) : null}
      </section>

      <section className="rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">
          {t("wasUseful")}
        </h2>
        {canValidate ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  validationStatus === "CONFIRMED"
                    ? "border-green-500 bg-green-50 text-green-800 ring-2 ring-green-200"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setValidationStatus("CONFIRMED")}
              >
                <CheckCircleIcon className="h-4 w-4" />
                {t("confirmAnomaly")}
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  validationStatus === "REJECTED"
                    ? "border-red-500 bg-red-50 text-red-800 ring-2 ring-red-200"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
                onClick={() => setValidationStatus("REJECTED")}
              >
                <XCircleIcon className="h-4 w-4" />
                {t("rejectAnomaly")}
              </button>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              {t("reason")}
              <textarea
                className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-2 text-sm"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={1000}
              />
            </label>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={submitting}
              onClick={() => void onConfirm()}
            >
              {submitting ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <ShieldExclamationIcon className="h-4 w-4" />
              )}
              {t("submit")}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            {t("alreadyValidated", {
              status: t(
                `validationStatuses.${VALIDATION_STATUS_LABEL[analysis.validation_status]}`,
              ),
            })}
          </p>
        )}
      </section>

      {analysis.persistent_alert || analysis.risk_level !== "NORMAL" ? (
        <div
          className={`flex items-start gap-2 rounded-md border p-3 text-sm ${tone.border} ${tone.background} ${tone.text}`}
          role="status"
        >
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("advisoryCopy")}</span>
        </div>
      ) : null}
    </div>
  );
}

function DetailField({
  label,
  value,
  fullWidth,
}: Readonly<{
  label: string;
  value: string;
  fullWidth?: boolean;
}>) {
  return (
    <div className={fullWidth ? "md:col-span-2" : ""}>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}
