import {
  MaintenancePlanSummaryResponse,
  ModuleSummaryResponse,
} from '../../common/response/reference-summaries';

/** The actual serialized shape of a Preventive Task checklist row — `plan_id`/`module_id` are plain ObjectId strings on endpoints that don't populate them and summary objects on endpoints that do. */
export interface OperatorPreventiveTaskResponse {
  _id: string;
  task_id: string;
  plan_id?: string | MaintenancePlanSummaryResponse | null;
  plan_code?: string;
  module_id?: string | ModuleSummaryResponse | null;
  instruction: string;
  responsable?: string;
  status: 'pending' | 'completed';
  notes?: string;
  completed_at?: string | null;
  source: 'plan' | 'manual';
  source_key?: string;
  deleted_at?: string;
}

/** The actual serialized shape of a Lubrifiant — no populated refs, no sensitive fields. */
export interface LubrifiantResponse {
  _id: string;
  lubrifiant_id: string;
  nom: string;
  type: string;
  viscosite?: string;
  usage?: string;
}

/** The actual serialized shape of a KPI record — `machine_id` is a plain ObjectId string on every current Operator/Admin endpoint (never populated). */
export interface KpiResponse {
  _id: string;
  kpi_id: string;
  machine_id: string;
  mtbf_value?: number;
  mttr_value?: number;
  availability_rate?: number;
  date_calcul: string;
  periode_debut: string;
  periode_fin: string;
}

/** The actual serialized shape of a Panne (fault) record — no populated refs. */
export interface PanneResponse {
  _id: string;
  panne_id: string;
  code_panne: string;
  description: string;
  gravite?: string;
}

/** The actual serialized shape of a Panne Solution — `panne_id` is a plain ObjectId string on endpoints that don't populate it and a `PanneResponse` on endpoints that do. */
export interface PanneSolutionResponse {
  _id: string;
  solution_id: string;
  panne_id: string | PanneResponse;
  cause_probable?: string;
  solution_recommandee?: string;
}

/** Mirrors `KpiService.getOperatorDashboard`'s plain computed object — a typed projection, not a mapped Mongoose document. */
export interface OperatorDashboardResponse {
  overdueCount: number;
  dueTodayCount: number;
  waitingValidationCount: number;
  completedTodayCount: number;
  totalCount: number;
  assignedCount: number;
  inProgressCount: number;
  completedCount: number;
  generatedAt: string;
}
