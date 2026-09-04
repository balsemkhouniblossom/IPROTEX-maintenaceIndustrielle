"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiService } from "@/services/api";
import type { AiAnomalyAnalysis } from "@/services/aiAnomaly";
import MachineHealthInsight from "@/components/technician/MachineHealthInsight";

type Props = Readonly<{
  machineId: string | undefined;
  workOrderTimestamp?: string;
}>;

const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export default function MachineHealthInsightContainer({
  machineId,
  workOrderTimestamp,
}: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const [analysis, setAnalysis] = useState<AiAnomalyAnalysis | null>(null);

  const load = useCallback(async () => {
    if (!machineId) {
      setAnalysis(null);
      return;
    }
    try {
      const response = await apiService.getAiAnomalyMachineHistory(machineId, {
        limit: 50,
        page: 1,
      });
      const items = ((response.data?.items ||
        response.data ||
        []) as AiAnomalyAnalysis[]).filter(
        (item) => item.validation_status !== "REJECTED",
      );
      const sorted = [...items].sort(
        (left, right) =>
          Date.parse(right.measurement_timestamp) -
          Date.parse(left.measurement_timestamp),
      );

      const workOrderTime = workOrderTimestamp
        ? Date.parse(workOrderTimestamp)
        : null;

      const relevant = sorted.find((item) => {
        const ts = Date.parse(item.measurement_timestamp);
        if (workOrderTime !== null && ts > workOrderTime + 60 * 60 * 1000) {
          return false;
        }
        if (Date.now() - ts > RECENT_WINDOW_MS) {
          return false;
        }
        return (
          item.risk_level === "MONITOR" ||
          item.risk_level === "HIGH" ||
          item.risk_level === "CRITICAL"
        );
      });

      setAnalysis(relevant || null);
    } catch {
      setAnalysis(null);
    }
  }, [machineId, workOrderTimestamp]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!machineId || !analysis) return null;

  return (
    <MachineHealthInsight
      analysis={analysis}
      locale={locale}
      t={t}
      detailHref={`/${locale}/technician/machine-health/${analysis.analysis_id}`}
    />
  );
}
