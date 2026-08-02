// Mirrors backend/src/machine-timeline/machine-timeline.types.ts — kept as
// plain literal unions rather than a shared package since the frontend and
// backend don't share a types module anywhere else in this codebase.

export type MachineTimelineCategory =
  | 'system'
  | 'preventive'
  | 'corrective'
  | 'reports'
  | 'faults'
  | 'documents'
  | 'plans'
  | 'inventory'
  | 'ai';

export type MachineTimelineEventType =
  | 'machine_created'
  | 'machine_status_changed'
  | 'module_added'
  | 'work_order_created'
  | 'work_order_started'
  | 'work_order_completed'
  | 'work_order_cancelled'
  | 'work_order_closed'
  | 'work_order_validated'
  | 'work_order_rejected'
  | 'work_order_returned'
  | 'intervention_report_created'
  | 'intervention_report_validated'
  | 'fault_reported'
  | 'fault_resolved'
  | 'document_uploaded'
  | 'document_published'
  | 'document_archived'
  | 'document_superseded'
  | 'maintenance_plan_created'
  | 'maintenance_plan_activated'
  | 'maintenance_plan_paused'
  | 'maintenance_plan_resumed'
  | 'maintenance_plan_archived'
  | 'maintenance_plan_completed'
  | 'maintenance_plan_updated'
  | 'preventive_task_completed'
  | 'lubrication_completed'
  | 'parts_consumed'
  | 'parts_returned'
  | 'parts_adjusted'
  | 'ai_recommendation_generated';

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
  at: string;
  title: string;
  description?: string;
  actor?: TimelineEventActor;
  machineStatus?: string;
  relatedEntity?: TimelineRelatedEntity;
  metadata?: Record<string, unknown>;
}

export interface MachineTimelinePage {
  items: MachineTimelineEvent[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
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
    installationDate?: string;
    createdAt?: string;
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
    lastMaintenanceAt: string | null;
    nextMaintenanceAt: string | null;
    lastInspectionAt: string | null;
    lastLubricationAt: string | null;
  };
}
