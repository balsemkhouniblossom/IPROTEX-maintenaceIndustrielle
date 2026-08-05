import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiService } from "@/services/api";
import { invalidateList, LIST_EVENTS } from "@/services/listInvalidation";
import {
  GeneratedReportRow,
  Machine,
  MachineCondition,
  PreventiveTaskChecklistItem,
  PreventivePlanGroup,
  uniqueId,
} from "../types.ts";
import { createInitialExecutionFormState } from "../utils/preventive-form-reset.ts";
import { extractPreventiveApiErrorMessage } from "../utils/preventive-errors.ts";
import { buildLubricationPayload, buildPlanSubmissionPayload, validatePreventiveSubmission } from "../utils/preventive-validation.ts";

/**
 * Owns the condition/comments/lubricant/photo execution form plus the final
 * submission flow. This is the sole owner of the submission payload
 * construction and of `submitOperatorPreventiveMaintenance` calls.
 *
 * Submissions for a multi-plan step group are sent **sequentially, one plan
 * at a time** (not `Promise.all`) — preserved deliberately: each plan
 * updates its own assigned work order, and attributing which specific plan
 * failed (to show the operator an accurate error and leave the already-
 * submitted plans intact) requires resolving them in order rather than
 * racing them concurrently.
 */
export function usePreventiveSubmission({
  userId,
  selectedMachine,
  selectedCategory,
  machines,
  checklistItems,
  selectedPlanIds,
  selectedPlanGroup,
  groupedChecklistItems,
  completedChecklistLabels,
  selectedOccurrenceIdsByPlan,
  addGeneratedReport,
  refreshPreventiveState,
  resetAfterSubmission,
  notify,
}: {
  userId: string | undefined;
  selectedMachine: string;
  selectedCategory: string;
  machines: Machine[];
  checklistItems: PreventiveTaskChecklistItem[];
  selectedPlanIds: string[];
  selectedPlanGroup: PreventivePlanGroup | null;
  groupedChecklistItems: PreventiveTaskChecklistItem[];
  completedChecklistLabels: string[];
  selectedOccurrenceIdsByPlan: Record<string, string>;
  addGeneratedReport: (report: GeneratedReportRow) => void;
  refreshPreventiveState: () => Promise<void>;
  resetAfterSubmission: () => void;
  notify: (type: "success" | "error", message: string) => void;
}) {
  const t = useTranslations("dashboard.operator");
  const tCommon = useTranslations("common");
  const tChecklist = useTranslations("preventiveTaskChecklist");

  const initialForm = createInitialExecutionFormState();
  const [condition, setCondition] = useState<MachineCondition>(initialForm.condition);
  const [customCondition, setCustomCondition] = useState(initialForm.customCondition);
  const [comments, setComments] = useState(initialForm.comments);
  const [photo, setPhoto] = useState<File | null>(initialForm.photo);
  const [selectedLubrifiant, setSelectedLubrifiant] = useState(initialForm.selectedLubrifiant);
  const [selectedLubrificationQtyMode, setSelectedLubrificationQtyMode] = useState(initialForm.selectedLubrificationQtyMode);
  const [lubrificationQty, setLubrificationQty] = useState(initialForm.lubrificationQty);
  const [submitValidationReason, setSubmitValidationReason] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const submitValidationMessage = useMemo(() => {
    if (!submitValidationReason) return "";

    switch (submitValidationReason) {
      case "missing-user-or-machine":
        return `${t("validation")}: ${t("machine")}`;
      case "no-tasks-selected":
        return t("preventiveTasks");
      case "no-occurrence-scheduled":
        return t("validation");
      case "submit-failed":
        return tCommon("error");
      default:
        return submitValidationReason;
    }
  }, [submitValidationReason, t, tCommon]);

  // A stale validation error shouldn't linger once the underlying condition
  // that caused it has changed (new machine/category picked, or the
  // checklist itself changed).
  useEffect(() => {
    if (!submitValidationReason) return;
    setSubmitValidationReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMachine, selectedCategory, checklistItems]);

  function clearValidationReason(): void {
    setSubmitValidationReason("");
  }

  function setValidationReason(reason: string): void {
    setSubmitValidationReason(reason);
  }

  function resetExecutionForm(): void {
    const fresh = createInitialExecutionFormState();
    setCondition(fresh.condition);
    setCustomCondition(fresh.customCondition);
    setComments(fresh.comments);
    setPhoto(fresh.photo);
    setSelectedLubrifiant(fresh.selectedLubrifiant);
    setSelectedLubrificationQtyMode(fresh.selectedLubrificationQtyMode);
    setLubrificationQty(fresh.lubrificationQty);
    setSubmitValidationReason("");
  }

  async function uploadPhotoIfPresent(machineId: string): Promise<void> {
    if (!photo || !userId) return;

    const formData = new FormData();
    formData.append("file", photo);
    formData.append("document_id", uniqueId("DOC"));
    formData.append("machine_id", machineId);
    formData.append("type_document", "maintenance_photo");
    formData.append("description", t("photoUpload"));
    formData.append("uploaded_by", userId);

    await apiService.uploadDocument(formData);
  }

  async function submitPreventiveMaintenance(): Promise<void> {
    const validationReason = validatePreventiveSubmission({
      userId,
      selectedMachine,
      completedChecklistLabelsCount: completedChecklistLabels.length,
      selectedPlanIds,
      selectedOccurrenceIdsByPlan,
      selectedPlanGroup,
    });

    if (validationReason === "missing-user-or-machine") {
      setSubmitValidationReason(validationReason);
      notify("error", t("validation"));
      return;
    }
    if (validationReason === "no-tasks-selected") {
      setSubmitValidationReason(validationReason);
      notify("error", tChecklist("heading"));
      return;
    }
    if (validationReason === "no-occurrence-scheduled") {
      // The Operator must act on an already-scheduled occurrence (via
      // "Perform today" on a due/overdue card) rather than an arbitrary
      // plan. This endpoint updates an assigned work order, it never
      // creates one.
      setSubmitValidationReason(validationReason);
      notify("error", t("validation"));
      return;
    }

    const conditionValue = condition === "custom" ? customCondition.trim() : condition;

    setSubmitValidationReason("");
    setSubmitting(true);
    try {
      const machineLabel = machines.find((item) => item._id === selectedMachine)?.machine_id ?? tCommon("notAvailable");
      const taskSummary = completedChecklistLabels.join(" | ");
      const lubrication = buildLubricationPayload(selectedLubrifiant, lubrificationQty);

      // Sequential on purpose — see the hook-level doc comment above.
      const submissionResults: Array<{ workOrderId: string; reportId: string }> = [];
      for (const planId of selectedPlanIds) {
        const planPayload = buildPlanSubmissionPayload(planId, groupedChecklistItems, selectedOccurrenceIdsByPlan, selectedPlanGroup);
        if (!planPayload) {
          throw new Error("Preventive submission is incomplete");
        }

        const response = await apiService.submitOperatorPreventiveMaintenance({
          work_order_id: planPayload.occurrenceId,
          tasks_completed: planPayload.taskLabels,
          condition: conditionValue,
          comments: comments.trim() || undefined,
          lubrication,
        });

        const workOrderId = response?.data?.workOrder?._id as string | undefined;
        const reportId = response?.data?.report?._id as string | undefined;
        if (!workOrderId || !reportId) {
          throw new Error("Preventive submission failed");
        }
        submissionResults.push({ workOrderId, reportId });
      }

      await uploadPhotoIfPresent(selectedMachine);
      // The submitted work order's status changed server-side, so the Admin
      // Work Orders list has no other way to learn that.
      invalidateList(LIST_EVENTS.workOrders);
      addGeneratedReport({
        id: submissionResults.map((item) => `${item.workOrderId}-${item.reportId}`).join("|"),
        type: "preventive",
        workOrderId: submissionResults.map((item) => item.workOrderId).join(","),
        reportId: submissionResults.map((item) => item.reportId).join(","),
        machine: machineLabel,
        summary: taskSummary,
        createdAt: new Date().toISOString(),
        status: "waiting_validation",
      });

      await refreshPreventiveState();
      resetAfterSubmission();

      notify("success", t("notifications.submitSuccess"));
    } catch (error) {
      console.error("Failed to submit preventive maintenance", error);
      setSubmitValidationReason("submit-failed");
      notify("error", extractPreventiveApiErrorMessage(error, tCommon("error")));
    } finally {
      setSubmitting(false);
    }
  }

  return {
    condition,
    setCondition,
    customCondition,
    setCustomCondition,
    comments,
    setComments,
    photo,
    setPhoto,
    selectedLubrifiant,
    setSelectedLubrifiant,
    selectedLubrificationQtyMode,
    setSelectedLubrificationQtyMode,
    lubrificationQty,
    setLubrificationQty,
    submitValidationReason,
    submitValidationMessage,
    submitting,
    clearValidationReason,
    setValidationReason,
    resetExecutionForm,
    submitPreventiveMaintenance,
  };
}
