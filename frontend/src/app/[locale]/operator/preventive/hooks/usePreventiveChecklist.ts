import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiService } from "@/services/api";
import { fetchAllPaginated } from "@/services/pagination";
import { PreventiveTaskChecklistItem } from "../types.ts";
import { extractPreventiveApiErrorMessage } from "../utils/preventive-errors.ts";

const BULK_COMPLETE_ID = "bulk-complete";

/**
 * Owns the persisted operator checklist for the current machine/category
 * selection — the single source of truth for "what has this operator
 * actually completed" (backend PreventiveTask rows), not a parallel
 * client-only set of checkboxes. This is the sole owner of checklist
 * mutation API calls; nothing outside this hook calls
 * `updateOperatorPreventiveTaskChecklist`.
 */
export function usePreventiveChecklist(selectedMachine: string, selectedCategory: string) {
  const tChecklist = useTranslations("preventiveTaskChecklist");
  const tOperator = useTranslations("dashboard.operator");

  const [checklistItems, setChecklistItems] = useState<PreventiveTaskChecklistItem[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState("");
  const [checklistNotesDraft, setChecklistNotesDraft] = useState<Record<string, string>>({});
  const [checklistSavingId, setChecklistSavingId] = useState("");

  const loadChecklist = useCallback(async () => {
    if (!selectedMachine && !selectedCategory) {
      setChecklistItems([]);
      setChecklistError("");
      return;
    }

    try {
      setChecklistLoading(true);
      setChecklistError("");
      const items = await fetchAllPaginated<PreventiveTaskChecklistItem>((params) =>
        apiService.getOperatorPreventiveTaskChecklist({
          ...params,
          machineId: selectedMachine || undefined,
          // Category-wide view: list every checklist item across the
          // operator's accessible machines in this category, not just one
          // machine, once they've picked a category but not yet a machine.
          machineTypeId: !selectedMachine && selectedCategory ? selectedCategory : undefined,
        }),
      );
      setChecklistItems(items);
    } catch (error) {
      console.error("Failed to load preventive task checklist", error);
      setChecklistItems([]);
      setChecklistError(
        extractPreventiveApiErrorMessage(error, tChecklist("notifications.loadFailed"), tOperator("lifecycle.taskAlreadySubmitted")),
      );
    } finally {
      setChecklistLoading(false);
    }
  }, [selectedMachine, selectedCategory, tChecklist, tOperator]);

  useEffect(() => {
    void loadChecklist();
  }, [loadChecklist]);

  const toggleChecklistItem = useCallback(
    async (item: PreventiveTaskChecklistItem): Promise<{ ok: boolean; message: string }> => {
      if (checklistSavingId) return { ok: false, message: "" };

      const nextStatus = item.status === "completed" ? "pending" : "completed";
      try {
        setChecklistSavingId(item._id);
        await apiService.updateOperatorPreventiveTaskChecklist(item._id, {
          status: nextStatus,
          notes: checklistNotesDraft[item._id] ?? item.notes,
        });
        await loadChecklist();
        return { ok: true, message: tChecklist("notifications.taskUpdated") };
      } catch (error) {
        console.error("Failed to update preventive task checklist item", error);
        return {
          ok: false,
          message: extractPreventiveApiErrorMessage(error, tChecklist("notifications.loadFailed"), tOperator("lifecycle.taskAlreadySubmitted")),
        };
      } finally {
        setChecklistSavingId("");
      }
    },
    [checklistSavingId, checklistNotesDraft, loadChecklist, tChecklist, tOperator],
  );

  const saveChecklistNotes = useCallback(
    async (item: PreventiveTaskChecklistItem): Promise<{ ok: boolean; message: string } | null> => {
      const notes = checklistNotesDraft[item._id];
      if (notes === undefined || notes === item.notes) return null;
      if (checklistSavingId) return null;

      try {
        setChecklistSavingId(item._id);
        await apiService.updateOperatorPreventiveTaskChecklist(item._id, { notes });
        await loadChecklist();
        return { ok: true, message: tChecklist("notifications.taskUpdated") };
      } catch (error) {
        console.error("Failed to save preventive task checklist notes", error);
        return {
          ok: false,
          message: extractPreventiveApiErrorMessage(error, tChecklist("notifications.loadFailed"), tOperator("lifecycle.taskAlreadySubmitted")),
        };
      } finally {
        setChecklistSavingId("");
      }
    },
    [checklistNotesDraft, checklistSavingId, loadChecklist, tChecklist, tOperator],
  );

  const completeChecklistItems = useCallback(
    async (items: PreventiveTaskChecklistItem[]): Promise<{ ok: boolean; message: string }> => {
      if (checklistSavingId) return { ok: false, message: "" };
      if (!items.length) return { ok: false, message: "" };

      try {
        setChecklistSavingId(BULK_COMPLETE_ID);
        await Promise.all(
          items
            .filter((item) => item.status !== "completed")
            .map((item) =>
              apiService.updateOperatorPreventiveTaskChecklist(item._id, {
                status: "completed",
                notes: checklistNotesDraft[item._id] ?? item.notes,
              }),
            ),
        );
        await loadChecklist();
        return { ok: true, message: tChecklist("notifications.taskMarkedComplete") };
      } catch (error) {
        console.error("Failed to complete selected preventive task", error);
        return {
          ok: false,
          message: extractPreventiveApiErrorMessage(error, tChecklist("notifications.loadFailed"), tOperator("lifecycle.taskAlreadySubmitted")),
        };
      } finally {
        setChecklistSavingId("");
      }
    },
    [checklistSavingId, checklistNotesDraft, loadChecklist, tChecklist, tOperator],
  );

  const updateNoteDraft = useCallback((itemId: string, value: string) => {
    setChecklistNotesDraft((prev) => ({ ...prev, [itemId]: value }));
  }, []);

  return {
    checklistItems,
    checklistLoading,
    checklistError,
    checklistNotesDraft,
    checklistSavingId,
    isBulkCompleting: checklistSavingId === BULK_COMPLETE_ID,
    updateNoteDraft,
    toggleChecklistItem,
    saveChecklistNotes,
    completeChecklistItems,
    refreshChecklist: loadChecklist,
  };
}
