import { serializeDate } from '../../common/response/serialization.util';
import {
  MachineTimelineCategory,
  MachineTimelineEvent,
  MachineTimelineEventType,
} from '../machine-timeline.types';
import {
  AiRecommendationTimelineMetadata,
  DocumentTimelineMetadata,
  FaultTimelineMetadata,
  InterventionReportTimelineMetadata,
  LubricationTimelineMetadata,
  MachineTimelineEventResponse,
  MaintenancePlanTimelineMetadata,
  PartsTimelineMetadata,
  PreventiveTaskTimelineMetadata,
  SystemTimelineMetadata,
  WorkOrderTimelineMetadata,
  assertNever,
} from './machine-timeline-event-response.types';

/**
 * Reads a single field off the internal event's loose `metadata` bag. The
 * per-source builder methods in `MachineTimelineService` are the only code
 * that ever populates `metadata`, and each one already only ever puts the
 * keys its own event type declares — this is the single named, reviewed
 * place that trusts that contract, instead of an `as unknown as {...}` cast
 * inlined at every one of the 31 event-type branches below.
 */
function readMetadataField<T>(
  metadata: Record<string, unknown> | undefined,
  key: string,
): T | undefined {
  return metadata?.[key] as T | undefined;
}

function systemMetadata(
  metadata: Record<string, unknown> | undefined,
): SystemTimelineMetadata {
  return {
    machineCode: readMetadataField(metadata, 'machineCode'),
    moduleCode: readMetadataField(metadata, 'moduleCode'),
    fromStatus: readMetadataField(metadata, 'fromStatus'),
    toStatus: readMetadataField(metadata, 'toStatus'),
  };
}

function workOrderMetadata(
  metadata: Record<string, unknown> | undefined,
): WorkOrderTimelineMetadata {
  return {
    otId: readMetadataField(metadata, 'otId'),
    priority: readMetadataField(metadata, 'priority'),
    faultCode: readMetadataField(metadata, 'faultCode'),
    fromStatus: readMetadataField(metadata, 'fromStatus'),
    toStatus: readMetadataField(metadata, 'toStatus'),
  };
}

function interventionReportMetadata(
  metadata: Record<string, unknown> | undefined,
): InterventionReportTimelineMetadata {
  return {
    reportId: readMetadataField(metadata, 'reportId'),
    otId: readMetadataField(metadata, 'otId'),
    rootCause: readMetadataField(metadata, 'rootCause'),
    actionTaken: readMetadataField(metadata, 'actionTaken'),
    finalState: readMetadataField(metadata, 'finalState'),
  };
}

function faultMetadata(
  metadata: Record<string, unknown> | undefined,
): FaultTimelineMetadata {
  return {
    faultCode: readMetadataField(metadata, 'faultCode'),
    severity: readMetadataField(metadata, 'severity'),
  };
}

function documentMetadata(
  metadata: Record<string, unknown> | undefined,
): DocumentTimelineMetadata {
  return {
    documentId: readMetadataField(metadata, 'documentId'),
    fileName: readMetadataField(metadata, 'fileName'),
    typeDocument: readMetadataField(metadata, 'typeDocument'),
  };
}

function maintenancePlanMetadata(
  metadata: Record<string, unknown> | undefined,
): MaintenancePlanTimelineMetadata {
  return {
    planId: readMetadataField(metadata, 'planId'),
    typeMaintenance: readMetadataField(metadata, 'typeMaintenance'),
  };
}

function preventiveTaskMetadata(
  metadata: Record<string, unknown> | undefined,
): PreventiveTaskTimelineMetadata {
  return {
    taskId: readMetadataField(metadata, 'taskId'),
    responsable: readMetadataField(metadata, 'responsable'),
    notes: readMetadataField(metadata, 'notes'),
    source: readMetadataField(metadata, 'source'),
  };
}

function lubricationMetadata(
  metadata: Record<string, unknown> | undefined,
): LubricationTimelineMetadata {
  return {
    logId: readMetadataField(metadata, 'logId'),
    quantity: readMetadataField(metadata, 'quantity'),
  };
}

function partsMetadata(
  metadata: Record<string, unknown> | undefined,
): PartsTimelineMetadata {
  return {
    movementId: readMetadataField(metadata, 'movementId'),
    partName: readMetadataField(metadata, 'partName'),
    partRef: readMetadataField(metadata, 'partRef'),
    quantity: readMetadataField(metadata, 'quantity'),
  };
}

function aiRecommendationMetadata(
  metadata: Record<string, unknown> | undefined,
): AiRecommendationTimelineMetadata {
  return {
    faultCode: readMetadataField(metadata, 'faultCode'),
    provider: readMetadataField(metadata, 'provider'),
  };
}

/**
 * Converts one internal `MachineTimelineEvent` (Date-based, loosely typed
 * `metadata`) into the exact JSON shape the timeline endpoints have always
 * returned, narrowed into the discriminated union. Applied only as the very
 * last step, after the existing filter/sort/paginate pipeline has already
 * run on the internal shape — this never changes which events are
 * returned, their order, or any field value, only how the compiler
 * describes them. Never queries the database.
 */
export function toMachineTimelineEventResponse(
  event: MachineTimelineEvent,
): MachineTimelineEventResponse {
  const base = {
    id: event.id,
    at: serializeDate(event.at)!,
    title: event.title,
    description: event.description,
    actorUserId: event.actorUserId,
    actor: event.actor,
    machineStatus: event.machineStatus,
    relatedEntity: event.relatedEntity,
  };

  switch (event.type) {
    case MachineTimelineEventType.MACHINE_CREATED:
    case MachineTimelineEventType.MACHINE_STATUS_CHANGED:
    case MachineTimelineEventType.MODULE_ADDED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.SYSTEM,
        metadata: systemMetadata(event.metadata),
      };

    case MachineTimelineEventType.WORK_ORDER_CREATED:
    case MachineTimelineEventType.WORK_ORDER_STARTED:
    case MachineTimelineEventType.WORK_ORDER_COMPLETED:
    case MachineTimelineEventType.WORK_ORDER_CANCELLED:
    case MachineTimelineEventType.WORK_ORDER_CLOSED:
    case MachineTimelineEventType.WORK_ORDER_VALIDATED:
    case MachineTimelineEventType.WORK_ORDER_REJECTED:
    case MachineTimelineEventType.WORK_ORDER_RETURNED:
      return {
        ...base,
        type: event.type,
        category:
          event.category === MachineTimelineCategory.PREVENTIVE
            ? MachineTimelineCategory.PREVENTIVE
            : MachineTimelineCategory.CORRECTIVE,
        metadata: workOrderMetadata(event.metadata),
      };

    case MachineTimelineEventType.INTERVENTION_REPORT_CREATED:
    case MachineTimelineEventType.INTERVENTION_REPORT_VALIDATED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.REPORTS,
        metadata: interventionReportMetadata(event.metadata),
      };

    case MachineTimelineEventType.FAULT_REPORTED:
    case MachineTimelineEventType.FAULT_RESOLVED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.FAULTS,
        metadata: faultMetadata(event.metadata),
      };

    case MachineTimelineEventType.DOCUMENT_UPLOADED:
    case MachineTimelineEventType.DOCUMENT_PUBLISHED:
    case MachineTimelineEventType.DOCUMENT_ARCHIVED:
    case MachineTimelineEventType.DOCUMENT_SUPERSEDED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.DOCUMENTS,
        metadata: documentMetadata(event.metadata),
      };

    case MachineTimelineEventType.MAINTENANCE_PLAN_CREATED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_ACTIVATED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_PAUSED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_RESUMED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_ARCHIVED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_COMPLETED:
    case MachineTimelineEventType.MAINTENANCE_PLAN_UPDATED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.PLANS,
        metadata: maintenancePlanMetadata(event.metadata),
      };

    case MachineTimelineEventType.PREVENTIVE_TASK_COMPLETED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.PREVENTIVE,
        metadata: preventiveTaskMetadata(event.metadata),
      };

    case MachineTimelineEventType.LUBRICATION_COMPLETED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.PREVENTIVE,
        metadata: lubricationMetadata(event.metadata),
      };

    case MachineTimelineEventType.PARTS_CONSUMED:
    case MachineTimelineEventType.PARTS_RETURNED:
    case MachineTimelineEventType.PARTS_ADJUSTED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.INVENTORY,
        metadata: partsMetadata(event.metadata),
      };

    case MachineTimelineEventType.AI_RECOMMENDATION_GENERATED:
      return {
        ...base,
        type: event.type,
        category: MachineTimelineCategory.AI,
        metadata: aiRecommendationMetadata(event.metadata),
      };

    default:
      // Unreachable while `event.type` stays within the declared enum (every
      // event is built by this same service from literal enum values) — this
      // is the safe-degradation path for a genuinely unknown/legacy value
      // rather than a 500, so one bad row can never break the whole page.
      return {
        ...base,
        type: 'unknown',
        category: event.category ?? 'unknown',
        metadata: event.metadata ?? {},
      };
  }
}

export { assertNever };
