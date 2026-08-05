export type EntityRef = string | { _id?: string; id?: string };

export interface MachineType {
  _id: string;
  type_id?: number;
  name: string;
}

export interface Machine {
  _id: string;
  machine_id: string;
  type_id: EntityRef;
  model?: string;
}

export interface ModuleEntity {
  _id: string;
  module_id: string;
  machine_id: EntityRef;
}

export interface MaintenancePlan {
  _id: string;
  plan_id: string;
  module_id: EntityRef;
  type_maintenance?: string;
  instruction?: string;
  responsable?: string;
  documentation?: string;
  maintenance_code?: string;
  frequence?: number;
  unite_frequence?: string;
}

export interface DocumentEntity {
  _id: string;
  machine_id: EntityRef;
  file_path: string;
  file_name: string;
  preview_path?: string;
  type_document?: string;
}

export interface Lubrifiant {
  _id: string;
  nom: string;
  type: string;
}

export interface Kpi {
  _id: string;
  machine_id: EntityRef;
  mtbf_value?: number;
  mttr_value?: number;
  availability_rate?: number;
}

export interface PreventiveTaskChecklistItem {
  _id: string;
  task_id: string;
  instruction: string;
  responsable?: string;
  status: "pending" | "completed";
  notes?: string;
  completed_at?: string;
  module_id?: string | { _id?: string; machine_id?: EntityRef };
  plan_id?: EntityRef | { _id?: string; maintenance_code?: string; plan_id?: string };
}

export interface GeneratedReportRow {
  id: string;
  type: "preventive" | "corrective";
  workOrderId: string;
  reportId: string;
  machine: string;
  summary: string;
  createdAt: string;
  status: string;
}

export type MachineCondition = "good" | "followUp" | "technicianRequired" | "custom";

export const REPORTS_STORAGE_KEY = "operator_generated_reports_history";
export const CUSTOM_OPTION = "__custom__";
export const LUBRIFICATION_QTY_OPTIONS = ["1", "2", "5", "10", "20", "50", "100"];

export function refId(value: EntityRef | undefined): string {
  if (!value) return "";
  return typeof value === "string" ? value : value._id ?? value.id ?? "";
}

export interface PreventiveOccurrence {
  _id: string;
  status?: string;
  due_date?: string;
  scheduled_date?: string;
  execution_date?: string;
  date_start?: string;
  original_due_date?: string;
  reschedule_reason?: string;
  rescheduled_at?: string;
}

export interface PreventivePlanState {
  plan: MaintenancePlan;
  module?: ModuleEntity | null;
  currentOccurrence?: PreventiveOccurrence | null;
  currentState: string;
  lastCompletedDate?: string | null;
  nextDueDate?: string | null;
  frequency?: {
    value?: number;
    unit?: string;
    originalLabel?: string;
    normalized?: string;
  };
}

export interface PreventiveStateResponse {
  sections?: {
    dueToday: PreventivePlanState[];
    overdue: PreventivePlanState[];
    upcoming: PreventivePlanState[];
    waitingValidation: PreventivePlanState[];
    returned: PreventivePlanState[];
    preventivePlan: PreventivePlanState[];
  };
}

export interface PreventivePlanGroup {
  key: string;
  label: string;
  states: PreventivePlanState[];
  planIds: string[];
}

export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
