import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import {
  WorkOrder,
  WorkOrderDocument,
  WorkOrderLifecycleAction,
} from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { FaultEvent, FaultEventDocument } from '../schemas/fault-event.schema';
import {
  DocumentEntity,
  DocumentDocument,
  DocumentLifecycleAction,
} from '../schemas/document.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
  MaintenancePlanLifecycleAction,
} from '../schemas/maintenance-plan.schema';
import {
  PreventiveTask,
  PreventiveTaskDocument,
} from '../schemas/preventive-task.schema';
import {
  LubrificationLog,
  LubrificationLogDocument,
} from '../schemas/lubrification-log.schema';
import {
  StockMovement,
  StockMovementDocument,
  StockMovementType,
} from '../schemas/stock-movement.schema';
import {
  AiInteraction,
  AiInteractionDocument,
  AiInteractionStatus,
} from '../schemas/ai-interaction.schema';
import { User, UserDocument } from '../schemas/user.schema';
import {
  PaginatedResponse,
  normalizePagination,
  toPaginatedResponse,
} from '../common/pagination';
import {
  buildCaseInsensitiveSearchFilter,
  parseCsvParam,
} from '../common/query-params.util';
import { buildDateRangeFilter } from '../reports/report-date-filter.util';
import {
  CLOSED_WORK_ORDER_STATUSES,
  COMPLETED_WORK_ORDER_STATUSES,
} from '../common/work-order-status';
import { SAFE_USER_PROJECTION } from '../users/safe-user-projection';
import { MachineTimelineQueryDto } from './dto/machine-timeline-query.dto';
import {
  MachineTimelineCategory,
  MachineTimelineEvent,
  MachineTimelineEventType,
  MachineTimelineSummary,
  TimelineRelatedEntity,
} from './machine-timeline.types';

const WORK_ORDER_LIFECYCLE_TYPES: Partial<
  Record<WorkOrderLifecycleAction, MachineTimelineEventType>
> = {
  closed_for_validation: MachineTimelineEventType.WORK_ORDER_CLOSED,
  validated: MachineTimelineEventType.WORK_ORDER_VALIDATED,
  rejected: MachineTimelineEventType.WORK_ORDER_REJECTED,
  returned: MachineTimelineEventType.WORK_ORDER_RETURNED,
};

const WORK_ORDER_LIFECYCLE_TITLES: Record<string, string> = {
  closed_for_validation: 'Work order closed for validation',
  validated: 'Work order validated',
  rejected: 'Work order rejected',
  returned: 'Work order returned to technician',
};

const DOCUMENT_LIFECYCLE_TYPES: Partial<
  Record<DocumentLifecycleAction, MachineTimelineEventType>
> = {
  created: MachineTimelineEventType.DOCUMENT_UPLOADED,
  published: MachineTimelineEventType.DOCUMENT_PUBLISHED,
  archived: MachineTimelineEventType.DOCUMENT_ARCHIVED,
  superseded: MachineTimelineEventType.DOCUMENT_SUPERSEDED,
};

const DOCUMENT_EVENT_TITLES: Partial<Record<MachineTimelineEventType, string>> = {
  [MachineTimelineEventType.DOCUMENT_UPLOADED]: 'Document uploaded',
  [MachineTimelineEventType.DOCUMENT_PUBLISHED]: 'Document published',
  [MachineTimelineEventType.DOCUMENT_ARCHIVED]: 'Document archived',
  [MachineTimelineEventType.DOCUMENT_SUPERSEDED]: 'Document superseded',
};

const PLAN_LIFECYCLE_TYPES: Partial<
  Record<MaintenancePlanLifecycleAction, MachineTimelineEventType>
> = {
  created: MachineTimelineEventType.MAINTENANCE_PLAN_CREATED,
  activated: MachineTimelineEventType.MAINTENANCE_PLAN_ACTIVATED,
  paused: MachineTimelineEventType.MAINTENANCE_PLAN_PAUSED,
  resumed: MachineTimelineEventType.MAINTENANCE_PLAN_RESUMED,
  archived: MachineTimelineEventType.MAINTENANCE_PLAN_ARCHIVED,
  completed: MachineTimelineEventType.MAINTENANCE_PLAN_COMPLETED,
  updated: MachineTimelineEventType.MAINTENANCE_PLAN_UPDATED,
};

const PLAN_EVENT_TITLES: Partial<Record<MachineTimelineEventType, string>> = {
  [MachineTimelineEventType.MAINTENANCE_PLAN_CREATED]: 'Maintenance plan created',
  [MachineTimelineEventType.MAINTENANCE_PLAN_ACTIVATED]: 'Maintenance plan activated',
  [MachineTimelineEventType.MAINTENANCE_PLAN_PAUSED]: 'Maintenance plan paused',
  [MachineTimelineEventType.MAINTENANCE_PLAN_RESUMED]: 'Maintenance plan resumed',
  [MachineTimelineEventType.MAINTENANCE_PLAN_ARCHIVED]: 'Maintenance plan archived',
  [MachineTimelineEventType.MAINTENANCE_PLAN_COMPLETED]: 'Maintenance plan completed',
  [MachineTimelineEventType.MAINTENANCE_PLAN_UPDATED]: 'Maintenance plan updated',
};

const STOCK_MOVEMENT_TYPES: Partial<
  Record<StockMovementType, MachineTimelineEventType>
> = {
  [StockMovementType.CONSUMPTION]: MachineTimelineEventType.PARTS_CONSUMED,
  [StockMovementType.RETURN]: MachineTimelineEventType.PARTS_RETURNED,
  [StockMovementType.ADJUSTMENT]: MachineTimelineEventType.PARTS_ADJUSTED,
};

const STOCK_EVENT_TITLES: Partial<Record<MachineTimelineEventType, string>> = {
  [MachineTimelineEventType.PARTS_CONSUMED]: 'Parts consumed',
  [MachineTimelineEventType.PARTS_RETURNED]: 'Parts returned',
  [MachineTimelineEventType.PARTS_ADJUSTED]: 'Stock adjusted',
};

function categoryForMaintenanceType(
  typeMaintenance?: string,
): MachineTimelineCategory {
  return typeMaintenance && /preventive/i.test(typeMaintenance)
    ? MachineTimelineCategory.PREVENTIVE
    : MachineTimelineCategory.CORRECTIVE;
}

/**
 * Builds one machine's timeline by merging events synthesized from every
 * collection that already references it (directly via `machine_id`, or one
 * hop away via `work_order_id`/`module_id`) — nothing here writes new
 * facts, it only reads and reshapes facts other features already record.
 * A single cohesive service rather than a provider-per-domain registry
 * (unlike `reports/providers/*`, which is a user-selectable plugin system):
 * the timeline always merges every source, so there is nothing to select
 * between.
 */
@Injectable()
export class MachineTimelineService {
  constructor(
    @InjectModel(Machine.name) private readonly machineModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    @InjectModel(FaultEvent.name)
    private readonly faultEventModel: Model<FaultEventDocument>,
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(PreventiveTask.name)
    private readonly preventiveTaskModel: Model<PreventiveTaskDocument>,
    @InjectModel(LubrificationLog.name)
    private readonly lubricationLogModel: Model<LubrificationLogDocument>,
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovementDocument>,
    @InjectModel(AiInteraction.name)
    private readonly aiInteractionModel: Model<AiInteractionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async getSummary(machineId: string): Promise<MachineTimelineSummary> {
    this.assertObjectId(machineId);
    const machineObjectId = new Types.ObjectId(machineId);
    const machine = await this.machineModel
      .findById(machineObjectId)
      .populate('type_id', 'name')
      .exec();
    if (!machine) throw new NotFoundException('Machine not found');

    const moduleIds = await this.moduleModel
      .distinct('_id', { machine_id: machineObjectId })
      .exec();
    const workOrderIds = await this.workOrderModel
      .distinct('_id', { machine_id: machineObjectId })
      .exec();

    const [workOrders, partsConsumedAgg, lastPreventiveTask, lastLubrication] =
      await Promise.all([
        this.workOrderModel
          .find({ machine_id: machineObjectId })
          .select({
            status: 1,
            type_maintenance: 1,
            date_start: 1,
            date_end: 1,
            due_date: 1,
            scheduled_date: 1,
          })
          .exec(),
        this.stockMovementModel
          .aggregate<{ total: number }>([
            {
              $match: {
                work_order_id: { $in: workOrderIds },
                type: StockMovementType.CONSUMPTION,
              },
            },
            { $group: { _id: null, total: { $sum: { $abs: '$quantity_delta' } } } },
          ])
          .exec(),
        this.preventiveTaskModel
          .findOne({ module_id: { $in: moduleIds }, status: 'completed' })
          .sort({ completed_at: -1 })
          .exec(),
        this.lubricationLogModel
          .findOne({ module_id: { $in: moduleIds } })
          .sort({ date_application: -1 })
          .exec(),
      ]);

    let openWorkOrders = 0;
    let closedWorkOrders = 0;
    let preventiveCompleted = 0;
    let correctiveCompleted = 0;
    let downtimeMs = 0;
    let downtimeCount = 0;
    let lastMaintenanceAt: Date | null = null;
    let nextMaintenanceAt: Date | null = null;
    const now = new Date();

    for (const wo of workOrders) {
      const closed = CLOSED_WORK_ORDER_STATUSES.includes(wo.status);
      const completed = COMPLETED_WORK_ORDER_STATUSES.includes(wo.status);
      if (closed) closedWorkOrders++;
      else openWorkOrders++;

      if (completed) {
        if (categoryForMaintenanceType(wo.type_maintenance) === MachineTimelineCategory.PREVENTIVE) {
          preventiveCompleted++;
        } else {
          correctiveCompleted++;
        }
        if (wo.date_end && (!lastMaintenanceAt || wo.date_end > lastMaintenanceAt)) {
          lastMaintenanceAt = wo.date_end;
        }
      }

      if (wo.date_start && wo.date_end) {
        downtimeMs += wo.date_end.getTime() - wo.date_start.getTime();
        downtimeCount++;
      }

      const dueCandidate = wo.due_date ?? wo.scheduled_date;
      if (
        !closed &&
        dueCandidate &&
        dueCandidate >= now &&
        (!nextMaintenanceAt || dueCandidate < nextMaintenanceAt)
      ) {
        nextMaintenanceAt = dueCandidate;
      }
    }

    if (
      lastPreventiveTask?.completed_at &&
      (!lastMaintenanceAt || lastPreventiveTask.completed_at > lastMaintenanceAt)
    ) {
      lastMaintenanceAt = lastPreventiveTask.completed_at;
    }
    if (
      lastLubrication?.date_application &&
      (!lastMaintenanceAt || lastLubrication.date_application > lastMaintenanceAt)
    ) {
      lastMaintenanceAt = lastLubrication.date_application;
    }

    const downtimeHours = downtimeMs / 3_600_000;
    const averageRepairTimeHours = downtimeCount > 0 ? downtimeHours / downtimeCount : null;
    const partsConsumed = partsConsumedAgg[0]?.total ?? 0;

    const machineType = machine.type_id as unknown as
      | { _id?: unknown; name?: string }
      | undefined;
    const createdAt = (machine as unknown as { createdAt?: Date }).createdAt;
    const ageSource = machine.installation_date ?? createdAt;
    const ageDays = ageSource
      ? Math.floor((now.getTime() - ageSource.getTime()) / 86_400_000)
      : null;

    return {
      machine: {
        id: machine._id.toString(),
        machineId: machine.machine_id,
        serialNo: machine.serial_no,
        reference: machine.reference,
        type:
          machineType?.name && machineType._id
            ? { id: this.idString(machineType) ?? '', name: machineType.name }
            : null,
        fabricant: machine.fabricant,
        model: machine.model,
        location: machine.location,
        status: machine.status,
        installationDate: machine.installation_date,
        createdAt,
        ageDays,
      },
      stats: {
        totalInterventions: workOrders.length,
        preventiveCompleted,
        correctiveCompleted,
        openWorkOrders,
        closedWorkOrders,
        downtimeHours: Math.round(downtimeHours * 100) / 100,
        averageRepairTimeHours:
          averageRepairTimeHours !== null
            ? Math.round(averageRepairTimeHours * 100) / 100
            : null,
        partsConsumed,
        lastMaintenanceAt,
        nextMaintenanceAt,
        lastInspectionAt: lastPreventiveTask?.completed_at ?? null,
        lastLubricationAt: lastLubrication?.date_application ?? null,
      },
    };
  }

  async getTimeline(
    machineId: string,
    query: MachineTimelineQueryDto,
  ): Promise<PaginatedResponse<MachineTimelineEvent>> {
    this.assertObjectId(machineId);
    const machineObjectId = new Types.ObjectId(machineId);
    const machine = await this.machineModel.findById(machineObjectId).exec();
    if (!machine) throw new NotFoundException('Machine not found');

    const moduleIds = await this.moduleModel
      .distinct('_id', { machine_id: machineObjectId })
      .exec();
    const workOrders = await this.workOrderModel
      .find({ machine_id: machineObjectId })
      .exec();
    const workOrderIds = workOrders.map((wo) => wo._id);
    const workOrderById = new Map(workOrders.map((wo) => [wo._id.toString(), wo]));

    const [
      modules,
      interventionReports,
      faultEvents,
      documents,
      maintenancePlans,
      preventiveTasks,
      lubricationLogs,
      stockMovements,
      aiInteractions,
    ] = await Promise.all([
      this.moduleModel.find({ machine_id: machineObjectId }).exec(),
      this.interventionReportModel.find({ ot_id: { $in: workOrderIds } }).exec(),
      this.faultEventModel.find({ machine_id: machineObjectId }).exec(),
      this.documentModel.find({ machine_id: machineObjectId }).exec(),
      this.maintenancePlanModel.find({ module_id: { $in: moduleIds } }).exec(),
      this.preventiveTaskModel
        .find({ module_id: { $in: moduleIds }, status: 'completed' })
        .exec(),
      this.lubricationLogModel
        .find({ module_id: { $in: moduleIds } })
        .populate('lubrifiant_id', 'nom')
        .exec(),
      this.stockMovementModel
        .find({ work_order_id: { $in: workOrderIds } })
        .populate('part_id', 'nom_piece ref_constructeur')
        .exec(),
      this.aiInteractionModel
        .find({ machine_id: machineObjectId, status: AiInteractionStatus.OK })
        .exec(),
    ]);

    const events: MachineTimelineEvent[] = [
      ...this.machineEvents(machine),
      ...modules.flatMap((m) => this.moduleEvents(m)),
      ...workOrders.flatMap((wo) => this.workOrderEvents(wo)),
      ...interventionReports.flatMap((r) =>
        this.interventionReportEvents(r, workOrderById),
      ),
      ...faultEvents.flatMap((f) => this.faultEventEvents(f)),
      ...documents.flatMap((d) => this.documentEvents(d)),
      ...maintenancePlans.flatMap((p) => this.maintenancePlanEvents(p)),
      ...preventiveTasks.flatMap((t) => this.preventiveTaskEvents(t)),
      ...lubricationLogs.flatMap((l) => this.lubricationLogEvents(l)),
      ...stockMovements.flatMap((s) => this.stockMovementEvents(s)),
      ...aiInteractions.flatMap((a) => this.aiInteractionEvents(a)),
    ];

    await this.resolveActors(events);

    let filtered = events;
    const types = parseCsvParam(query.types);
    if (types?.length) {
      const typeSet = new Set(types);
      filtered = filtered.filter((event) => typeSet.has(event.category));
    }

    if (query.dateFrom || query.dateTo) {
      const dateFilter = buildDateRangeFilter(
        query.dateFrom ? new Date(query.dateFrom) : undefined,
        query.dateTo ? new Date(query.dateTo) : undefined,
      );
      if (dateFilter) {
        filtered = filtered.filter((event) => {
          if (dateFilter.$gte && event.at < dateFilter.$gte) return false;
          if (dateFilter.$lt && event.at >= dateFilter.$lt) return false;
          return true;
        });
      }
    }

    if (query.search) {
      const pattern = buildCaseInsensitiveSearchFilter(query.search);
      filtered = filtered.filter((event) => this.matchesSearch(event, pattern));
    }

    filtered.sort((a, b) => b.at.getTime() - a.at.getTime());

    const { page, limit, skip } = normalizePagination(query.page, query.limit, 20, 100);
    const pageItems = filtered.slice(skip, skip + limit);
    return toPaginatedResponse(pageItems, filtered.length, page, limit);
  }

  private machineEvents(machine: MachineDocument): MachineTimelineEvent[] {
    const events: MachineTimelineEvent[] = [];
    const history = machine.lifecycle_history ?? [];
    const machineIdStr = machine._id.toString();
    const createdEntry = history.find((entry) => entry.action === 'created');
    const createdAt =
      createdEntry?.at ?? (machine as unknown as { createdAt?: Date }).createdAt;

    if (createdAt) {
      events.push({
        id: `machine_created_${machineIdStr}`,
        type: MachineTimelineEventType.MACHINE_CREATED,
        category: MachineTimelineCategory.SYSTEM,
        at: createdAt,
        title: 'Machine created',
        description: `Machine ${machine.machine_id} was added to the system`,
        metadata: { machineCode: machine.machine_id },
      });
    }

    for (const entry of history) {
      if (entry.action !== 'status_changed') continue;
      events.push({
        id: `machine_status_${machineIdStr}_${entry.at.getTime()}`,
        type: MachineTimelineEventType.MACHINE_STATUS_CHANGED,
        category: MachineTimelineCategory.SYSTEM,
        at: entry.at,
        title: 'Machine status changed',
        description: `Status changed from "${entry.from_status ?? 'unknown'}" to "${entry.to_status}"`,
        actorUserId: entry.actor_user_id ? this.idString(entry.actor_user_id) : undefined,
        machineStatus: entry.to_status,
        metadata: { fromStatus: entry.from_status, toStatus: entry.to_status },
      });
    }

    return events;
  }

  private moduleEvents(module: ModuleDocument): MachineTimelineEvent[] {
    const createdAt = (module as unknown as { createdAt?: Date }).createdAt;
    if (!createdAt) return [];
    return [
      {
        id: `module_added_${module._id.toString()}`,
        type: MachineTimelineEventType.MODULE_ADDED,
        category: MachineTimelineCategory.SYSTEM,
        at: createdAt,
        title: 'Module added',
        description: `Module ${module.module_id} was added to the machine`,
        metadata: { moduleCode: module.module_id },
      },
    ];
  }

  private workOrderEvents(wo: WorkOrderDocument): MachineTimelineEvent[] {
    const events: MachineTimelineEvent[] = [];
    const woId = wo._id.toString();
    const category = categoryForMaintenanceType(wo.type_maintenance);
    const related: TimelineRelatedEntity = {
      kind: 'work_order',
      id: woId,
      refCode: wo.ot_id,
    };
    const technicianActorId = wo.technician_id
      ? this.idString(wo.technician_id)
      : undefined;

    if (wo.date_created) {
      events.push({
        id: `wo_created_${woId}`,
        type: MachineTimelineEventType.WORK_ORDER_CREATED,
        category,
        at: wo.date_created,
        title: 'Work order created',
        description: wo.description || `Work order ${wo.ot_id} was created`,
        relatedEntity: related,
        metadata: { otId: wo.ot_id, priority: wo.priorite, faultCode: wo.code_panne },
      });
    }

    if (wo.date_start) {
      events.push({
        id: `wo_started_${woId}`,
        type: MachineTimelineEventType.WORK_ORDER_STARTED,
        category,
        at: wo.date_start,
        title: 'Work order started',
        description: `Work order ${wo.ot_id} was started`,
        actorUserId: technicianActorId,
        relatedEntity: related,
        metadata: { otId: wo.ot_id },
      });
    }

    if (wo.date_end) {
      const cancelled =
        CLOSED_WORK_ORDER_STATUSES.includes(wo.status) &&
        !COMPLETED_WORK_ORDER_STATUSES.includes(wo.status);
      events.push({
        id: `wo_ended_${woId}`,
        type: cancelled
          ? MachineTimelineEventType.WORK_ORDER_CANCELLED
          : MachineTimelineEventType.WORK_ORDER_COMPLETED,
        category,
        at: wo.date_end,
        title: cancelled ? 'Work order cancelled' : 'Work order completed',
        description: `Work order ${wo.ot_id} was ${cancelled ? 'cancelled' : 'completed'}`,
        actorUserId: technicianActorId,
        machineStatus: wo.status,
        relatedEntity: related,
        metadata: { otId: wo.ot_id },
      });
    }

    if (wo.date_closed) {
      events.push({
        id: `wo_closed_${woId}`,
        type: MachineTimelineEventType.WORK_ORDER_CLOSED,
        category,
        at: wo.date_closed,
        title: 'Work order closed',
        description: `Work order ${wo.ot_id} was closed`,
        relatedEntity: related,
        metadata: { otId: wo.ot_id },
      });
    }

    for (const entry of wo.lifecycle_history ?? []) {
      const type = WORK_ORDER_LIFECYCLE_TYPES[entry.action];
      if (!type) continue;
      events.push({
        id: `wo_lifecycle_${woId}_${entry.action}_${entry.at.getTime()}`,
        type,
        category,
        at: entry.at,
        title: WORK_ORDER_LIFECYCLE_TITLES[entry.action],
        description:
          entry.reason || `Work order ${wo.ot_id}: ${entry.action.replace(/_/g, ' ')}`,
        actorUserId: entry.actor_user_id ? this.idString(entry.actor_user_id) : undefined,
        relatedEntity: related,
        metadata: { otId: wo.ot_id, fromStatus: entry.from_status, toStatus: entry.to_status },
      });
    }

    return events;
  }

  private interventionReportEvents(
    report: InterventionReportDocument,
    workOrderById: Map<string, WorkOrderDocument>,
  ): MachineTimelineEvent[] {
    const events: MachineTimelineEvent[] = [];
    const wo = workOrderById.get(report.ot_id.toString());
    const related: TimelineRelatedEntity = {
      kind: 'intervention_report',
      id: report._id.toString(),
      refCode: report.report_id,
    };
    const at = report.date_fin ?? report.date_debut;

    if (at) {
      events.push({
        id: `report_created_${report._id.toString()}`,
        type: MachineTimelineEventType.INTERVENTION_REPORT_CREATED,
        category: MachineTimelineCategory.REPORTS,
        at,
        title: 'Intervention report submitted',
        description:
          report.cause_racine || report.description_action || `Report ${report.report_id}`,
        actorUserId: this.idString(report.technician_id),
        relatedEntity: related,
        metadata: {
          reportId: report.report_id,
          otId: wo?.ot_id,
          rootCause: report.cause_racine,
          actionTaken: report.description_action,
          finalState: report.etat_final,
        },
      });
    }

    if (report.validated_at) {
      events.push({
        id: `report_validated_${report._id.toString()}`,
        type: MachineTimelineEventType.INTERVENTION_REPORT_VALIDATED,
        category: MachineTimelineCategory.REPORTS,
        at: report.validated_at,
        title: 'Intervention report validated',
        description: `Report ${report.report_id} was validated`,
        actorUserId: report.validated_by ? this.idString(report.validated_by) : undefined,
        relatedEntity: related,
        metadata: { reportId: report.report_id },
      });
    }

    return events;
  }

  private faultEventEvents(fault: FaultEventDocument): MachineTimelineEvent[] {
    const events: MachineTimelineEvent[] = [];
    const related: TimelineRelatedEntity = {
      kind: 'fault_event',
      id: fault._id.toString(),
      refCode: fault.code_panne,
    };

    events.push({
      id: `fault_raised_${fault._id.toString()}`,
      type: MachineTimelineEventType.FAULT_REPORTED,
      category: MachineTimelineCategory.FAULTS,
      at: fault.raised_at,
      title: 'Fault reported',
      description: fault.message || `Fault ${fault.code_panne} (${fault.severity})`,
      machineStatus: fault.severity,
      relatedEntity: related,
      metadata: { faultCode: fault.code_panne, severity: fault.severity },
    });

    if (fault.resolved_at) {
      events.push({
        id: `fault_resolved_${fault._id.toString()}`,
        type: MachineTimelineEventType.FAULT_RESOLVED,
        category: MachineTimelineCategory.FAULTS,
        at: fault.resolved_at,
        title: 'Fault resolved',
        description: `Fault ${fault.code_panne} was resolved`,
        actorUserId: fault.resolved_by ? this.idString(fault.resolved_by) : undefined,
        relatedEntity: related,
        metadata: { faultCode: fault.code_panne },
      });
    }

    return events;
  }

  private documentEvents(doc: DocumentDocument): MachineTimelineEvent[] {
    const related: TimelineRelatedEntity = {
      kind: 'document',
      id: doc._id.toString(),
      refCode: doc.document_id,
    };
    const events: MachineTimelineEvent[] = [];

    for (const entry of doc.lifecycle_history ?? []) {
      const type = DOCUMENT_LIFECYCLE_TYPES[entry.action];
      if (!type) continue;
      events.push({
        id: `document_${entry.action}_${doc._id.toString()}_${entry.at.getTime()}`,
        type,
        category: MachineTimelineCategory.DOCUMENTS,
        at: entry.at,
        title: DOCUMENT_EVENT_TITLES[type] ?? 'Document updated',
        description: entry.reason || `${doc.file_name} (${doc.type_document})`,
        actorUserId: entry.actor_user_id ? this.idString(entry.actor_user_id) : undefined,
        relatedEntity: related,
        metadata: {
          documentId: doc.document_id,
          fileName: doc.file_name,
          typeDocument: doc.type_document,
        },
      });
    }

    if (!events.length && doc.date_ajout) {
      events.push({
        id: `document_uploaded_${doc._id.toString()}`,
        type: MachineTimelineEventType.DOCUMENT_UPLOADED,
        category: MachineTimelineCategory.DOCUMENTS,
        at: doc.date_ajout,
        title: 'Document uploaded',
        description: `${doc.file_name} (${doc.type_document})`,
        metadata: {
          documentId: doc.document_id,
          fileName: doc.file_name,
          typeDocument: doc.type_document,
        },
      });
    }

    return events;
  }

  private maintenancePlanEvents(plan: MaintenancePlanDocument): MachineTimelineEvent[] {
    const related: TimelineRelatedEntity = {
      kind: 'maintenance_plan',
      id: plan._id.toString(),
      refCode: plan.plan_id,
    };
    const events: MachineTimelineEvent[] = [];

    for (const entry of plan.lifecycle_history ?? []) {
      const type = PLAN_LIFECYCLE_TYPES[entry.action];
      if (!type) continue;
      events.push({
        id: `plan_${entry.action}_${plan._id.toString()}_${entry.at.getTime()}`,
        type,
        category: MachineTimelineCategory.PLANS,
        at: entry.at,
        title: PLAN_EVENT_TITLES[type] ?? 'Maintenance plan updated',
        description: entry.reason || `Plan ${plan.plan_id} (${plan.type_maintenance})`,
        actorUserId: entry.actor_user_id ? this.idString(entry.actor_user_id) : undefined,
        relatedEntity: related,
        metadata: { planId: plan.plan_id, typeMaintenance: plan.type_maintenance },
      });
    }

    return events;
  }

  private preventiveTaskEvents(task: PreventiveTaskDocument): MachineTimelineEvent[] {
    if (!task.completed_at) return [];
    return [
      {
        id: `preventive_task_${task._id.toString()}`,
        type: MachineTimelineEventType.PREVENTIVE_TASK_COMPLETED,
        category: MachineTimelineCategory.PREVENTIVE,
        at: task.completed_at,
        title: 'Preventive task completed',
        description: task.instruction,
        metadata: {
          taskId: task.task_id,
          responsable: task.responsable,
          notes: task.notes,
          source: task.source,
        },
      },
    ];
  }

  private lubricationLogEvents(log: LubrificationLogDocument): MachineTimelineEvent[] {
    const lubrifiant = log.lubrifiant_id as unknown as { nom?: string } | undefined;
    return [
      {
        id: `lubrication_${log._id.toString()}`,
        type: MachineTimelineEventType.LUBRICATION_COMPLETED,
        category: MachineTimelineCategory.PREVENTIVE,
        at: log.date_application,
        title: 'Lubrication completed',
        description: lubrifiant?.nom
          ? `Applied ${lubrifiant.nom} (${log.quantite})`
          : `Lubrication logged (${log.quantite})`,
        actorUserId: this.idString(log.technician_id),
        metadata: { logId: log.log_id, quantity: log.quantite },
      },
    ];
  }

  private stockMovementEvents(movement: StockMovementDocument): MachineTimelineEvent[] {
    const type = STOCK_MOVEMENT_TYPES[movement.type];
    if (!type) return [];
    const part = movement.part_id as unknown as
      | { nom_piece?: string; ref_constructeur?: string }
      | undefined;
    const quantity = Math.abs(movement.quantity_delta);
    const createdAt = (movement as unknown as { createdAt?: Date }).createdAt;
    if (!createdAt) return [];

    return [
      {
        id: `stock_${movement._id.toString()}`,
        type,
        category: MachineTimelineCategory.INVENTORY,
        at: createdAt,
        title: STOCK_EVENT_TITLES[type] ?? 'Stock movement',
        description: part?.nom_piece ? `${part.nom_piece} x${quantity}` : `${quantity} unit(s)`,
        actorUserId: movement.actor_user_id ? this.idString(movement.actor_user_id) : undefined,
        relatedEntity: movement.work_order_id
          ? { kind: 'work_order', id: this.idString(movement.work_order_id) ?? '' }
          : undefined,
        metadata: {
          movementId: movement.movement_id,
          partName: part?.nom_piece,
          partRef: part?.ref_constructeur,
          quantity,
        },
      },
    ];
  }

  private aiInteractionEvents(interaction: AiInteractionDocument): MachineTimelineEvent[] {
    const createdAt = (interaction as unknown as { createdAt?: Date }).createdAt;
    if (!createdAt) return [];
    return [
      {
        id: `ai_${interaction._id.toString()}`,
        type: MachineTimelineEventType.AI_RECOMMENDATION_GENERATED,
        category: MachineTimelineCategory.AI,
        at: createdAt,
        title: 'AI recommendation generated',
        description: interaction.question,
        actorUserId: this.idString(interaction.actor_user_id),
        relatedEntity: interaction.work_order_id
          ? { kind: 'work_order', id: this.idString(interaction.work_order_id) ?? '' }
          : undefined,
        metadata: { faultCode: interaction.fault_code, provider: interaction.provider },
      },
    ];
  }

  private matchesSearch(event: MachineTimelineEvent, pattern: RegExp): boolean {
    if (pattern.test(event.title)) return true;
    if (event.description && pattern.test(event.description)) return true;
    if (event.actor?.name && pattern.test(event.actor.name)) return true;
    if (event.relatedEntity?.refCode && pattern.test(event.relatedEntity.refCode)) return true;
    if (event.metadata) {
      for (const value of Object.values(event.metadata)) {
        if (typeof value === 'string' && pattern.test(value)) return true;
      }
    }
    return false;
  }

  private async resolveActors(events: MachineTimelineEvent[]): Promise<void> {
    const actorIds = [
      ...new Set(events.map((event) => event.actorUserId).filter((id): id is string => Boolean(id))),
    ];
    if (!actorIds.length) return;

    const actors = await this.userModel
      .find({ _id: { $in: actorIds.map((id) => new Types.ObjectId(id)) } })
      .select(SAFE_USER_PROJECTION)
      .exec();
    const actorById = new Map(
      actors.map((actor) => [
        actor._id.toString(),
        { id: actor._id.toString(), name: actor.nom_complet, role: actor.role as string },
      ]),
    );

    for (const event of events) {
      if (event.actorUserId) {
        event.actor = actorById.get(event.actorUserId);
      }
    }
  }

  private idString(
    value: Types.ObjectId | string | { _id?: unknown } | undefined,
  ): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'object' && '_id' in value) {
      return this.idString((value as { _id?: unknown })._id as never);
    }
    return undefined;
  }

  private assertObjectId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid machine id');
    }
  }
}
