import {
  mapPopulatedRef,
  serializeDate,
  serializeObjectId,
} from '../../common/response/serialization.util';
import {
  toMachineSummary,
  toMaintenancePlanSummary,
  toModuleSummary,
  toUserSummary,
} from '../../common/response/reference-summaries';
import { MachineDocument } from '../../schemas/machine.schema';
import { ModuleDocument } from '../../schemas/module.schema';
import { MaintenancePlanDocument } from '../../schemas/maintenance-plan.schema';
import {
  WorkOrder,
  WorkOrderDocument,
  WorkOrderLifecycleEntry,
} from '../../schemas/work-order.schema';
import {
  WorkOrderLifecycleEntryResponse,
  WorkOrderResponse,
} from './work-order-response.types';

/** The minimal shape `toWorkOrderResponse` needs — a hydrated document, a lean result, or the plain schema class, populated or not. */
type WorkOrderLike = (WorkOrder | WorkOrderDocument) & { _id: unknown };

/** A `technician_id` populated with exactly `SAFE_USER_PROJECTION` (`nom_complet user_id role`). */
type SafeTechnicianRef = {
  _id: unknown;
  user_id?: string;
  nom_complet?: string;
  role?: string;
};

function toLifecycleEntryResponse(
  entry: WorkOrderLifecycleEntry,
): WorkOrderLifecycleEntryResponse {
  return {
    action: entry.action,
    from_status: entry.from_status,
    to_status: entry.to_status,
    actor_user_id: serializeObjectId(entry.actor_user_id),
    reason: entry.reason,
    at: serializeDate(entry.at)!,
  };
}

/**
 * Converts a Work Order (Mongoose document or plain schema instance,
 * `.populate()`d or not) into the exact JSON shape `/work-orders*` endpoints
 * have always returned — this is the single place that decides how
 * ObjectIds, dates, and populated-or-not refs get serialized, so every
 * endpoint stays consistent and every populated shape is exercised through
 * one tested path instead of being duck-typed ad hoc per call site.
 */
export function toWorkOrderResponse(doc: WorkOrderLike): WorkOrderResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    ot_id: doc.ot_id,
    machine_id: mapPopulatedRef(
      doc.machine_id as unknown as MachineDocument | string,
      toMachineSummary,
    )!,
    module_id: mapPopulatedRef(
      doc.module_id as unknown as ModuleDocument | string | undefined | null,
      toModuleSummary,
    ),
    technician_id: mapPopulatedRef(
      doc.technician_id as unknown as
        | SafeTechnicianRef
        | string
        | undefined
        | null,
      toUserSummary,
    ),
    plan_id: mapPopulatedRef(
      doc.plan_id as unknown as
        | MaintenancePlanDocument
        | string
        | undefined
        | null,
      toMaintenancePlanSummary,
    ),
    description: doc.description,
    type_maintenance: doc.type_maintenance,
    status: doc.status,
    priorite: doc.priorite,
    code_panne: doc.code_panne,
    date_created: serializeDate(doc.date_created)!,
    date_start: serializeDate(doc.date_start),
    scheduled_date: serializeDate(doc.scheduled_date),
    due_date: serializeDate(doc.due_date),
    execution_date: serializeDate(doc.execution_date),
    date_end: serializeDate(doc.date_end),
    date_closed: serializeDate(doc.date_closed),
    recurrence_source_occurrence_id: serializeObjectId(
      doc.recurrence_source_occurrence_id,
    ),
    preventive_occurrence_key: doc.preventive_occurrence_key,
    original_due_date: serializeDate(doc.original_due_date),
    reschedule_reason: doc.reschedule_reason,
    rescheduled_by: serializeObjectId(doc.rescheduled_by),
    rescheduled_at: serializeDate(doc.rescheduled_at),
    validated_by: serializeObjectId(doc.validated_by),
    validated_at: serializeDate(doc.validated_at),
    lifecycle_history: (doc.lifecycle_history ?? []).map(
      toLifecycleEntryResponse,
    ),
  };
}

/** `null`-preserving variant for the mutation endpoints that return `null` when the id doesn't exist. */
export function toWorkOrderResponseOrNull(
  doc: WorkOrderLike | null | undefined,
): WorkOrderResponse | null {
  return doc ? toWorkOrderResponse(doc) : null;
}
