"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { apiService } from "@/services/api";
import { getApiBaseUrl } from "@/config/api-base-url";
import { getAuthToken } from "@/services/authStorage";
import { useAuth } from "@/contexts/AuthContext";

export interface LiveMachineStatus {
  machineId: string;
  hasDevice: boolean;
  online: boolean;
  lastSeenAt: string | null;
  device: { deviceId: string; deviceType: string; label?: string } | null;
  activeAlarmCount: number;
}

const POLL_INTERVAL_MS = 30000;

/**
 * The Machines dashboard's single source of live-monitoring data. Always
 * does an initial REST fetch (so the page renders correct data even if a
 * WebSocket connection never succeeds — no device/broker infrastructure is
 * required for the app to work) and keeps re-polling every 30s (matching
 * `NotificationBell`'s established convention) as a resilient fallback,
 * while a WebSocket connection — when it succeeds — delivers push updates
 * in between polls for genuinely real-time status. Machines with no
 * registered device simply never appear in the map, which is exactly what
 * lets a caller render nothing extra for them and preserve the existing
 * manual-only workflow untouched.
 */
export function useLiveMonitoring() {
  const { user } = useAuth();
  const [statusByMachine, setStatusByMachine] = useState<Record<string, LiveMachineStatus>>({});
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const subscribedMachineIds = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const response = await apiService.getLiveMonitoringSummary();
      const items: LiveMachineStatus[] = Array.isArray(response.data) ? response.data : [];
      setStatusByMachine((prev) => {
        const next = { ...prev };
        for (const item of items) next[item.machineId] = item;
        return next;
      });
    } catch (error) {
      console.error("Failed to load live monitoring summary", error);
    }
  }, []);

  const subscribeToMachine = useCallback((machineId: string) => {
    if (!machineId || subscribedMachineIds.current.has(machineId)) return;
    subscribedMachineIds.current.add(machineId);
    socketRef.current?.emit("subscribe:machine", { machineId });
  }, []);

  useEffect(() => {
    if (!user) return;

    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const currentSubscriptions = subscribedMachineIds.current;

    const token = getAuthToken();
    let socket: Socket | null = null;
    if (token) {
      socket = io(`${getApiBaseUrl()}/live`, {
        auth: { token },
        transports: ["websocket"],
        reconnection: true,
      });
      socketRef.current = socket;

      socket.io.on("reconnect_attempt", () => {
        socket!.auth = { token: getAuthToken() };
      });

      socket.on("connect", () => {
        setSocketConnected(true);
        // Re-join every machine room already known about after a
        // reconnect — subscriptions do not survive a transport drop.
        subscribedMachineIds.current.forEach((machineId) => {
          socket?.emit("subscribe:machine", { machineId });
        });
      });
      socket.on("disconnect", () => setSocketConnected(false));

      socket.on("status", (payload: { machineId?: string; status?: string; lastSeenAt?: string }) => {
        if (!payload?.machineId) return;
        setStatusByMachine((prev) => {
          const existing = prev[payload.machineId!];
          if (!existing) return prev;
          return {
            ...prev,
            [payload.machineId!]: {
              ...existing,
              online: payload.status === "online",
              lastSeenAt: payload.lastSeenAt ?? existing.lastSeenAt,
            },
          };
        });
      });

      socket.on("fault", (payload: { machineId?: string }) => {
        if (!payload?.machineId) return;
        setStatusByMachine((prev) => {
          const existing = prev[payload.machineId!];
          if (!existing) return prev;
          return {
            ...prev,
            [payload.machineId!]: {
              ...existing,
              activeAlarmCount: existing.activeAlarmCount + 1,
            },
          };
        });
      });

      socket.on("telemetry", (payload: { machineId?: string; recordedAt?: string }) => {
        if (!payload?.machineId) return;
        setStatusByMachine((prev) => {
          const existing = prev[payload.machineId!];
          if (!existing) return prev;
          return {
            ...prev,
            [payload.machineId!]: {
              ...existing,
              online: true,
              lastSeenAt: payload.recordedAt ?? existing.lastSeenAt,
            },
          };
        });
      });
    }

    return () => {
      window.clearInterval(interval);
      socket?.disconnect();
      socketRef.current = null;
      currentSubscriptions.clear();
    };
  }, [user, refresh]);

  return { statusByMachine, socketConnected, subscribeToMachine, refresh };
}
