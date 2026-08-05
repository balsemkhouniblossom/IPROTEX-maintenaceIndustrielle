import { MachineCondition } from "../types.ts";

export type PreventiveExecutionFormState = {
  condition: MachineCondition;
  customCondition: string;
  comments: string;
  photo: File | null;
  selectedLubrifiant: string;
  selectedLubrificationQtyMode: string;
  lubrificationQty: string;
};

/** Fresh default values for the condition/comments/lubricant/photo form — one instance per call so callers never share a mutable reference. */
export function createInitialExecutionFormState(): PreventiveExecutionFormState {
  return {
    condition: "good",
    customCondition: "",
    comments: "",
    photo: null,
    selectedLubrifiant: "",
    selectedLubrificationQtyMode: "",
    lubrificationQty: "",
  };
}

export type PreventivePlanWorkflowState = {
  selectedPlanIds: string[];
  selectedOccurrenceIdsByPlan: Record<string, string>;
  activePlanStepIndex: number;
  taskStarted: boolean;
};

/** Fresh default values for the plan-selection/step-navigation state. */
export function createInitialPlanWorkflowState(): PreventivePlanWorkflowState {
  return {
    selectedPlanIds: [],
    selectedOccurrenceIdsByPlan: {},
    activePlanStepIndex: 0,
    taskStarted: false,
  };
}
