"use client";

import { useTranslations } from "next-intl";
import { HeartIcon } from "@heroicons/react/24/outline";
import type { MachineHealthSummary, RiskLevel } from "@/hooks/usePredictiveHealth";

const RISK_STYLES: Record<RiskLevel, string> = {
  low: "border-green-200 bg-green-100 text-green-800",
  medium: "border-amber-200 bg-amber-100 text-amber-800",
  high: "border-orange-200 bg-orange-100 text-orange-800",
  critical: "border-red-200 bg-red-100 text-red-800",
  insufficient_data: "border-gray-300 bg-gray-100 text-gray-600",
};

/**
 * Renders nothing for a machine with no prediction yet — the same "absent
 * data means absent badge" convention `LiveStatusBadge` uses, which is
 * what keeps a machine dashboard rendering identically to before this
 * feature existed until the scheduler has actually produced a reading.
 * Takes `status` as a prop rather than calling `usePredictiveHealth()`
 * itself, for the same one-hook-per-page reason `LiveStatusBadge` does.
 * Advisory only: this badge never links to, or triggers, any action that
 * changes a work order, stock level, or machine status.
 */
export default function MachineHealthBadge({
  status,
}: Readonly<{
  status: MachineHealthSummary | undefined;
}>) {
  const t = useTranslations("predictiveMaintenance");

  if (!status) return null;

  const isInsufficientData = status.riskLevel === "insufficient_data";

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid={`machine-health-badge-${status.machineId}`}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${RISK_STYLES[status.riskLevel]}`}
        title={t("riskLevelTooltip", { level: t(`riskLevels.${status.riskLevel}`) })}
      >
        <HeartIcon className="h-3 w-3" />
        {isInsufficientData
          ? t(`riskLevels.${status.riskLevel}`)
          : t("healthScoreValue", { value: Math.round(status.healthScore) })}
      </span>
      {!isInsufficientData && (
        <span className="text-xs text-gray-500" title={t("confidence")}>
          {t(`riskLevels.${status.riskLevel}`)}
        </span>
      )}
    </div>
  );
}
