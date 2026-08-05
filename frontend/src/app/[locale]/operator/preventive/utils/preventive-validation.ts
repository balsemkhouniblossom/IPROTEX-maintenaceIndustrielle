import { type PreventivePlanGroup, type PreventiveTaskChecklistItem } from "../types.ts";
import { checklistPlanId } from "./preventive-plan-groups.ts";

export type SubmitValidationReason =
  | "missing-user-or-machine"
  | "no-tasks-selected"
  | "no-occurrence-scheduled"
  | "submit-failed"
  | "";

/**
 * Pre-flight checks run before any network call. Mirrors the original
 * inline checks in `submitPreventiveMaintenance` exactly — no new business
 * rule is introduced here.
 */
export function validatePreventiveSubmission({
  userId,
  selectedMachine,
  completedChecklistLabelsCount,
  selectedPlanIds,
  selectedOccurrenceIdsByPlan,
  selectedPlanGroup,
}: {
  userId: string | undefined;
  selectedMachine: string;
  completedChecklistLabelsCount: number;
  selectedPlanIds: string[];
  selectedOccurrenceIdsByPlan: Record<string, string>;
  selectedPlanGroup: PreventivePlanGroup | null;
}): SubmitValidationReason | null {
  if (!userId || !selectedMachine) {
    return "missing-user-or-machine";
  }

  if (completedChecklistLabelsCount === 0) {
    return "no-tasks-selected";
  }

  const missingOccurrence = selectedPlanIds.find((planId) => {
    const stateOccurrence = selectedPlanGroup?.states.find((state) => state.plan._id === planId)?.currentOccurrence?._id;
    return !selectedOccurrenceIdsByPlan[planId] && !stateOccurrence;
  });

  if (missingOccurrence) {
    return "no-occurrence-scheduled";
  }

  return null;
}

export type PlanSubmissionPayload = {
  occurrenceId: string;
  taskLabels: string[];
};

/**
 * Resolves the per-plan occurrence id and completed-task labels for one
 * plan in the active step group. Returns null when the plan's checklist
 * isn't fully completed or no occurrence is resolvable — the caller
 * preserves the original behavior of aborting the whole submission when
 * any single plan in the group is incomplete.
 */
export function buildPlanSubmissionPayload(
  planId: string,
  groupedChecklistItems: PreventiveTaskChecklistItem[],
  selectedOccurrenceIdsByPlan: Record<string, string>,
  selectedPlanGroup: PreventivePlanGroup | null,
): PlanSubmissionPayload | null {
  const planItems = groupedChecklistItems.filter((item) => checklistPlanId(item) === planId);
  const planLabels = planItems.filter((item) => item.status === "completed").map((item) => item.instruction);
  if (planItems.length === 0 || planLabels.length !== planItems.length) {
    return null;
  }

  const stateOccurrence = selectedPlanGroup?.states.find((state) => state.plan._id === planId)?.currentOccurrence?._id;
  const occurrenceId = selectedOccurrenceIdsByPlan[planId] || stateOccurrence;
  if (!occurrenceId) {
    return null;
  }

  return { occurrenceId, taskLabels: planLabels };
}

export function buildLubricationPayload(
  selectedLubrifiant: string,
  lubrificationQty: string,
): { lubrifiant_id: string; quantity: number } | undefined {
  return selectedLubrifiant && lubrificationQty.trim() && Number(lubrificationQty) > 0
    ? { lubrifiant_id: selectedLubrifiant, quantity: Number(lubrificationQty) }
    : undefined;
}
