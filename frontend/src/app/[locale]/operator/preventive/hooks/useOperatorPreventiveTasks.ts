import { useCallback, useEffect, useMemo, useState } from "react";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import { extractApiErrorMessage } from "@/services/apiErrors";
import { useTranslations } from "next-intl";

export interface Machine {
  _id: string;
  machine_id: string;
  model?: string;
  status?: string;
}

export interface PreventiveWorkOrder {
  _id: string;
  ot_id?: string;
  machine_id?: string | { _id?: string };
  plan_id?: string | { _id?: string };
  type_maintenance?: string;
  status: string;
  due_date?: string;
  scheduled_date?: string;
  date_created?: string;
  description?: string;
}

export interface PreventiveTask {
  planId: string;
  machineId: string;
  planName: string;
  planCode: string;
  machineName: string;
  machineCode: string;
  checkCount: number;
  completedCount: number;
  dueDate: string | null;
  tab: "today" | "upcoming" | "completed";
  workOrderId: string | null;
}

const PREVENTIVE_TYPES = new Set(["preventive", "lubrication", "inspection"]);

function refId(value: string | { _id?: string } | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id || "";
}

function isPreventiveType(type?: string): boolean {
  return Boolean(type && PREVENTIVE_TYPES.has(type));
}

function isSubmittableStatus(status?: string): boolean {
  return status === "scheduled" || status === "overdue";
}

function isCompletedStatus(status?: string): boolean {
  return status === "waiting_validation" || status === "completed" || status === "validated";
}

export function useOperatorPreventiveTasks(userId: string | undefined) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [workOrders, setWorkOrders] = useState<PreventiveWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("dashboard.operator.preventiveTasksFlow");

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [machineItems, woItems] = await Promise.all([
          fetchAllPaginated<Machine>((params) => apiService.getMyMachines(params)),
          fetchAllPaginated<PreventiveWorkOrder>((params) => apiService.getMyWorkOrders(params)),
        ]);
        if (!cancelled) {
          setMachines(machineItems);
          setWorkOrders(woItems.filter((wo) => isPreventiveType(wo.type_maintenance)));
        }
      } catch (e) {
        console.error("Failed to load preventive tasks", e);
        if (!cancelled) setError(extractApiErrorMessage(e, t("loadFailed")));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, t]);

  const machineMap = useMemo(() => {
    const map = new Map<string, Machine>();
    machines.forEach((m) => map.set(m._id, m));
    return map;
  }, [machines]);

  const tasks = useMemo<PreventiveTask[]>(() => {
    const taskMap = new Map<string, PreventiveTask>();

    workOrders.forEach((wo) => {
      const machineId = refId(wo.machine_id);
      const planId = refId(wo.plan_id);
      if (!machineId || !planId) return;

      const machine = machineMap.get(machineId);
      // Every assigned work order is a distinct occurrence. Never collapse
      // two occurrences of the same plan and machine into one card.
      const key = wo._id || `${planId}:${machineId}`;

      const existing = taskMap.get(key);
      if (existing) {
        return;
      }

      let tab: PreventiveTask["tab"] = "upcoming";
      if (isCompletedStatus(wo.status)) {
        tab = "completed";
      } else if (isSubmittableStatus(wo.status)) {
        const due = wo.due_date || wo.scheduled_date;
        if (due) {
          const dueDate = new Date(due);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          tab = dueDate <= today ? "today" : "upcoming";
        } else {
          tab = "today";
        }
      }

      taskMap.set(key, {
        planId,
        machineId,
        planName: wo.description || planId,
        planCode: planId,
        machineName: machine?.machine_id || machineId,
        machineCode: machine?.machine_id || machineId,
        checkCount: 0,
        completedCount: 0,
        dueDate: wo.due_date || wo.scheduled_date || null,
        tab,
        workOrderId: wo._id,
      });
    });

    return Array.from(taskMap.values());
  }, [workOrders, machineMap]);

  const groupedTasks = useMemo(() => {
    return {
      today: tasks.filter((t) => t.tab === "today"),
      upcoming: tasks.filter((t) => t.tab === "upcoming"),
      completed: tasks.filter((t) => t.tab === "completed"),
    };
  }, [tasks]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [machineItems, woItems] = await Promise.all([
        fetchAllPaginated<Machine>((params) => apiService.getMyMachines(params)),
        fetchAllPaginated<PreventiveWorkOrder>((params) => apiService.getMyWorkOrders(params)),
      ]);
      setMachines(machineItems);
      setWorkOrders(woItems.filter((wo) => isPreventiveType(wo.type_maintenance)));
    } catch (e) {
      setError(extractApiErrorMessage(e, t("loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  return {
    machines,
    tasks,
    groupedTasks,
    loading,
    error,
    refresh,
  };
}
