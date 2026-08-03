import type { IndexDirection } from 'mongoose';
import {
  PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME,
  PREVENTIVE_OCCURRENCE_KEY_PARTIAL_FILTER,
} from '../work-orders/preventive-occurrence-key';

export interface RecommendedMongoIndex {
  collection: string;
  name: string;
  key: Record<string, IndexDirection>;
  options?: {
    partialFilterExpression?: Record<string, unknown>;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
  };
  rationale: string;
}

export const RECOMMENDED_MONGODB_INDEXES: RecommendedMongoIndex[] = [
  {
    collection: 'workorders',
    name: 'work_orders_machine_created_desc',
    key: { machine_id: 1, date_created: -1 },
    rationale:
      'Machine detail, machine timeline, AI context, and machine-history reports read work orders by machine and newest-first.',
  },
  {
    collection: 'workorders',
    name: 'work_orders_technician_created_desc',
    key: { technician_id: 1, date_created: -1 },
    rationale:
      'Operator/technician personal work-order lists filter by assignee and sort newest-first.',
  },
  {
    collection: 'workorders',
    name: PREVENTIVE_OCCURRENCE_KEY_INDEX_NAME,
    key: { preventive_occurrence_key: 1 },
    options: {
      unique: true,
      partialFilterExpression: PREVENTIVE_OCCURRENCE_KEY_PARTIAL_FILTER,
    },
    rationale:
      'Preventive scheduler upserts by deterministic occurrence key so concurrent runs cannot create duplicate next work orders.',
  },
  {
    collection: 'workorders',
    name: 'work_orders_plan_target_latest_desc',
    key: {
      plan_id: 1,
      machine_id: 1,
      module_id: 1,
      date_start: -1,
      date_created: -1,
    },
    rationale:
      'Preventive scheduler batches plans and finds the latest work order per plan/module/machine target without loading all historical work orders.',
  },
  {
    collection: 'preventivetasks',
    name: 'preventive_tasks_module_status_completed_desc',
    key: { module_id: 1, status: 1, completed_at: -1 },
    rationale:
      'Machine timeline and summary look up the latest completed checklist task for a machine module set.',
  },
  {
    collection: 'preventivetasks',
    name: 'preventive_tasks_active_status_created_desc',
    key: { status: 1, createdAt: -1 },
    rationale:
      'Admin/operator checklist pages filter active tasks by status and sort newest-first.',
  },
  {
    collection: 'lubrificationlogs',
    name: 'lubrification_logs_module_application_desc',
    key: { module_id: 1, date_application: -1 },
    rationale:
      'Machine timeline and summary query lubrication logs by module set and latest application date.',
  },
  {
    collection: 'interventionreports',
    name: 'intervention_reports_work_order_finished_desc',
    key: { ot_id: 1, date_fin: -1 },
    rationale:
      'Validation and machine-history paths find the latest intervention report for a work order.',
  },
  {
    collection: 'stockmovements',
    name: 'stock_movements_created_desc',
    key: { createdAt: -1 },
    rationale:
      'Stock movement reports scan date ranges and sort newest-first across the full ledger.',
  },
  {
    collection: 'stockmovements',
    name: 'stock_movements_work_order_type',
    key: { work_order_id: 1, type: 1 },
    rationale:
      'Machine timeline summary aggregates consumption movements across work-order ids.',
  },
  {
    collection: 'kpis',
    name: 'kpis_machine_calculated_desc',
    key: { machine_id: 1, date_calcul: -1 },
    rationale:
      'Operator KPI lists filter by accessible machines and sort by calculation date.',
  },
  {
    collection: 'generatedreports',
    name: 'generated_reports_status_created_desc',
    key: { status: 1, createdAt: -1 },
    rationale:
      'Report history filters by generation state and sorts newest-first.',
  },
  {
    collection: 'generatedreports',
    name: 'generated_reports_type_format_created_desc',
    key: { type: 1, format: 1, createdAt: -1 },
    rationale:
      'Admin report history commonly filters by report type/format and sorts newest-first.',
  },
  {
    collection: 'notifications',
    name: 'notifications_user_created_desc',
    key: { recipient_user_id: 1, createdAt: -1 },
    rationale:
      'Notification list/clear paths query user-targeted notifications without always filtering read state.',
  },
  {
    collection: 'notifications',
    name: 'notifications_role_created_desc',
    key: { recipient_role: 1, createdAt: -1 },
    rationale:
      'Notification list/clear paths query role-targeted notifications without always filtering read state.',
  },
  {
    collection: 'devices',
    name: 'devices_active_status',
    key: { is_active: 1, last_known_status: 1 },
    rationale:
      'The minute-level offline sweep scans active devices that are not already offline.',
  },
  {
    collection: 'users',
    name: 'users_reset_token_expires',
    key: { reset_password_token: 1, reset_password_expires: 1 },
    options: {
      partialFilterExpression: { reset_password_token: { $exists: true } },
    },
    rationale:
      'Password reset consumes a token only if it exists and is not expired.',
  },
];
