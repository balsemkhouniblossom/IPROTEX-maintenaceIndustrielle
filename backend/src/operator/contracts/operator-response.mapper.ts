import {
  mapPopulatedRef,
  serializeDate,
  serializeObjectId,
} from '../../common/response/serialization.util';
import {
  toMaintenancePlanSummary,
  toModuleSummary,
} from '../../common/response/reference-summaries';
import { MaintenancePlanDocument } from '../../schemas/maintenance-plan.schema';
import { ModuleDocument } from '../../schemas/module.schema';
import {
  PreventiveTask,
  PreventiveTaskDocument,
} from '../../schemas/preventive-task.schema';
import {
  Lubrifiant,
  LubrifiantDocument,
} from '../../schemas/lubrifiant.schema';
import { KPI, KPIDocument } from '../../schemas/kpi.schema';
import { Panne, PanneDocument } from '../../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionDocument,
} from '../../schemas/panne-solution.schema';
import {
  KpiResponse,
  LubrifiantResponse,
  OperatorPreventiveTaskResponse,
  PanneResponse,
  PanneSolutionResponse,
} from './operator-response.types';

type PreventiveTaskLike = (PreventiveTask | PreventiveTaskDocument) & {
  _id: unknown;
};
type LubrifiantLike = (Lubrifiant | LubrifiantDocument) & { _id: unknown };
type KpiLike = (KPI | KPIDocument) & { _id: unknown };
type PanneLike = (Panne | PanneDocument) & { _id: unknown };
type PanneSolutionLike = (PanneSolution | PanneSolutionDocument) & {
  _id: unknown;
};

export function toOperatorPreventiveTaskResponse(
  doc: PreventiveTaskLike,
): OperatorPreventiveTaskResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    task_id: doc.task_id,
    plan_id: mapPopulatedRef(
      doc.plan_id as unknown as
        MaintenancePlanDocument | string | undefined | null,
      toMaintenancePlanSummary,
    ),
    plan_code: doc.plan_code,
    module_id: mapPopulatedRef(
      doc.module_id as unknown as ModuleDocument | string | undefined | null,
      toModuleSummary,
    ),
    instruction: doc.instruction,
    responsable: doc.responsable,
    status: doc.status,
    notes: doc.notes,
    // `completed_at` is explicitly set to `null` (not left `undefined`) when a
    // task is reopened — that literal `null` must round-trip as-is, unlike
    // every other optional date field where `serializeDate`'s undefined
    // collapse is the correct, existing behavior.
    completed_at:
      doc.completed_at === null ? null : serializeDate(doc.completed_at),
    source: doc.source,
    source_key: doc.source_key,
    deleted_at: serializeDate(doc.deleted_at),
  };
}

export function toLubrifiantResponse(doc: LubrifiantLike): LubrifiantResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    lubrifiant_id: doc.lubrifiant_id,
    nom: doc.nom,
    type: doc.type,
    viscosite: doc.viscosite,
    usage: doc.usage,
  };
}

export function toKpiResponse(doc: KpiLike): KpiResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    kpi_id: doc.kpi_id,
    machine_id: serializeObjectId(doc.machine_id)!,
    mtbf_value: doc.mtbf_value,
    mttr_value: doc.mttr_value,
    availability_rate: doc.availability_rate,
    date_calcul: serializeDate(doc.date_calcul)!,
    periode_debut: serializeDate(doc.periode_debut)!,
    periode_fin: serializeDate(doc.periode_fin)!,
  };
}

export function toPanneResponse(doc: PanneLike): PanneResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    panne_id: doc.panne_id,
    code_panne: doc.code_panne,
    description: doc.description,
    gravite: doc.gravite,
  };
}

export function toPanneSolutionResponse(
  doc: PanneSolutionLike,
): PanneSolutionResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    solution_id: doc.solution_id,
    panne_id: mapPopulatedRef(
      doc.panne_id as unknown as PanneDocument | string,
      toPanneResponse,
    )!,
    cause_probable: doc.cause_probable,
    solution_recommandee: doc.solution_recommandee,
  };
}
