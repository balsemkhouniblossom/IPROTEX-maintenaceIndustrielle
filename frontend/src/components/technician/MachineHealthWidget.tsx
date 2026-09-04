"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiService } from "@/services/api";
import type { AiAnomalyAnalysis } from "@/services/aiAnomaly";
import {
  analysisAgeLabel,
  formatAnalysisDateTime,
  riskLevelLabel,
  riskLevelTone,
} from "@/components/technician/machineHealthPresentation";

type Props = Readonly<{
  machineId: string | undefined;
}>;

export function MachineHealthWidget({ machineId }: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const [analysis, setAnalysis] = useState<AiAnomalyAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!machineId) {
      setAnalysis(null);
      return;
    }
    setLoading(true);
    try {
      const response = await apiService.getAiAnomalyMachineHistory(machineId, {
        limit: 1,
        page: 1,
      });
      const items = (response.data?.items ||
        response.data ||
        []) as AiAnomalyAnalysis[];
      if (items.length > 0) {
        const sorted = [...items].sort(
          (left, right) =>
            Date.parse(right.measurement_timestamp) -
            Date.parse(left.measurement_timestamp),
        );
        setAnalysis(sorted[0]);
      } else {
        setAnalysis(null);
      }
    } catch {
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!machineId) return null;

  return (
    <section className="panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {t("technician.machineHealth.widgetTitle")}
        </h2>
        <Link
          href={`/${locale}/technician/machine-health`}
          className="text-xs font-semibold text-blue-700 hover:text-blue-900"
        >
          {t("technician.machineHealth.viewAll")}
        </Link>
      </div>
      {loading ? (
        <p className="text-sm text-slate-500">
          {t("technician.machineHealth.states.loading")}
        </p>
      ) : !analysis ? (
        <p className="text-sm text-slate-500">
          {t("technician.machineHealth.noAnalyses")}
        </p>
      ) : (
        <MachineHealthWidgetContent
          analysis={analysis}
          locale={locale}
          t={t}
        />
      )}
    </section>
  );
}

function MachineHealthWidgetContent({
  analysis,
  locale,
  t,
}: {
  analysis: AiAnomalyAnalysis;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const tone = riskLevelTone(analysis.risk_level);
  const ageLabel = analysisAgeLabel(
    analysis.measurement_timestamp,
    locale,
    t("technician.machineHealth.lastAnalysisToday"),
    t("technician.machineHealth.lastAnalysis"),
  );
  const fullDate = formatAnalysisDateTime(
    analysis.measurement_timestamp,
    locale,
    t("technician.machineHealth.lastAnalysis"),
  );
  const riskScore = Math.round(analysis.risk_score);

  return (
    <div className={`rounded-lg border bg-white p-4 ${tone.border}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.border} ${tone.background} ${tone.text}`}
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${tone.dot}`} />
          {riskLevelLabel(analysis.risk_level, t)}
        </span>
        <div className="text-end">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("technician.machineHealth.riskScore")}
          </p>
          <p className="text-2xl font-bold text-slate-900">
            {riskScore}
            <span className="text-base font-semibold text-slate-500"> / 100</span>
          </p>
        </div>
      </div>
      <p
        className={`mt-3 text-sm font-medium ${analysis.persistent_alert ? tone.text : "text-slate-600"}`}
      >
        {analysis.persistent_alert
          ? t("technician.machineHealth.persistentAnomaly")
          : t("technician.machineHealth.noPersistentAnomaly")}
      </p>
      <p className="mt-1 text-xs text-slate-500" title={fullDate}>
        {t("technician.machineHealth.lastAnalysis")}: {ageLabel}
      </p>
      <div className="mt-3">
        <Link
          href={`/${locale}/technician/machine-health/${analysis.analysis_id}`}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${tone.border} ${tone.background} ${tone.text}`}
        >
          {t("technician.machineHealth.viewAnalysis")}
        </Link>
      </div>
    </div>
  );
}
