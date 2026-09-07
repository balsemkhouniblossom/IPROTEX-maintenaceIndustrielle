import { useCallback, useEffect, useMemo, useState } from "react";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import { extractApiErrorMessage } from "@/services/apiErrors";
import { useTranslations } from "next-intl";
import { invalidateList, LIST_EVENTS } from "@/services/listInvalidation";

export interface ChecklistItem {
  _id: string;
  task_id: string;
  instruction: string;
  responsable?: string;
  status: "pending" | "completed";
  notes?: string;
  completed_at?: string | null;
  plan_id?: string | { _id?: string };
  module_id?: string | { _id?: string; machine_id?: { _id?: string } };
}

interface InspectionResult {
  workOrderId: string;
  workOrderOtId: string;
  reportId: string;
}

export function usePreventiveInspection(
  planId: string | null,
  machineId: string | null,
  occurrenceId: string | null,
  readOnly = false,
) {
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [workOrderId, setWorkOrderId] = useState<string | null>(null);
  const [itemResults, setItemResults] = useState<Record<string, "ok" | "problem">>({});
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("dashboard.operator.preventiveTasksFlow");

  const machineIdRef = machineId;

  useEffect(() => {
    setWorkOrderId(occurrenceId);
  }, [occurrenceId]);

  useEffect(() => {
    if (!planId || !machineId) return;
    let cancelled = false;

    async function loadChecklist() {
      setLoading(true);
      setError(null);
      try {
      const items = await fetchAllPaginated<ChecklistItem>((params) =>
          apiService.getOperatorPreventiveTaskChecklist({
            ...params,
            machineId: machineId || undefined,
          }),
        );
        const planItems = items.filter((item) => {
          const pid = typeof item.plan_id === "string" ? item.plan_id : item.plan_id?._id || "";
          return pid === planId;
        });
        if (!cancelled) {
          setChecklistItems(planItems);
          const results: Record<string, "ok" | "problem"> = {};
          planItems.forEach((item) => {
          if (readOnly && item.status === "completed") {
              results[item._id] = item.notes?.startsWith("Problem:") ? "problem" : "ok";
            }
          });
          setItemResults(results);
        }
      } catch (e) {
        console.error("Failed to load inspection checklist", e);
        if (!cancelled) setError(extractApiErrorMessage(e, t("loadFailed")));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadChecklist();
    return () => {
      cancelled = true;
    };
  }, [planId, machineId, readOnly, t]);

  const problems = useMemo(
    () =>
      checklistItems
        .filter((item) => itemResults[item._id] === "problem")
        .map((item) => ({ itemId: item._id, instruction: item.instruction })),
    [checklistItems, itemResults],
  );

  const allAnswered = useMemo(
    () => checklistItems.length > 0 && checklistItems.every((item) => itemResults[item._id] !== undefined),
    [checklistItems, itemResults],
  );

  const okCount = useMemo(
    () => checklistItems.filter((item) => itemResults[item._id] === "ok").length,
    [checklistItems, itemResults],
  );

  const problemCount = useMemo(
    () => checklistItems.filter((item) => itemResults[item._id] === "problem").length,
    [checklistItems, itemResults],
  );

  const toggleItem = useCallback(
    async (itemId: string, result: "ok" | "problem") => {
      const item = checklistItems.find((i) => i._id === itemId);
      if (!item) return;

      setItemResults((prev) => {
        const next = { ...prev, [itemId]: result };
        return next;
      });

      if (readOnly) return;
      try {
        const notes =
          result === "ok" ? "OK" : `Problem: ${item.instruction}`;
        await apiService.updateOperatorPreventiveTaskChecklist(itemId, {
          status: "completed",
          notes,
        });
      } catch (e) {
        console.error("Failed to update checklist item", e);
      }
    },
    [checklistItems, readOnly],
  );

  const submit = useCallback(
    async (observation?: string): Promise<InspectionResult | null> => {
      if (readOnly || !planId || !machineIdRef || !allAnswered || checklistItems.length === 0) return null;

      setSubmitting(true);
      setError(null);
      try {
        const tasksCompleted = checklistItems
          .filter((item) => itemResults[item._id] !== undefined)
          .map((item) => item.instruction);

        const hasProblem = Object.values(itemResults).includes("problem");
        const condition = hasProblem ? "Problem detected" : "OK";

        const targetWorkOrderId = occurrenceId || workOrderId;

        if (!targetWorkOrderId) {
          throw new Error("No work order available for submission");
        }
        setWorkOrderId(targetWorkOrderId);

        const reportResponse = await apiService.submitOperatorPreventiveMaintenance({
          work_order_id: targetWorkOrderId,
          tasks_completed: tasksCompleted,
          condition,
          comments: observation?.trim() || undefined,
        });

        invalidateList(LIST_EVENTS.workOrders);

        return {
          workOrderId: targetWorkOrderId,
          workOrderOtId: reportResponse.data.workOrder.ot_id || reportResponse.data.workOrder._id,
          reportId: reportResponse.data.report.report_id,
        };
      } catch (e) {
        setError(extractApiErrorMessage(e, t("submitFailed")));
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [planId, machineIdRef, allAnswered, checklistItems, itemResults, occurrenceId, workOrderId, readOnly, t],
  );

  const reset = useCallback(() => {
    setChecklistItems([]);
    setItemResults({});
    setWorkOrderId(occurrenceId);
    setError(null);
  }, [occurrenceId]);

  return {
    checklistItems,
    loading,
    submitting,
    workOrderId,
    itemResults,
    problems,
    allAnswered,
    okCount,
    problemCount,
    error,
    toggleItem,
    submit,
    reset,
  };
}
