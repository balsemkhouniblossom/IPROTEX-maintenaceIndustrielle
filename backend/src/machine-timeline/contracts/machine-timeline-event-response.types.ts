import {
  MachineTimelineCategory,
  MachineTimelineEventType,
  TimelineEventActor,
  TimelineRelatedEntity,
} from '../machine-timeline.types';

/**
 * Discriminated union of every timeline event category this endpoint can
 * currently produce, discriminated on the existing `type` field (already a
 * stable, per-event-source enum — see `MachineTimelineEventType`). Each
 * variant's `metadata` is a focused, named interface instead of an
 * unrestricted `Record<string, unknown>`, grouped by the source method that
 * builds it in `MachineTimelineService` (one group per collection this
 * feature reads from), matching how the frontend already keys its
 * icon/color/i18n lookup maps off `type`/`category`.
 *
 * Every field name and value here is unchanged from the previous flat
 * `MachineTimelineEvent` shape — this is a compile-time narrowing of an
 * already-stable wire format, not a new one.
 */

interface BaseTimelineEventResponse {
  id: string;
  at: string;
  title: string;
  description?: string;
  actorUserId?: string;
  actor?: TimelineEventActor;
  machineStatus?: string;
  relatedEntity?: TimelineRelatedEntity;
}

export interface SystemTimelineMetadata {
  machineCode?: string;
  moduleCode?: string;
  fromStatus?: string;
  toStatus?: string;
}

export interface SystemTimelineEventResponse extends BaseTimelineEventResponse {
  type:
    | MachineTimelineEventType.MACHINE_CREATED
    | MachineTimelineEventType.MACHINE_STATUS_CHANGED
    | MachineTimelineEventType.MODULE_ADDED;
  category: MachineTimelineCategory.SYSTEM;
  metadata: SystemTimelineMetadata;
}

export interface WorkOrderTimelineMetadata {
  otId?: string;
  priority?: string;
  faultCode?: string;
  fromStatus?: string;
  toStatus?: string;
}

export interface WorkOrderTimelineEventResponse
  extends BaseTimelineEventResponse {
  type:
    | MachineTimelineEventType.WORK_ORDER_CREATED
    | MachineTimelineEventType.WORK_ORDER_STARTED
    | MachineTimelineEventType.WORK_ORDER_COMPLETED
    | MachineTimelineEventType.WORK_ORDER_CANCELLED
    | MachineTimelineEventType.WORK_ORDER_CLOSED
    | MachineTimelineEventType.WORK_ORDER_VALIDATED
    | MachineTimelineEventType.WORK_ORDER_REJECTED
    | MachineTimelineEventType.WORK_ORDER_RETURNED;
  category:
    | MachineTimelineCategory.PREVENTIVE
    | MachineTimelineCategory.CORRECTIVE;
  metadata: WorkOrderTimelineMetadata;
}

export interface InterventionReportTimelineMetadata {
  reportId?: string;
  otId?: string;
  rootCause?: string;
  actionTaken?: string;
  finalState?: string;
}

export interface InterventionReportTimelineEventResponse
  extends BaseTimelineEventResponse {
  type:
    | MachineTimelineEventType.INTERVENTION_REPORT_CREATED
    | MachineTimelineEventType.INTERVENTION_REPORT_VALIDATED;
  category: MachineTimelineCategory.REPORTS;
  metadata: InterventionReportTimelineMetadata;
}

export interface FaultTimelineMetadata {
  faultCode?: string;
  severity?: string;
}

export interface FaultTimelineEventResponse extends BaseTimelineEventResponse {
  type:
    | MachineTimelineEventType.FAULT_REPORTED
    | MachineTimelineEventType.FAULT_RESOLVED;
  category: MachineTimelineCategory.FAULTS;
  metadata: FaultTimelineMetadata;
}

export interface DocumentTimelineMetadata {
  documentId?: string;
  fileName?: string;
  typeDocument?: string;
}

export interface DocumentTimelineEventResponse
  extends BaseTimelineEventResponse {
  type:
    | MachineTimelineEventType.DOCUMENT_UPLOADED
    | MachineTimelineEventType.DOCUMENT_PUBLISHED
    | MachineTimelineEventType.DOCUMENT_ARCHIVED
    | MachineTimelineEventType.DOCUMENT_SUPERSEDED;
  category: MachineTimelineCategory.DOCUMENTS;
  metadata: DocumentTimelineMetadata;
}

export interface MaintenancePlanTimelineMetadata {
  planId?: string;
  typeMaintenance?: string;
}

export interface MaintenancePlanTimelineEventResponse
  extends BaseTimelineEventResponse {
  type:
    | MachineTimelineEventType.MAINTENANCE_PLAN_CREATED
    | MachineTimelineEventType.MAINTENANCE_PLAN_ACTIVATED
    | MachineTimelineEventType.MAINTENANCE_PLAN_PAUSED
    | MachineTimelineEventType.MAINTENANCE_PLAN_RESUMED
    | MachineTimelineEventType.MAINTENANCE_PLAN_ARCHIVED
    | MachineTimelineEventType.MAINTENANCE_PLAN_COMPLETED
    | MachineTimelineEventType.MAINTENANCE_PLAN_UPDATED;
  category: MachineTimelineCategory.PLANS;
  metadata: MaintenancePlanTimelineMetadata;
}

export interface PreventiveTaskTimelineMetadata {
  taskId?: string;
  responsable?: string;
  notes?: string;
  source?: string;
}

export interface PreventiveTaskTimelineEventResponse
  extends BaseTimelineEventResponse {
  type: MachineTimelineEventType.PREVENTIVE_TASK_COMPLETED;
  category: MachineTimelineCategory.PREVENTIVE;
  metadata: PreventiveTaskTimelineMetadata;
}

export interface LubricationTimelineMetadata {
  logId?: string;
  quantity?: number;
}

export interface LubricationTimelineEventResponse
  extends BaseTimelineEventResponse {
  type: MachineTimelineEventType.LUBRICATION_COMPLETED;
  category: MachineTimelineCategory.PREVENTIVE;
  metadata: LubricationTimelineMetadata;
}

export interface PartsTimelineMetadata {
  movementId?: string;
  partName?: string;
  partRef?: string;
  quantity?: number;
}

export interface PartsTimelineEventResponse extends BaseTimelineEventResponse {
  type:
    | MachineTimelineEventType.PARTS_CONSUMED
    | MachineTimelineEventType.PARTS_RETURNED
    | MachineTimelineEventType.PARTS_ADJUSTED;
  category: MachineTimelineCategory.INVENTORY;
  metadata: PartsTimelineMetadata;
}

export interface AiRecommendationTimelineMetadata {
  faultCode?: string;
  provider?: string;
}

export interface AiRecommendationTimelineEventResponse
  extends BaseTimelineEventResponse {
  type: MachineTimelineEventType.AI_RECOMMENDATION_GENERATED;
  category: MachineTimelineCategory.AI;
  metadata: AiRecommendationTimelineMetadata;
}

/**
 * Safety-net variant for a `type` that doesn't match any of the 31 known
 * enum members at runtime (legacy/corrupted data, or a genuinely new type
 * shipped without contract coverage). The mapper degrades to this instead of
 * throwing, so a single bad row can never 500 the whole timeline page.
 */
export interface UnknownTimelineEventResponse
  extends BaseTimelineEventResponse {
  type: 'unknown';
  category: MachineTimelineCategory | 'unknown';
  metadata: Record<string, unknown>;
}

export type MachineTimelineEventResponse =
  | SystemTimelineEventResponse
  | WorkOrderTimelineEventResponse
  | InterventionReportTimelineEventResponse
  | FaultTimelineEventResponse
  | DocumentTimelineEventResponse
  | MaintenancePlanTimelineEventResponse
  | PreventiveTaskTimelineEventResponse
  | LubricationTimelineEventResponse
  | PartsTimelineEventResponse
  | AiRecommendationTimelineEventResponse
  | UnknownTimelineEventResponse;

/**
 * Compile-time-only exhaustiveness proof: this switch must have a case for
 * every `MachineTimelineEventType` member. If a new member is added to the
 * enum without adding a branch here, `event` narrows to something other
 * than `never` in `default`, and `assertNever(event)` fails to compile —
 * turning "forgot to add contract coverage for a new timeline event type"
 * into a build error instead of a silent `Record<string, unknown>` leak.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled timeline event type: ${String(value)}`);
}

export function assertEveryMachineTimelineEventTypeIsCovered(
  type: MachineTimelineEventType,
): void {
  switch (type) {
    case MachineTimelineEventType.MACHINE_CREATED:
    case MachineTimelineEventType.MACHINE_STATUS_CHANGED:
    case MachineTimelineEventType.MODULE_ADDED:
    case MachineTimelineEventType.WORK_ORDER_CREATED:
    case MachineTimelineEventType.WORK_ORDER_STARTED:
    case MachineTimelineEventType.WORK_ORDER_COMPLETED:
    case MachineTimelineEventType.WORK_ORDER_CANCELLED:
    case MachineTimelineEventType.WORK_ORDER_CLOSED:
    case MachineTimelineEventType.WORK_ORDER_VALIDATED:
    case MachineTimelineEventType.WORK_ORDER_REJECTED:
    case MachineTimelineEventType.WORK_ORDER_RETURNED:
    case MachineTimelineEventType.INTERVENTION_REPORT_CREATED:
    case MachineTimelineEventType.INTERVENTION_REPORT_VALIDATED:
    case MachineTimelineEventType.FAULT_REPORTED:
    case MachineTimelineEventType.FAULT_RESOLVED:
    case MachineTimelineEventType.DOCUMENT_UPLOADED:
    case MachineTimelineEventType.DOCUMENT_PUBLISHED:
    case MachineTimelineEventType.DOCUMENT_ARCHIVED:
    case MachineTimelineEventType.DOCUMENT_SUPERSEDED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_CREATED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_ACTIVATED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_PAUSED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_RESUMED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_ARCHIVED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_COMPLETED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_UPDATED:
    case MachineTimelineEventType.PREVENTIVE_TASK_COMPLETED:
    case MachineTimelineEventType.LUBRICATION_COMPLETED:
    case MachineTimelineEventType.PARTS_CONSUMED:
    case MachineTimelineEventType.PARTS_RETURNED:
    case MachineTimelineEventType.PARTS_ADJUSTED:
    case MachineTimelineEventType.AI_RECOMMENDATION_GENERATED:
      return;
    default:
      assertNever(type);
  }
}
