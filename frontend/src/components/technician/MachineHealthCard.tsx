"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  ShieldExclamationIcon,
} from "@heroicons/react/24/outline";
import type { AiAnomalyAnalysis, AiAnomalyRiskLevel } from "@/services/aiAnomaly";
import { machineDisplayName, type AiAnomalyMachineOption } from "@/services/aiAnomaly";
import {
  analysisAgeLabel,
  formatAnalysisDateTime,
  riskLevelLabel,
  riskLevelTone,
} from "@/components/technician/machineHealthPresentation";
import type { MachineHealthLocaleTranslator } from "@/components/technician/machineHealthPresentation";

const RISK_ICONS = {
  NORMAL: CheckCircleIcon,
  MONITOR: EyeIcon,
  HIGH: ExclamationTriangleIcon,
  CRITICAL: ShieldExclamationIcon,
} satisfies Record<AiAnomalyRiskLevel, typeof CheckCircleIcon>;

export type MachineHealthCardProps = Readonly<{
  analysis: AiAnomalyAnalysis;
  machines: AiAnomalyMachineOption[];
  locale: string;
  t: MachineHealthLocaleTranslator;
  detailHref: string;
}>;

export default function MachineHealthCard({
  analysis,
  machines,
  locale,
  t,
  detailHref,
}: MachineHealthCardProps) {
  const tone = riskLevelTone(analysis.risk_level);
  const Icon = RISK_ICONS[analysis.risk_level];
  const machineLabel = useMemo(
    () => machineDisplayName(analysis.machine_id, machines),
    [analysis.machine_id, machines],
  );
  const subtitleLine = useMemo(() => {
    const model = t("machineModel");
    return model === "machineModel" ? "" : model;
  }, [t]);

  const riskScore = Math.round(analysis.risk_score);
  const persistenceKey = analysis.persistent_alert
    ? "persistentAnomaly"
    : "noPersistentAnomaly";

  const ageLabel = analysisAgeLabel(
    analysis.measurement_timestamp,
    locale,
    t("lastAnalysisToday"),
    t("lastAnalysis"),
  );

  const timestampLabel = formatAnalysisDateTime(
    analysis.measurement_timestamp,
    locale,
    t("lastAnalysis"),
  );

  const isCritical =
    analysis.risk_level === "CRITICAL" || analysis.risk_level === "HIGH";
  const ctaLabel = isCritical ? t("investigate") : t("view");

  return (
    <article
      className={`flex h-full flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm ${tone.border}`}
      data-testid="machine-health-card"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-900">
            {machineLabel}
          </h3>
          {subtitleLine ? (
            <p className="truncate text-sm text-slate-500">{subtitleLine}</p>
          ) : null}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.border} ${tone.background} ${tone.text}`}
        >
          <Icon className="h-4 w-4" />
          {riskLevelLabel(analysis.risk_level, t)}
        </span>
      </header>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("riskScore")}
          </span>
          <span className="text-2xl font-bold text-slate-900">
            {riskScore}
            <span className="text-base font-semibold text-slate-500">
              {" "}
              / 100
            </span>
          </span>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100"
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
        className={`text-sm font-medium ${analysis.persistent_alert ? tone.text : "text-slate-600"}`}
      >
        <span
          aria-hidden
          className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${tone.dot}`}
        />
        {t(persistenceKey)}
      </p>

      <div className="mt-auto space-y-3">
        <dl className="grid gap-1 text-xs text-slate-500">
          <div className="flex items-center justify-between gap-3">
            <dt className="uppercase tracking-wide">{t("lastAnalysis")}</dt>
            <dd className="font-semibold text-slate-700" title={timestampLabel}>
              {ageLabel}
            </dd>
          </div>
        </dl>
        <Link
          href={detailHref}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${tone.border} ${tone.background} ${tone.text} hover:opacity-90`}
        >
          {ctaLabel}
        </Link>
      </div>
    </article>
  );
}
