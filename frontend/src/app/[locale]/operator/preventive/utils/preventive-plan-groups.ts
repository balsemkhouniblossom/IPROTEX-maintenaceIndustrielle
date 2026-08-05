import { isCorrectiveMaintenanceType } from "../../../../../services/maintenanceType.ts";
import {
  type EntityRef,
  type MaintenancePlan,
  type ModuleEntity,
  type PreventivePlanGroup,
  type PreventivePlanState,
  type PreventiveTaskChecklistItem,
  refId,
} from "../types.ts";

export function buildModuleIdSet(modulesForMachine: ModuleEntity[]): Set<string> {
  return new Set(modulesForMachine.map((module) => module._id));
}

export function filterPreventivePlans(
  plans: MaintenancePlan[],
  moduleIdSet: Set<string>,
): MaintenancePlan[] {
  return plans.filter(
    (plan) => moduleIdSet.has(refId(plan.module_id)) && !isCorrectiveMaintenanceType(plan.type_maintenance),
  );
}

export function buildPreventivePlanStates(
  preventivePlans: MaintenancePlan[],
  modules: ModuleEntity[],
  sectionPlanStates: PreventivePlanState[] | undefined,
): PreventivePlanState[] {
  if (sectionPlanStates) return sectionPlanStates;

  return preventivePlans.map(
    (plan) =>
      ({
        plan,
        module: modules.find((moduleEntity) => refId(plan.module_id) === moduleEntity._id) || null,
        currentState: "not_scheduled",
        currentOccurrence: null,
        lastCompletedDate: null,
        nextDueDate: null,
        frequency: {
          value: plan.frequence,
          unit: plan.unite_frequence,
          normalized: plan.unite_frequence,
        },
      }) satisfies PreventivePlanState,
  );
}

/**
 * Groups plan states by maintenance code (falling back to plan_id), trimmed
 * and uppercased so operators see one tab per real-world maintenance task
 * regardless of casing/whitespace drift in how the code was entered.
 */
export function buildPreventivePlanGroups(planStates: PreventivePlanState[]): PreventivePlanGroup[] {
  const groups = new Map<string, PreventivePlanGroup>();

  planStates.forEach((state) => {
    const label = state.plan.maintenance_code || state.plan.plan_id;
    const key = label.trim().toUpperCase() || state.plan._id;
    const existing = groups.get(key);
    if (existing) {
      existing.states.push(state);
      existing.planIds.push(state.plan._id);
      return;
    }

    groups.set(key, {
      key,
      label,
      states: [state],
      planIds: [state.plan._id],
    });
  });

  return Array.from(groups.values());
}

export function findSelectedPlanState(
  planStates: PreventivePlanState[],
  selectedPlanId: string,
): PreventivePlanState | null {
  return planStates.find((item) => item.plan._id === selectedPlanId) || null;
}

export function findSelectedPlanGroup(
  groups: PreventivePlanGroup[],
  selectedPlanIdsSet: Set<string>,
): PreventivePlanGroup | null {
  return groups.find((group) => group.planIds.some((planId) => selectedPlanIdsSet.has(planId))) || null;
}

export function checklistPlanId(item: PreventiveTaskChecklistItem): string {
  const planRef = item.plan_id;
  if (!planRef) return "";
  return refId(planRef as EntityRef);
}

export function filterGroupedChecklistItems(
  checklistItems: PreventiveTaskChecklistItem[],
  selectedPlanIdsSet: Set<string>,
): PreventiveTaskChecklistItem[] {
  return checklistItems.filter((item) => selectedPlanIdsSet.has(checklistPlanId(item)));
}

export function filterSelectedChecklistItems(
  checklistItems: PreventiveTaskChecklistItem[],
  selectedPlanId: string,
): PreventiveTaskChecklistItem[] {
  return checklistItems.filter((item) => checklistPlanId(item) === selectedPlanId);
}

export function extractCompletedLabels(items: PreventiveTaskChecklistItem[]): string[] {
  return items.filter((item) => item.status === "completed").map((item) => item.instruction);
}

export function computeProgressPercent(completedCount: number, totalCount: number): number {
  return totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
}

export function computeStepEligibility({
  taskStarted,
  selectedTaskCompleted,
  isLastPlanStep,
  groupTaskCompleted,
  selectedPlanIds,
  selectedOccurrenceIdsByPlan,
  selectedPlanGroup,
}: {
  taskStarted: boolean;
  selectedTaskCompleted: boolean;
  isLastPlanStep: boolean;
  groupTaskCompleted: boolean;
  selectedPlanIds: string[];
  selectedOccurrenceIdsByPlan: Record<string, string>;
  selectedPlanGroup: PreventivePlanGroup | null;
}): { canGoToNextPlanStep: boolean; canSubmitFocusedTask: boolean } {
  const canGoToNextPlanStep = Boolean(taskStarted && selectedTaskCompleted && !isLastPlanStep);
  const canSubmitFocusedTask = Boolean(
    taskStarted &&
      groupTaskCompleted &&
      selectedPlanIds.every(
        (planId) =>
          selectedOccurrenceIdsByPlan[planId] ||
          selectedPlanGroup?.states.find((state) => state.plan._id === planId)?.currentOccurrence?._id,
      ),
  );
  return { canGoToNextPlanStep, canSubmitFocusedTask };
}
