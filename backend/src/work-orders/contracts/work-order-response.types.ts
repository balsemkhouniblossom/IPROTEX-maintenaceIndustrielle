import {
  MachineSummaryResponse,
  MaintenancePlanSummaryResponse,
  ModuleSummaryResponse,
  UserSummaryResponse,
} from '../../common/response/reference-summaries';
import { WorkOrderLifecycleAction } from '../../schemas/work-order.schema';

/** Mirrors `WorkOrderLifecycleEntry` (`schemas/work-order.schema.ts`) as serialized JSON. */
export interface WorkOrderLifecycleEntryResponse {
  action: WorkOrderLifecycleAction;
  from_status?: string;
  to_status: string;
  actor_user_id?: string;
  reason?: string;
  at: string;
}

/**
 * The actual serialized shape of a Work Order as returned by every
 * `/work-orders*` endpoint today. `machine_id`/`module_id`/`technician_id`/
 * `plan_id` are a plain ObjectId string on mutation endpoints (create,
 * update, complete, validation, reschedule, claim, lifecycle transitions)
 * and a populated summary object on read endpoints that call `.populate(...)`
 * (list, detail) — both are real, currently-occurring shapes, so the type
 * represents both rather than picking one.
 */
export interface WorkOrderResponse {
  _id: string;
  ot_id: string;
  machine_id: string | MachineSummaryResponse;
  module_id?: string | ModuleSummaryResponse | null;
  technician_id?: string | UserSummaryResponse | null;
  plan_id?: string | MaintenancePlanSummaryResponse | null;
  description?: string;
  type_maintenance?: string;
  status: string;
  priorite?: string;
  code_panne?: string;
  date_created: string;
  date_start?: string;
  scheduled_date?: string;
  due_date?: string;
  execution_date?: string;
  date_end?: string;
  date_closed?: string;
  recurrence_source_occurrence_id?: string;
  preventive_occurrence_key?: string;
  original_due_date?: string;
  reschedule_reason?: string;
  rescheduled_by?: string;
  rescheduled_at?: string;
  validated_by?: string;
  validated_at?: string;
  lifecycle_history: WorkOrderLifecycleEntryResponse[];
}

/** `PATCH /work-orders/:id/reschedule` and the Operator equivalent both return this wrapper — never the flat Work Order shape. */
export interface WorkOrderSchedulingResultResponse {
  occurrence: WorkOrderResponse | null;
  schedulingState: string;
}
