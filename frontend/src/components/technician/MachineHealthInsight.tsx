"use client";

import Link from "next/link";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ShieldExclamationIcon,
} from "@heroicons/react/24/outline";
import type { AiAnomalyAnalysis, AiAnomalyRiskLevel } from "@/services/aiAnomaly";
import {
  analysisAgeLabel,
  riskLevelLabel,
  riskLevelTone,
  suggestedChecksForCodes,
} from "@/components/technician/machineHealthPresentation";
import type { MachineHealthLocaleTranslator } from "@/components/technician/machineHealthPresentation";

const RISK_ICON: Record<AiAnomalyRiskLevel, typeof ShieldExclamationIcon> = {
  NORMAL: CheckCircleIcon,
  MONITOR: CheckCircleIcon,
  HIGH: ExclamationTriangleIcon,
  CRITICAL: ShieldExclamationIcon,
};

export type MachineHealthInsightProps = Readonly<{
  analysis: AiAnomalyAnalysis;
  locale: string;
  t: MachineHealthLocaleTranslator;
  detailHref: string;
}>;

export default function MachineHealthInsight({
  analysis,
  locale,
  t,
  detailHref,
}: MachineHealthInsightProps) {
  const tone = riskLevelTone(analysis.risk_level);
  const Icon = RISK_ICON[analysis.risk_level];
  const riskScore = Math.round(analysis.risk_score);

  const ageLabel = analysisAgeLabel(
    analysis.measurement_timestamp,
    locale,
    t("lastAnalysisToday"),
    t("lastAnalysis"),
  );

  const suggestions = suggestedChecksForCodes(
    analysis.reason_codes,
    t("defaultSuggestion"),
  );

  return (
    <section
      className={`rounded-lg border bg-white p-4 shadow-sm ${tone.border}`}
      data-testid="machine-health-insight"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span
            className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full ${tone.background} ${tone.text}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
              {t("aiInsightTitle")}
            </p>
            <p className={`mt-1 text-sm font-semibold ${tone.text}`}>
              {riskLevelLabel(analysis.risk_level, t)}
            </p>
          </div>
        </div>
        <div className="text-end">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("riskScore")}
          </p>
          <p className="text-lg font-bold text-slate-900">
            {riskScore}
            <span className="text-sm font-semibold text-slate-500"> / 100</span>
          </p>
        </div>
      </header>

      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("persistentShort")}
          </dt>
          <dd className="font-medium text-slate-800">
            {analysis.persistent_alert ? t("yes") : t("no")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("detectedBefore")}
          </dt>
          <dd className="font-medium text-slate-800">{ageLabel}</dd>
        </div>
      </dl>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("suggestedChecks")}
        </p>
        <ul className="mt-1 space-y-1 text-sm text-slate-700">
          {suggestions.map((suggestion) => (
            <li key={suggestion} className="flex items-start gap-2">
              <CheckCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
              <span>{suggestion}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <Link
          href={detailHref}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${tone.border} ${tone.background} ${tone.text}`}
        >
          {t("viewFullAnalysis")}
        </Link>
      </div>
    </section>
  );
}
