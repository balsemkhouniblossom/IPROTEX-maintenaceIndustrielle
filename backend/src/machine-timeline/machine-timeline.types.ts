/**
 * The event vocabulary the timeline can currently derive from existing
 * data (see `MachineTimelineService` for exactly which collection/field
 * each one is read from). Adding a new type is a two-step, isolated change:
 * add the enum member here, add one adapter function in the service's
 * source list — nothing else in the pipeline (merge/sort/filter/paginate)
 * needs to change.
 */
export enum MachineTimelineEventType {
  MACHINE_CREATED = 'machine_created',
  MACHINE_STATUS_CHANGED = 'machine_status_changed',
  MODULE_ADDED = 'module_added',
  WORK_ORDER_CREATED = 'work_order_created',
  WORK_ORDER_STARTED = 'work_order_started',
  WORK_ORDER_COMPLETED = 'work_order_completed',
  WORK_ORDER_CANCELLED = 'work_order_cancelled',
  WORK_ORDER_CLOSED = 'work_order_closed',
  WORK_ORDER_VALIDATED = 'work_order_validated',
  WORK_ORDER_REJECTED = 'work_order_rejected',
  WORK_ORDER_RETURNED = 'work_order_returned',
  INTERVENTION_REPORT_CREATED = 'intervention_report_created',
  INTERVENTION_REPORT_VALIDATED = 'intervention_report_validated',
  FAULT_REPORTED = 'fault_reported',
  FAULT_RESOLVED = 'fault_resolved',
  DOCUMENT_UPLOADED = 'document_uploaded',
  DOCUMENT_PUBLISHED = 'document_published',
  DOCUMENT_ARCHIVED = 'document_archived',
  DOCUMENT_SUPERSEDED = 'document_superseded',
  MAINTENANCE_PLAN_CREATED = 'maintenance_plan_created',
  MAINTENANCE_PLAN_ACTIVATED = 'maintenance_plan_activated',
  MAINTENANCE_PLAN_PAUSED = 'maintenance_plan_paused',
  MAINTENANCE_PLAN_RESUMED = 'maintenance_plan_resumed',
  MAINTENANCE_PLAN_ARCHIVED = 'maintenance_plan_archived',
  MAINTENANCE_PLAN_COMPLETED = 'maintenance_plan_completed',
  MAINTENANCE_PLAN_UPDATED = 'maintenance_plan_updated',
  PREVENTIVE_TASK_COMPLETED = 'preventive_task_completed',
  LUBRICATION_COMPLETED = 'lubrication_completed',
  PARTS_CONSUMED = 'parts_consumed',
  PARTS_RETURNED = 'parts_returned',
  PARTS_ADJUSTED = 'parts_adjusted',
  AI_RECOMMENDATION_GENERATED = 'ai_recommendation_generated',
}

/** Coarse grouping the frontend filter chips operate on — one fixed category per event type, computed in `categoryForWorkOrderEvent`/`CATEGORY_BY_TYPE`. */
export enum MachineTimelineCategory {
  SYSTEM = 'system',
  PREVENTIVE = 'preventive',
  CORRECTIVE = 'corrective',
  REPORTS = 'reports',
  FAULTS = 'faults',
  DOCUMENTS = 'documents',
  PLANS = 'plans',
  INVENTORY = 'inventory',
  AI = 'ai',
}

export interface TimelineEventActor {
  id: string;
  name: string;
  role?: string;
}

export type TimelineRelatedEntityKind =
  | 'work_order'
  | 'document'
  | 'maintenance_plan'
  | 'intervention_report'
  | 'fault_event';

export interface TimelineRelatedEntity {
  kind: TimelineRelatedEntityKind;
  id: string;
  refCode?: string;
}

export interface MachineTimelineEvent {
  id: string;
  type: MachineTimelineEventType;
  category: MachineTimelineCategory;
  at: Date;
  title: string;
  description?: string;
  actorUserId?: string;
  actor?: TimelineEventActor;
  machineStatus?: string;
  relatedEntity?: TimelineRelatedEntity;
  metadata?: Record<string, unknown>;
}

export interface MachineTimelineSummary {
  machine: {
    id: string;
    machineId: string;
    serialNo: string;
    reference?: string;
    type: { id: string; name: string } | null;
    fabricant?: string;
    model?: string;
    location?: string;
    status: string;
    installationDate?: Date;
    createdAt?: Date;
    ageDays: number | null;
  };
  stats: {
    totalInterventions: number;
    preventiveCompleted: number;
    correctiveCompleted: number;
    openWorkOrders: number;
    closedWorkOrders: number;
    downtimeHours: number;
    averageRepairTimeHours: number | null;
    partsConsumed: number;
    lastMaintenanceAt: Date | null;
    nextMaintenanceAt: Date | null;
    lastInspectionAt: Date | null;
    lastLubricationAt: Date | null;
  };
}
