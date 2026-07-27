"use client";

import { useCallback, useEffect, useState } from "react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";

export type RiskLevel = "low" | "medium" | "high" | "critical" | "insufficient_data";

export interface MachineHealthSummary {
  machineId: string;
  healthScore: number;
  riskLevel: RiskLevel;
  confidence: number;
  modelCount: number;
  generatedAt: string | null;
}

const POLL_INTERVAL_MS = 30000;

/**
 * The fleet-wide health summary backing every dashboard badge — one bulk
 * REST fetch shared by the whole page (mirroring `useLiveMonitoring`'s
 * "call once per page, not per row" convention) plus the same 30s polling
 * cadence already established by `NotificationBell`/`useLiveMonitoring`.
 * No WebSocket here: predictions only change on the nightly scheduler
 * sweep or an explicit refresh, so push updates would be over-engineering
 * for data that's fresh to within half a minute either way. A machine
 * with no prediction yet simply never appears in the map — exactly like a
 * machine with no registered device never appears in `statusByMachine` —
 * so callers render nothing extra for it and the existing manual-only
 * workflow stays untouched.
 */
export function usePredictiveHealth() {
  const { user } = useAuth();
  const [healthByMachine, setHealthByMachine] = useState<Record<string, MachineHealthSummary>>({});

  const refresh = useCallback(async () => {
    try {
      const response = await apiService.getPredictiveFleetSummary();
      const items: MachineHealthSummary[] = Array.isArray(response.data) ? response.data : [];
      setHealthByMachine((prev) => {
        const next = { ...prev };
        for (const item of items) next[item.machineId] = item;
        return next;
      });
    } catch (error) {
      console.error("Failed to load predictive health summary", error);
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [user, refresh]);

  return { healthByMachine, refresh };
}
