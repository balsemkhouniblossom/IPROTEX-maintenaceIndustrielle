import {
  AdjustmentsHorizontalIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  ArrowUturnLeftIcon,
  BeakerIcon,
  CalendarDaysIcon,
  CheckBadgeIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClipboardDocumentListIcon,
  CpuChipIcon,
  CubeIcon,
  DocumentArrowUpIcon,
  DocumentCheckIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  NoSymbolIcon,
  PauseCircleIcon,
  PencilSquareIcon,
  PlayCircleIcon,
  PlusCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';
import type { MachineTimelineCategory, MachineTimelineEventType } from './types';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * One icon + one color per event type — the same "plain object keyed by
 * enum" idiom `MachineHealthBadge.tsx`'s `RISK_STYLES` already uses, kept
 * here so `TimelineEventCard` and `TimelineFilters` share a single source
 * instead of drifting apart. Colors follow the platform's existing
 * `bg-{color}-100 text-{color}-800 border-{color}-200` badge convention
 * (see e.g. `work-orders/page.tsx`'s `STATUS_BADGE_CLASSES`) — blue for
 * informational/created events, green for completed/resolved/validated,
 * orange for in-progress/pending, yellow for status changes/adjustments,
 * red for critical/rejected/cancelled, gray for archived/closed.
 */
export const EVENT_ICONS: Record<MachineTimelineEventType, IconComponent> = {
  machine_created: PlusCircleIcon,
  machine_status_changed: ArrowsRightLeftIcon,
  module_added: CubeIcon,
  work_order_created: ClipboardDocumentListIcon,
  work_order_started: PlayCircleIcon,
  work_order_completed: CheckCircleIcon,
  work_order_cancelled: XCircleIcon,
  work_order_closed: LockClosedIcon,
  work_order_validated: ShieldCheckIcon,
  work_order_rejected: NoSymbolIcon,
  work_order_returned: ArrowUturnLeftIcon,
  intervention_report_created: DocumentTextIcon,
  intervention_report_validated: ClipboardDocumentCheckIcon,
  fault_reported: ExclamationTriangleIcon,
  fault_resolved: CheckBadgeIcon,
  document_uploaded: DocumentArrowUpIcon,
  document_published: DocumentCheckIcon,
  document_archived: ArchiveBoxIcon,
  document_superseded: ArrowPathIcon,
  maintenance_plan_created: CalendarDaysIcon,
  maintenance_plan_activated: PlayCircleIcon,
  maintenance_plan_paused: PauseCircleIcon,
  maintenance_plan_resumed: PlayCircleIcon,
  maintenance_plan_archived: ArchiveBoxIcon,
  maintenance_plan_completed: CheckCircleIcon,
  maintenance_plan_updated: PencilSquareIcon,
  preventive_task_completed: WrenchScrewdriverIcon,
  lubrication_completed: BeakerIcon,
  parts_consumed: CubeIcon,
  parts_returned: ArrowUturnLeftIcon,
  parts_adjusted: AdjustmentsHorizontalIcon,
  ai_recommendation_generated: SparklesIcon,
};

export const EVENT_COLOR_CLASSES: Record<MachineTimelineEventType, string> = {
  machine_created: 'bg-blue-100 text-blue-800 border-blue-200',
  machine_status_changed: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  module_added: 'bg-blue-100 text-blue-800 border-blue-200',
  work_order_created: 'bg-blue-100 text-blue-800 border-blue-200',
  work_order_started: 'bg-orange-100 text-orange-800 border-orange-200',
  work_order_completed: 'bg-green-100 text-green-800 border-green-200',
  work_order_cancelled: 'bg-red-100 text-red-800 border-red-200',
  work_order_closed: 'bg-gray-100 text-gray-600 border-gray-200',
  work_order_validated: 'bg-green-100 text-green-800 border-green-200',
  work_order_rejected: 'bg-red-100 text-red-800 border-red-200',
  work_order_returned: 'bg-orange-100 text-orange-800 border-orange-200',
  intervention_report_created: 'bg-blue-100 text-blue-800 border-blue-200',
  intervention_report_validated: 'bg-green-100 text-green-800 border-green-200',
  fault_reported: 'bg-red-100 text-red-800 border-red-200',
  fault_resolved: 'bg-green-100 text-green-800 border-green-200',
  document_uploaded: 'bg-blue-100 text-blue-800 border-blue-200',
  document_published: 'bg-green-100 text-green-800 border-green-200',
  document_archived: 'bg-gray-100 text-gray-600 border-gray-200',
  document_superseded: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  maintenance_plan_created: 'bg-blue-100 text-blue-800 border-blue-200',
  maintenance_plan_activated: 'bg-green-100 text-green-800 border-green-200',
  maintenance_plan_paused: 'bg-orange-100 text-orange-800 border-orange-200',
  maintenance_plan_resumed: 'bg-green-100 text-green-800 border-green-200',
  maintenance_plan_archived: 'bg-gray-100 text-gray-600 border-gray-200',
  maintenance_plan_completed: 'bg-green-100 text-green-800 border-green-200',
  maintenance_plan_updated: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  preventive_task_completed: 'bg-green-100 text-green-800 border-green-200',
  lubrication_completed: 'bg-green-100 text-green-800 border-green-200',
  parts_consumed: 'bg-blue-100 text-blue-800 border-blue-200',
  parts_returned: 'bg-green-100 text-green-800 border-green-200',
  parts_adjusted: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  ai_recommendation_generated: 'bg-blue-100 text-blue-800 border-blue-200',
};

export const CATEGORY_ICONS: Record<MachineTimelineCategory, IconComponent> = {
  preventive: WrenchScrewdriverIcon,
  corrective: ClipboardDocumentListIcon,
  reports: DocumentTextIcon,
  faults: ExclamationTriangleIcon,
  documents: DocumentCheckIcon,
  plans: CalendarDaysIcon,
  inventory: CubeIcon,
  ai: SparklesIcon,
  system: CpuChipIcon,
};

export const CATEGORY_COLOR_CLASSES: Record<MachineTimelineCategory, string> = {
  preventive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  corrective: 'bg-orange-50 text-orange-700 border-orange-200',
  reports: 'bg-sky-50 text-sky-700 border-sky-200',
  faults: 'bg-red-50 text-red-700 border-red-200',
  documents: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  plans: 'bg-violet-50 text-violet-700 border-violet-200',
  inventory: 'bg-amber-50 text-amber-700 border-amber-200',
  ai: 'bg-blue-50 text-blue-700 border-blue-200',
  system: 'bg-slate-50 text-slate-700 border-slate-200',
};

export const TIMELINE_CATEGORIES: MachineTimelineCategory[] = [
  'preventive',
  'corrective',
  'reports',
  'faults',
  'documents',
  'plans',
  'inventory',
  'ai',
  'system',
];
