import type { AiAnomalyRiskLevel } from "@/services/aiAnomaly";
import { useTranslations } from "next-intl";

export type MachineHealthFilter = "ALL" | "ATTENTION" | "HIGH_RISK" | "CRITICAL";

export type MachineHealthTranslator = ReturnType<typeof useTranslations>;
export type MachineHealthLocaleTranslator = MachineHealthTranslator;

const RISK_LABEL_KEYS: Record<AiAnomalyRiskLevel, string> = {
  NORMAL: "normal",
  MONITOR: "monitor",
  HIGH: "high",
  CRITICAL: "critical",
};

export function riskLevelLabelKey(level: AiAnomalyRiskLevel): string {
  return RISK_LABEL_KEYS[level];
}

export function riskLevelLabel(
  level: AiAnomalyRiskLevel,
  t: MachineHealthLocaleTranslator,
): string {
  const key = `technician.machineHealth.riskLevels.${level}`;
  if (t.has(key)) return t(key);
  return t(`technician.machineHealth.${riskLevelLabelKey(level)}`);
}

export function riskLevelTone(level: AiAnomalyRiskLevel): {
  border: string;
  background: string;
  text: string;
  dot: string;
  bar: string;
} {
  switch (level) {
    case "CRITICAL":
      return {
        border: "border-red-200",
        background: "bg-red-50",
        text: "text-red-800",
        dot: "bg-red-500",
        bar: "bg-red-500",
      };
    case "HIGH":
      return {
        border: "border-amber-200",
        background: "bg-amber-50",
        text: "text-amber-900",
        dot: "bg-amber-500",
        bar: "bg-amber-500",
      };
    case "MONITOR":
      return {
        border: "border-blue-200",
        background: "bg-blue-50",
        text: "text-blue-800",
        dot: "bg-blue-500",
        bar: "bg-blue-500",
      };
    case "NORMAL":
    default:
      return {
        border: "border-green-200",
        background: "bg-green-50",
        text: "text-green-800",
        dot: "bg-green-500",
        bar: "bg-green-500",
      };
  }
}

const REASON_CODE_SUGGESTIONS: Record<string, string> = {
  bearing_fault: "Inspect bearing condition",
  lubrication: "Check lubrication",
  alignment: "Check shaft alignment",
  imbalance: "Check rotor balance",
  looseness: "Check for mechanical looseness",
  electrical: "Inspect electrical connections",
};

const DEFAULT_SUGGESTION = "Review recent maintenance and sensor readings";

export function reasonCodeToSuggestion(code: string): string {
  return REASON_CODE_SUGGESTIONS[code] || DEFAULT_SUGGESTION;
}

export function suggestedChecksForCodes(
  codes: readonly string[],
  fallback: string,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const code of codes) {
    const text = reasonCodeToSuggestion(code);
    if (!seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result.length ? result : [fallback];
}

export function persistenceLabel(
  current: number,
  total: number,
  fallback: string,
): string {
  if (!Number.isFinite(current) || !Number.isFinite(total)) return fallback;
  if (total <= 0) return fallback;
  return fallback.replace("{current}", String(current)).replace("{total}", String(total));
}

export function persistenceLabelKey(): string {
  return "technician.machineHealth.persistence";
}

export function analysisAgeLabel(
  timestamp: string,
  locale: string,
  todayLabel: string,
  fallback: string,
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return fallback;

  const timePart = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) return `${todayLabel} • ${timePart}`;

  const dayPart = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
  }).format(date);
  return `${dayPart} • ${timePart}`;
}

export function formatAnalysisDateTime(
  timestamp: string,
  locale: string,
  fallback: string,
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function filterToRiskLevel(
  filter: MachineHealthFilter,
): AiAnomalyRiskLevel | undefined {
  switch (filter) {
    case "ATTENTION":
      return "MONITOR";
    case "HIGH_RISK":
      return "HIGH";
    case "CRITICAL":
      return "CRITICAL";
    case "ALL":
    default:
      return undefined;
  }
}

export function filterLabelKey(filter: MachineHealthFilter): string {
  switch (filter) {
    case "ALL":
      return "filters.all";
    case "ATTENTION":
      return "filters.attention";
    case "HIGH_RISK":
      return "filters.highRisk";
    case "CRITICAL":
      return "filters.critical";
  }
}
