export type AiAnomalyRiskLevel = "NORMAL" | "MONITOR" | "HIGH" | "CRITICAL";
export type AiAnomalyValidationStatus = "PENDING" | "CONFIRMED" | "REJECTED";
export type AiAnomalyInputSource = "DATASET_REPLAY" | "DEMO";

export type AiAnomalyAnalysis = {
  id?: string;
  analysis_id: string;
  machine_id: string;
  capteur_id?: string;
  requested_by?: string;
  model_version: string;
  input_source: AiAnomalyInputSource;
  experiment: string;
  measurement_timestamp: string;
  bearing: number;
  anomaly_score: number;
  risk_score: number;
  risk_level: AiAnomalyRiskLevel;
  raw_anomaly: boolean;
  persistent_alert: boolean;
  component_scores: {
    zScore: number;
    isolationForest: number;
  };
  reason_codes: string[];
  prototype_result: boolean;
  model_response?: unknown;
  dataset_origin?: string;
  validation_scope?: string;
  generalization_status?: string;
  validation_status: AiAnomalyValidationStatus;
  validated_by?: string;
  validation_comment?: string;
  validated_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type AiAnomalyMachineOption = {
  id: string;
  label: string;
};

export type AiAnomalyFilters = {
  machineId?: string;
  riskLevel?: AiAnomalyRiskLevel | "ALL";
  validationStatus?: AiAnomalyValidationStatus | "ALL";
  dateFrom?: string;
  dateTo?: string;
};

export type AiAnomalySummary = {
  latestRiskScore: number | null;
  latestRiskLevel: AiAnomalyRiskLevel | null;
  persistentAlerts: number;
  pendingValidation: number;
  confirmedAnalyses: number;
  rejectedAnalyses: number;
};

export const AI_ANOMALY_LIMITATION_NOTICE =
  "Experimental prototype based on the public IMS bearing dataset. Validation is currently limited to 1st_test and does not establish generalization to IPROTEX machines.";

export const AI_ANOMALY_DATASET_REPLAY_LABEL = "IMS dataset replay";

export const AI_ANOMALY_RISK_INDICATORS: Record<
  AiAnomalyRiskLevel,
  { icon: "check" | "eye" | "warning" | "critical"; className: string }
> = {
  NORMAL: {
    icon: "check",
    className: "border-green-200 bg-green-50 text-green-800",
  },
  MONITOR: {
    icon: "eye",
    className: "border-blue-200 bg-blue-50 text-blue-800",
  },
  HIGH: {
    icon: "warning",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  CRITICAL: {
    icon: "critical",
    className: "border-red-200 bg-red-50 text-red-800",
  },
};

export function canBrowseAiAnomalyHistory(role?: string | null): boolean {
  return role === "admin" || role === "technician";
}

export function canSubmitAiAnomalyAnalysis(role?: string | null): boolean {
  return role === "admin" || role === "technician" || role === "operator";
}

export function canValidateAiAnomaly(
  role: string | undefined | null,
  analysis: Pick<AiAnomalyAnalysis, "validation_status">,
): boolean {
  return canBrowseAiAnomalyHistory(role) && analysis.validation_status === "PENDING";
}

export function sourceLabelKey(source: AiAnomalyInputSource): string {
  if (source === "DATASET_REPLAY") return "sources.datasetReplay";
  return "sources.demo";
}

export function machineDisplayName(
  machineId: string,
  machines: AiAnomalyMachineOption[],
): string {
  return machines.find((machine) => machine.id === machineId)?.label || machineId;
}

export function filterAiAnomalyAnalyses(
  analyses: AiAnomalyAnalysis[],
  filters: AiAnomalyFilters,
): AiAnomalyAnalysis[] {
  const from = filters.dateFrom ? Date.parse(filters.dateFrom) : null;
  const to = filters.dateTo ? Date.parse(`${filters.dateTo}T23:59:59.999`) : null;

  return analyses.filter((analysis) => {
    if (filters.machineId && analysis.machine_id !== filters.machineId) return false;
    if (
      filters.riskLevel &&
      filters.riskLevel !== "ALL" &&
      analysis.risk_level !== filters.riskLevel
    ) {
      return false;
    }
    if (
      filters.validationStatus &&
      filters.validationStatus !== "ALL" &&
      analysis.validation_status !== filters.validationStatus
    ) {
      return false;
    }
    const timestamp = Date.parse(analysis.measurement_timestamp);
    if (from !== null && timestamp < from) return false;
    if (to !== null && timestamp > to) return false;
    return true;
  });
}

export function summarizeAiAnomalyAnalyses(
  analyses: AiAnomalyAnalysis[],
): AiAnomalySummary {
  const chronological = [...analyses].sort(
    (left, right) =>
      Date.parse(left.measurement_timestamp) -
      Date.parse(right.measurement_timestamp),
  );
  const latest = chronological.at(-1);

  return {
    latestRiskScore: latest?.risk_score ?? null,
    latestRiskLevel: latest?.risk_level ?? null,
    persistentAlerts: analyses.filter((analysis) => analysis.persistent_alert)
      .length,
    pendingValidation: analyses.filter(
      (analysis) => analysis.validation_status === "PENDING",
    ).length,
    confirmedAnalyses: analyses.filter(
      (analysis) => analysis.validation_status === "CONFIRMED",
    ).length,
    rejectedAnalyses: analyses.filter(
      (analysis) => analysis.validation_status === "REJECTED",
    ).length,
  };
}

export function buildRiskScoreChartData(analyses: AiAnomalyAnalysis[]) {
  return [...analyses]
    .sort(
      (left, right) =>
        Date.parse(left.measurement_timestamp) -
        Date.parse(right.measurement_timestamp),
    )
    .map((analysis) => ({
      label: new Date(analysis.measurement_timestamp).toLocaleString(),
      value: Math.round(analysis.risk_score),
    }));
}

export function isAiServiceUnavailable(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 502 || status === 503 || status === 504;
}
