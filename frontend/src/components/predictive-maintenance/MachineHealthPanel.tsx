"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { apiService } from "@/services/api";
import type { RiskLevel } from "@/hooks/usePredictiveHealth";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { renderWidgetErrorFallback } from "@/components/WidgetErrorFallback";

type PredictionExplanation = {
  measuredFacts: string[];
  modelOutputNotes: string[];
  uncertaintyNotes: string[];
};

type MachineHealthPrediction = {
  _id: string;
  model_type: string;
  health_score: number;
  risk_level: RiskLevel;
  confidence: number;
  generated_at: string;
  explanation: PredictionExplanation;
};

const RISK_TEXT_COLOR: Record<RiskLevel, string> = {
  low: "text-green-800",
  medium: "text-amber-800",
  high: "text-orange-800",
  critical: "text-red-800",
  insufficient_data: "text-gray-600",
};

/**
 * The detailed, per-model-type explanation behind a machine's health
 * badge — every prediction is shown with its measured facts, model
 * output, and uncertainty kept in three visibly separate sections, never
 * blended into one paragraph, per the feature's core requirement. Reads
 * whatever the scheduler (or a prior refresh) already computed and
 * persisted; it never triggers a new prediction run itself, so simply
 * viewing a work order never costs a model inference. Purely additive and
 * read-only, exactly like `KnowledgeSuggestions`: it renders nothing when
 * there is no machine or no stored prediction yet, so it can be dropped
 * into any page without touching that page's own logic.
 */
export default function MachineHealthPanel(props: { machineId?: string }) {
  return (
    <ErrorBoundary boundaryName="machine-health-panel" fallback={renderWidgetErrorFallback}>
      <MachineHealthPanelInner {...props} />
    </ErrorBoundary>
  );
}

function MachineHealthPanelInner({ machineId }: { machineId?: string }) {
  const t = useTranslations("predictiveMaintenance");
  const [predictions, setPredictions] = useState<MachineHealthPrediction[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (!machineId) {
      setPredictions([]);
      return;
    }

    apiService
      .getMachineHealthPredictions(machineId)
      .then((response) => {
        if (cancelled) return;
        setPredictions(Array.isArray(response.data) ? response.data : []);
      })
      .catch((error) => {
        console.error("Failed to load machine health predictions", error);
        if (!cancelled) setPredictions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [machineId]);

  if (predictions.length === 0) return null;

  return (
    <div className="panel border border-teal-100 bg-teal-50" data-testid="machine-health-panel">
      <div className="card-title mb-2 flex items-center gap-2 text-teal-900">
        <ChartBarIcon className="w-5 h-5" />
        {t("panelTitle")}
      </div>
      <p className="mb-3 text-xs text-teal-800">{t("disclaimer")}</p>

      <div className="space-y-4">
        {predictions.map((prediction) => (
          <div
            key={prediction._id}
            className="rounded-lg border border-teal-200 bg-white p-3 text-sm"
            data-testid={`machine-health-prediction-${prediction.model_type}`}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">
                {t(`modelTypes.${prediction.model_type}`)}
              </span>
              <span className={`text-xs font-semibold ${RISK_TEXT_COLOR[prediction.risk_level]}`}>
                {prediction.risk_level === "insufficient_data"
                  ? t(`riskLevels.${prediction.risk_level}`)
                  : `${t("healthScoreValue", { value: Math.round(prediction.health_score) })} · ${t(`riskLevels.${prediction.risk_level}`)}`}
              </span>
            </div>

            <ExplanationSection
              testId={`${prediction.model_type}-measured-facts`}
              label={t("measuredFacts")}
              items={prediction.explanation.measuredFacts}
            />
            <ExplanationSection
              testId={`${prediction.model_type}-model-output`}
              label={t("modelOutput")}
              items={prediction.explanation.modelOutputNotes}
            />
            <ExplanationSection
              testId={`${prediction.model_type}-uncertainty`}
              label={t("uncertainty")}
              items={prediction.explanation.uncertaintyNotes}
              italic
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ExplanationSection({
  testId,
  label,
  items,
  italic,
}: {
  testId: string;
  label: string;
  items: string[];
  italic?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-2" data-testid={testId}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <ul className={`list-disc space-y-0.5 pl-5 text-slate-700 ${italic ? "italic" : ""}`}>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
