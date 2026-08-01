import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  DocumentEntity,
  DocumentDocument,
} from '../../schemas/document.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../../schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { User, UserDocument } from '../../schemas/user.schema';
import {
  ReportDataProvider,
  ReportDataset,
  ReportParams,
} from '../report.interfaces';
import { ReportType } from '../../schemas/generated-report.schema';

type FlatAuditEntry = {
  at: Date;
  entityType: 'document' | 'maintenance_plan' | 'work_order';
  entityId: string;
  action: string;
  fromStatus?: string;
  toStatus: string;
  actorUserId?: string;
  reason?: string;
};

const DEFAULT_LIMIT = 1000;

/**
 * Flattens the `lifecycle_history` array every Document and MaintenancePlan
 * already records on every status transition (published, archived,
 * revised, ...) into one time-ordered audit trail. Reads data that's
 * already being written by those two features' own lifecycle-transition
 * code — nothing here records a new fact, it only reports on facts
 * already recorded, which is the entire point of a reports module.
 * Admin-only: this crosses entities and surfaces every actor's identity,
 * broader than any single role's normal visibility.
 */
@Injectable()
export class AuditHistoryReportProvider implements ReportDataProvider {
  readonly type = ReportType.AUDIT_HISTORY;

  constructor(
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async buildDataset(params: ReportParams): Promise<ReportDataset> {
    const [documents, plans, workOrders] = await Promise.all([
      this.documentModel
        .find({})
        .select({ document_id: 1, lifecycle_history: 1 })
        .exec(),
      this.maintenancePlanModel
        .find({})
        .select({ plan_id: 1, lifecycle_history: 1 })
        .exec(),
      this.workOrderModel
        .find({})
        .select({ ot_id: 1, lifecycle_history: 1 })
        .exec(),
    ]);

    const entries: FlatAuditEntry[] = [];
    for (const doc of documents) {
      for (const entry of doc.lifecycle_history ?? []) {
        entries.push({
          at: entry.at,
          entityType: 'document',
          entityId: doc.document_id,
          action: entry.action,
          fromStatus: entry.from_status,
          toStatus: entry.to_status,
          actorUserId: entry.actor_user_id?.toString(),
          reason: entry.reason,
        });
      }
    }
    for (const plan of plans) {
      for (const entry of plan.lifecycle_history ?? []) {
        entries.push({
          at: entry.at,
          entityType: 'maintenance_plan',
          entityId: plan.plan_id,
          action: entry.action,
          fromStatus: entry.from_status,
          toStatus: entry.to_status,
          actorUserId: entry.actor_user_id?.toString(),
          reason: entry.reason,
        });
      }
    }
    for (const workOrder of workOrders) {
      for (const entry of workOrder.lifecycle_history ?? []) {
        entries.push({
          at: entry.at,
          entityType: 'work_order',
          entityId: workOrder.ot_id,
          action: entry.action,
          fromStatus: entry.from_status,
          toStatus: entry.to_status,
          actorUserId: entry.actor_user_id?.toString(),
          reason: entry.reason,
        });
      }
    }

    const filtered = entries.filter((entry) => {
      if (params.dateFrom && entry.at < params.dateFrom) return false;
      if (params.dateTo && entry.at >= params.dateTo) return false;
      return true;
    });
    filtered.sort((a, b) => b.at.getTime() - a.at.getTime());
    const limited = filtered.slice(0, params.limit ?? DEFAULT_LIMIT);

    const actorIds = [
      ...new Set(limited.map((e) => e.actorUserId).filter(Boolean)),
    ] as string[];
    const actors = actorIds.length
      ? await this.userModel
          .find({ _id: { $in: actorIds.map((id) => new Types.ObjectId(id)) } })
          .select({ nom_complet: 1 })
          .exec()
      : [];
    const actorNameById = new Map(
      actors.map((a) => [a._id.toString(), a.nom_complet]),
    );

    const rows = limited.map((entry) => ({
      date: entry.at.toISOString(),
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      from_status: entry.fromStatus ?? '',
      to_status: entry.toStatus,
      actor: entry.actorUserId
        ? (actorNameById.get(entry.actorUserId) ?? entry.actorUserId)
        : '',
      reason: entry.reason ?? '',
    }));

    return {
      title: 'Audit History Report',
      generatedAt: new Date(),
      parameters: { ...params },
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'entity_type', label: 'Entity Type' },
        { key: 'entity_id', label: 'Entity' },
        { key: 'action', label: 'Action' },
        { key: 'from_status', label: 'From Status' },
        { key: 'to_status', label: 'To Status' },
        { key: 'actor', label: 'Actor' },
        { key: 'reason', label: 'Reason' },
      ],
      rows,
      summary: [{ label: 'Total entries', value: rows.length }],
    };
  }
}
