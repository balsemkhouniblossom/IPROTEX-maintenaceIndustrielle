"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { SignalIcon, SignalSlashIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { LiveMachineStatus } from "@/hooks/useLiveMonitoring";

function formatRelativeTime(iso: string | null, locale: string, neverLabel: string): string {
  if (!iso) return neverLabel;
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSeconds = Math.max(0, Math.round(diffMs / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
  // Intentionally not using Intl.RelativeTimeFormat's locale-specific
  // strings here — the badge needs to stay compact in a table cell, and a
  // short numeric+unit form ("3m", "2h") reads consistently at any width.
  void locale;
}

/**
 * Renders nothing at all for a machine with no registered device — that is
 * the entire mechanism by which existing manual-only machine rows keep
 * looking exactly as they did before this feature existed.
 *
 * Deliberately takes `status`/`onSubscribe` as props rather than calling
 * `useLiveMonitoring()` itself: a table renders one badge per row, and
 * `useLiveMonitoring()` opens its own WebSocket connection — calling it
 * per-row would open one socket per machine instead of one for the whole
 * page. The parent page calls the hook exactly once and shares it down.
 */
export default function LiveStatusBadge({
  machineId,
  status,
  onSubscribe,
}: {
  machineId: string;
  status: LiveMachineStatus | undefined;
  onSubscribe: (machineId: string) => void;
}) {
  const t = useTranslations("deviceMonitoring");

  useEffect(() => {
    onSubscribe(machineId);
  }, [machineId, onSubscribe]);

  if (!status || !status.hasDevice) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`live-status-badge-${machineId}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
          status.online
            ? "border-green-200 bg-green-100 text-green-800"
            : "border-gray-300 bg-gray-100 text-gray-600"
        }`}
        title={status.online ? t("status.online") : t("status.offline")}
      >
        {status.online ? (
          <SignalIcon className="h-3 w-3" />
        ) : (
          <SignalSlashIcon className="h-3 w-3" />
        )}
        {status.online ? t("status.online") : t("status.offline")}
      </span>
      <span className="text-xs text-gray-500" title={t("lastSignal")}>
        {t("lastSignalValue", {
          value: formatRelativeTime(status.lastSeenAt, "en", t("never")),
        })}
      </span>
      {status.activeAlarmCount > 0 ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
          title={t("activeAlarms")}
        >
          <ExclamationTriangleIcon className="h-3 w-3" />
          {status.activeAlarmCount}
        </span>
      ) : null}
    </div>
  );
}
