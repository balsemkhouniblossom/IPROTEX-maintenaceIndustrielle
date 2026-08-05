import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiService } from "@/services/api";
import {
  MaintenancePlan,
  ModuleEntity,
  PreventiveOccurrence,
  PreventiveStateResponse,
  PreventiveTaskChecklistItem,
  refId,
} from "../types.ts";
import { createInitialPlanWorkflowState } from "../utils/preventive-form-reset.ts";
import { extractPreventiveApiErrorMessage } from "../utils/preventive-errors.ts";
import {
  buildModuleIdSet,
  buildPreventivePlanGroups,
  buildPreventivePlanStates,
  computeProgressPercent,
  computeStepEligibility,
  extractCompletedLabels,
  filterGroupedChecklistItems,
  filterPreventivePlans,
  filterSelectedChecklistItems,
  findSelectedPlanGroup,
  findSelectedPlanState,
} from "../utils/preventive-plan-groups.ts";

export function usePreventivePlanWorkflow({
  selectedMachine,
  modules,
  plans,
  preventiveState,
  checklistItems,
  refreshPreventiveState,
  notify,
}: {
  selectedMachine: string;
  modules: ModuleEntity[];
  plans: MaintenancePlan[];
  preventiveState: PreventiveStateResponse | null;
  checklistItems: PreventiveTaskChecklistItem[];
  refreshPreventiveState: () => Promise<void>;
  notify: (type: "success" | "error", message: string) => void;
}) {
  const t = useTranslations("dashboard.operator");

  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [selectedOccurrenceIdsByPlan, setSelectedOccurrenceIdsByPlan] = useState<Record<string, string>>({});
  const [activePlanStepIndex, setActivePlanStepIndex] = useState(0);
  const [taskStarted, setTaskStarted] = useState(false);
  const [actionSaving, setActionSaving] = useState(false);

  const modulesForMachine = useMemo(
    () => modules.filter((module) => refId(module.machine_id) === selectedMachine),
    [modules, selectedMachine],
  );
  const moduleIdSet = useMemo(() => buildModuleIdSet(modulesForMachine), [modulesForMachine]);
  const preventivePlans = useMemo(() => filterPreventivePlans(plans, moduleIdSet), [plans, moduleIdSet]);

  const preventiveSections = preventiveState?.sections;
  const preventivePlanStates = useMemo(
    () => buildPreventivePlanStates(preventivePlans, modules, preventiveSections?.preventivePlan),
    [preventivePlans, modules, preventiveSections?.preventivePlan],
  );
  const preventivePlanGroups = useMemo(() => buildPreventivePlanGroups(preventivePlanStates), [preventivePlanStates]);

  const selectedPlanId = selectedPlanIds[activePlanStepIndex] || selectedPlanIds[0] || "";
  const selectedPlanIdsSet = useMemo(() => new Set(selectedPlanIds), [selectedPlanIds]);
  const selectedPlanState = useMemo(
    () => findSelectedPlanState(preventivePlanStates, selectedPlanId),
    [preventivePlanStates, selectedPlanId],
  );
  const selectedPlanGroup = useMemo(
    () => findSelectedPlanGroup(preventivePlanGroups, selectedPlanIdsSet),
    [preventivePlanGroups, selectedPlanIdsSet],
  );
  const selectedPlanLabel =
    selectedPlanGroup?.label || selectedPlanState?.plan.maintenance_code || selectedPlanState?.plan.plan_id || "";

  const groupedChecklistItems = useMemo(
    () => filterGroupedChecklistItems(checklistItems, selectedPlanIdsSet),
    [checklistItems, selectedPlanIdsSet],
  );
  const selectedChecklistItems = useMemo(
    () => filterSelectedChecklistItems(checklistItems, selectedPlanId),
    [checklistItems, selectedPlanId],
  );
  const completedChecklistLabels = useMemo(() => extractCompletedLabels(groupedChecklistItems), [groupedChecklistItems]);
  const currentCompletedChecklistLabels = useMemo(
    () => extractCompletedLabels(selectedChecklistItems),
    [selectedChecklistItems],
  );

  const focusedProgress = computeProgressPercent(currentCompletedChecklistLabels.length, selectedChecklistItems.length);
  const selectedTaskCompleted =
    selectedChecklistItems.length > 0 && currentCompletedChecklistLabels.length === selectedChecklistItems.length;
  const groupTaskCompleted =
    groupedChecklistItems.length > 0 && completedChecklistLabels.length === groupedChecklistItems.length;
  const activePlanStepNumber = selectedPlanGroup ? activePlanStepIndex + 1 : 0;
  const totalPlanSteps = selectedPlanGroup?.planIds.length || 0;
  const isLastPlanStep = totalPlanSteps <= 1 || activePlanStepIndex >= totalPlanSteps - 1;

  const { canGoToNextPlanStep, canSubmitFocusedTask } = computeStepEligibility({
    taskStarted,
    selectedTaskCompleted,
    isLastPlanStep,
    groupTaskCompleted,
    selectedPlanIds,
    selectedOccurrenceIdsByPlan,
    selectedPlanGroup,
  });

  // Keeps the active plan-group selection in sync with the data actually
  // available for the current machine: clears everything when there is no
  // machine or no groups, and jumps to the first group whenever the
  // previously selected plan id no longer belongs to any group (e.g. after
  // switching machines or after the backend state refreshes).
  useEffect(() => {
    if (!selectedMachine || preventivePlanGroups.length === 0) {
      if (selectedPlanIds.length > 0) {
        setSelectedPlanIds([]);
        setSelectedOccurrenceIdsByPlan({});
        setActivePlanStepIndex(0);
        setTaskStarted(false);
      }
      return;
    }

    if (!selectedPlanId || !preventivePlanGroups.some((group) => group.planIds.includes(selectedPlanId))) {
      setSelectedPlanIds(preventivePlanGroups[0].planIds);
      setSelectedOccurrenceIdsByPlan({});
      setActivePlanStepIndex(0);
      setTaskStarted(false);
    }
  }, [preventivePlanGroups, selectedMachine, selectedPlanId, selectedPlanIds.length]);

  function selectPlanGroup(planIds: string[]): void {
    setSelectedPlanIds(planIds);
    setSelectedOccurrenceIdsByPlan({});
    setActivePlanStepIndex(0);
    setTaskStarted(false);
  }

  function goToNextPlanStep(): void {
    if (!canGoToNextPlanStep) return;
    setActivePlanStepIndex((current) => Math.min(current + 1, totalPlanSteps - 1));
    setTaskStarted(false);
  }

  function resetWorkflowState(): void {
    const initial = createInitialPlanWorkflowState();
    setSelectedPlanIds(initial.selectedPlanIds);
    setSelectedOccurrenceIdsByPlan(initial.selectedOccurrenceIdsByPlan);
    setActivePlanStepIndex(initial.activePlanStepIndex);
    setTaskStarted(initial.taskStarted);
  }

  /** Partial reset after a successful submission: keeps the active plan group so the next occurrence can start immediately, only clears occurrence/step/started state. */
  function resetAfterSubmission(): void {
    setSelectedOccurrenceIdsByPlan({});
    setActivePlanStepIndex(0);
    setTaskStarted(false);
  }

  function performPlanToday(plan: MaintenancePlan, occurrence?: PreventiveOccurrence | null): void {
    setSelectedPlanIds((current) => (current.includes(plan._id) ? current : [plan._id]));
    if (occurrence?._id) {
      setSelectedOccurrenceIdsByPlan((current) => ({ ...current, [plan._id]: occurrence._id }));
    }
    setTaskStarted(Boolean(occurrence?._id));
    notify("success", `${plan.maintenance_code || plan.plan_id}: ${t("lifecycle.performToday")}`);
  }

  const startSelectedTask = useCallback(async (): Promise<void> => {
    if (!selectedMachine || !selectedPlanState) return;

    if (selectedPlanState.currentOccurrence?._id) {
      performPlanToday(selectedPlanState.plan, selectedPlanState.currentOccurrence);
      return;
    }

    try {
      setActionSaving(true);
      const today = new Date().toISOString().slice(0, 10);
      const scheduleResponse = await apiService.scheduleOperatorPreventive({
        machine_id: selectedMachine,
        plan_id: selectedPlanState.plan._id,
        scheduled_date: today,
      });
      const occurrenceId = scheduleResponse?.data?.occurrence?._id as string | undefined;
      await refreshPreventiveState();
      if (occurrenceId) {
        setSelectedOccurrenceIdsByPlan((current) => ({ ...current, [selectedPlanState.plan._id]: occurrenceId }));
      }
      setTaskStarted(Boolean(occurrenceId));
      notify(
        "success",
        `${selectedPlanState.plan.maintenance_code || selectedPlanState.plan.plan_id}: ${t("smartCalendar.start")}`,
      );
    } catch (error) {
      console.error("Failed to start preventive task", error);
      notify("error", extractPreventiveApiErrorMessage(error, t("lifecycle.duplicateOccurrence")));
    } finally {
      setActionSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMachine, selectedPlanState, refreshPreventiveState, t]);

  return {
    modulesForMachine,
    preventivePlans,
    preventivePlanStates,
    preventivePlanGroups,
    selectedPlanIds,
    selectedPlanIdsSet,
    selectedPlanId,
    selectedPlanState,
    selectedPlanGroup,
    selectedPlanLabel,
    selectedOccurrenceIdsByPlan,
    groupedChecklistItems,
    selectedChecklistItems,
    completedChecklistLabels,
    currentCompletedChecklistLabels,
    focusedProgress,
    selectedTaskCompleted,
    groupTaskCompleted,
    activePlanStepIndex,
    activePlanStepNumber,
    totalPlanSteps,
    isLastPlanStep,
    taskStarted,
    actionSaving,
    canGoToNextPlanStep,
    canSubmitFocusedTask,
    selectPlanGroup,
    goToNextPlanStep,
    resetWorkflowState,
    resetAfterSubmission,
    startSelectedTask,
  };
}
