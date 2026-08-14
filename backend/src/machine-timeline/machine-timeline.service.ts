import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  readPopulatedField,
  readTimestamps,
} from '../common/response/serialization.util';
import { MachineTypeDocument } from '../schemas/machine-type.schema';
import { Catalogue } from '../schemas/catalogue.schema';
import { Lubrifiant } from '../schemas/lubrifiant.schema';
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
import { MachineTimelineEventResponse } from './contracts/machine-timeline-event-response.types';
import { toMachineTimelineEventResponse } from './contracts/machine-timeline-event.mapper';

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

const DOCUMENT_EVENT_TITLES: Partial<Record<MachineTimelineEventType, string>> =
  {
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
  [MachineTimelineEventType.MAINTENANCE_PLAN_CREATED]:
    'Maintenance plan created',
  [MachineTimelineEventType.MAINTENANCE_PLAN_ACTIVATED]:
    'Maintenance plan activated',
  [MachineTimelineEventType.MAINTENANCE_PLAN_PAUSED]: 'Maintenance plan paused',
  [MachineTimelineEventType.MAINTENANCE_PLAN_RESUMED]:
    'Maintenance plan resumed',
  [MachineTimelineEventType.MAINTENANCE_PLAN_ARCHIVED]:
    'Maintenance plan archived',
  [MachineTimelineEventType.MAINTENANCE_PLAN_COMPLETED]:
    'Maintenance plan completed',
  [MachineTimelineEventType.MAINTENANCE_PLAN_UPDATED]:
    'Maintenance plan updated',
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

interface WorkOrderSummaryStats {
  openWorkOrders: number;
  closedWorkOrders: number;
  preventiveCompleted: number;
  correctiveCompleted: number;
  downtimeMs: number;
  downtimeCount: number;
  lastMaintenanceAt: Date | null;
  nextMaintenanceAt: Date | null;
}

function categoryForMaintenanceType(
  typeMaintenance?: string,
): MachineTimelineCategory {
  if (typeMaintenance && /preventive/i.test(typeMaintenance)) {
    return MachineTimelineCategory.PREVENTIVE;
  }

  return MachineTimelineCategory.CORRECTIVE;
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
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
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
            {
              $group: {
                _id: null,
                total: { $sum: { $abs: '$quantity_delta' } },
              },
            },
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

    const now = new Date();
    const stats = this.summarizeWorkOrders(workOrders, now);
    const lastMaintenanceAt = this.latestDate(
      stats.lastMaintenanceAt,
      lastPreventiveTask?.completed_at,
      lastLubrication?.date_application,
    );

    const downtimeHours = stats.downtimeMs / 3_600_000;
    const averageRepairTimeHours =
      stats.downtimeCount > 0 ? downtimeHours / stats.downtimeCount : null;
    const partsConsumed = partsConsumedAgg[0]?.total ?? 0;

    const machineType = readPopulatedField<MachineTypeDocument>(
      machine.type_id,
    );
    const createdAt = readTimestamps(machine).createdAt;
    const ageSource = machine.installation_date ?? createdAt;

    return {
      machine: {
        id: machine._id.toString(),
        machineId: machine.machine_id,
        serialNo: machine.serial_no,
        reference: machine.reference,
        type: this.toMachineTypeSummary(machineType),
        fabricant: machine.fabricant,
        model: machine.model,
        location: machine.location,
        status: machine.status,
        installationDate: machine.installation_date,
        createdAt,
        ageDays: this.ageInDays(ageSource, now),
      },
      stats: {
        totalInterventions: workOrders.length,
        preventiveCompleted: stats.preventiveCompleted,
        correctiveCompleted: stats.correctiveCompleted,
        openWorkOrders: stats.openWorkOrders,
        closedWorkOrders: stats.closedWorkOrders,
        downtimeHours: Math.round(downtimeHours * 100) / 100,
        averageRepairTimeHours: this.roundNullableHours(averageRepairTimeHours),
        partsConsumed,
        lastMaintenanceAt,
        nextMaintenanceAt: stats.nextMaintenanceAt,
        lastInspectionAt: lastPreventiveTask?.completed_at ?? null,
        lastLubricationAt: lastLubrication?.date_application ?? null,
      },
    };
  }

  async getTimeline(
    machineId: string,
    query: MachineTimelineQueryDto,
  ): Promise<PaginatedResponse<MachineTimelineEventResponse>> {
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
    const workOrderById = new Map(
      workOrders.map((wo) => [wo._id.toString(), wo]),
    );

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
      this.interventionReportModel
        .find({ ot_id: { $in: workOrderIds } })
        .exec(),
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

    const filtered = this.filterTimelineEvents(events, query);
    filtered.sort((a, b) => b.at.getTime() - a.at.getTime());

    const { page, limit, skip } = normalizePagination(
      query.page,
      query.limit,
      20,
      100,
    );
    const pageItems = filtered.slice(skip, skip + limit);
    return toPaginatedResponse(
      pageItems.map(toMachineTimelineEventResponse),
      filtered.length,
      page,
      limit,
    );
  }

  private machineEvents(machine: MachineDocument): MachineTimelineEvent[] {
    const events: MachineTimelineEvent[] = [];
    const history = machine.lifecycle_history ?? [];
    const machineIdStr = machine._id.toString();
    const createdEntry = history.find((entry) => entry.action === 'created');
    const createdAt = createdEntry?.at ?? readTimestamps(machine).createdAt;

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
        actorUserId: entry.actor_user_id
          ? this.idString(entry.actor_user_id)
          : undefined,
        machineStatus: entry.to_status,
        metadata: { fromStatus: entry.from_status, toStatus: entry.to_status },
      });
    }

    return events;
  }

  private moduleEvents(module: ModuleDocument): MachineTimelineEvent[] {
    const createdAt = readTimestamps(module).createdAt;
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
        metadata: {
          otId: wo.ot_id,
          priority: wo.priorite,
          faultCode: wo.code_panne,
        },
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
      const endDetails = this.workOrderEndDetails(cancelled);
      events.push({
        id: `wo_ended_${woId}`,
        type: endDetails.type,
        category,
        at: wo.date_end,
        title: endDetails.title,
        description: `Work order ${wo.ot_id} was ${endDetails.verb}`,
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
          entry.reason ||
          `Work order ${wo.ot_id}: ${entry.action.replaceAll('_', ' ')}`,
        actorUserId: entry.actor_user_id
          ? this.idString(entry.actor_user_id)
          : undefined,
        relatedEntity: related,
        metadata: {
          otId: wo.ot_id,
          fromStatus: entry.from_status,
          toStatus: entry.to_status,
        },
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
          report.cause_racine ||
          report.description_action ||
          `Report ${report.report_id}`,
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
        actorUserId: report.validated_by
          ? this.idString(report.validated_by)
          : undefined,
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
      description:
        fault.message || `Fault ${fault.code_panne} (${fault.severity})`,
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
        actorUserId: fault.resolved_by
          ? this.idString(fault.resolved_by)
          : undefined,
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
        actorUserId: entry.actor_user_id
          ? this.idString(entry.actor_user_id)
          : undefined,
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

  private maintenancePlanEvents(
    plan: MaintenancePlanDocument,
  ): MachineTimelineEvent[] {
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
        description:
          entry.reason || `Plan ${plan.plan_id} (${plan.type_maintenance})`,
        actorUserId: entry.actor_user_id
          ? this.idString(entry.actor_user_id)
          : undefined,
        relatedEntity: related,
        metadata: {
          planId: plan.plan_id,
          typeMaintenance: plan.type_maintenance,
        },
      });
    }

    return events;
  }

  private preventiveTaskEvents(
    task: PreventiveTaskDocument,
  ): MachineTimelineEvent[] {
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

  private lubricationLogEvents(
    log: LubrificationLogDocument,
  ): MachineTimelineEvent[] {
    const lubrifiant = readPopulatedField<Lubrifiant>(log.lubrifiant_id);
    return [
      {
        id: `lubrication_${log._id.toString()}`,
        type: MachineTimelineEventType.LUBRICATION_COMPLETED,
        category: MachineTimelineCategory.PREVENTIVE,
        at: log.date_application,
        title: 'Lubrication completed',
        description: this.lubricationDescription(lubrifiant, log.quantite),
        actorUserId: this.idString(log.technician_id),
        metadata: { logId: log.log_id, quantity: log.quantite },
      },
    ];
  }

  private stockMovementEvents(
    movement: StockMovementDocument,
  ): MachineTimelineEvent[] {
    const type = STOCK_MOVEMENT_TYPES[movement.type];
    if (!type) return [];
    const part = readPopulatedField<Catalogue>(movement.part_id);
    const quantity = Math.abs(movement.quantity_delta);
    const createdAt = readTimestamps(movement).createdAt;
    if (!createdAt) return [];

    return [
      {
        id: `stock_${movement._id.toString()}`,
        type,
        category: MachineTimelineCategory.INVENTORY,
        at: createdAt,
        title: STOCK_EVENT_TITLES[type] ?? 'Stock movement',
        description: this.stockMovementDescription(part, quantity),
        actorUserId: movement.actor_user_id
          ? this.idString(movement.actor_user_id)
          : undefined,
        relatedEntity: this.toWorkOrderRelatedEntity(movement.work_order_id),
        metadata: {
          movementId: movement.movement_id,
          partName: part?.nom_piece,
          partRef: part?.ref_constructeur,
          quantity,
        },
      },
    ];
  }

  private aiInteractionEvents(
    interaction: AiInteractionDocument,
  ): MachineTimelineEvent[] {
    const createdAt = readTimestamps(interaction).createdAt;
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
        relatedEntity: this.toWorkOrderRelatedEntity(interaction.work_order_id),
        metadata: {
          faultCode: interaction.fault_code,
          provider: interaction.provider,
        },
      },
    ];
  }

  private matchesSearch(event: MachineTimelineEvent, pattern: RegExp): boolean {
    if (pattern.test(event.title)) return true;
    if (event.description && pattern.test(event.description)) return true;
    if (event.actor?.name && pattern.test(event.actor.name)) return true;
    if (
      event.relatedEntity?.refCode &&
      pattern.test(event.relatedEntity.refCode)
    )
      return true;
    if (event.metadata) {
      for (const value of Object.values(event.metadata)) {
        if (typeof value === 'string' && pattern.test(value)) return true;
      }
    }
    return false;
  }

  private summarizeWorkOrders(
    workOrders: WorkOrderDocument[],
    now: Date,
  ): WorkOrderSummaryStats {
    const stats: WorkOrderSummaryStats = {
      openWorkOrders: 0,
      closedWorkOrders: 0,
      preventiveCompleted: 0,
      correctiveCompleted: 0,
      downtimeMs: 0,
      downtimeCount: 0,
      lastMaintenanceAt: null,
      nextMaintenanceAt: null,
    };

    for (const wo of workOrders) {
      this.addWorkOrderStatusStats(stats, wo);
      this.addWorkOrderDowntimeStats(stats, wo);
      this.addUpcomingMaintenanceCandidate(stats, wo, now);
    }

    return stats;
  }

  private addWorkOrderStatusStats(
    stats: WorkOrderSummaryStats,
    wo: WorkOrderDocument,
  ): void {
    const closed = CLOSED_WORK_ORDER_STATUSES.includes(wo.status);
    if (closed) {
      stats.closedWorkOrders += 1;
    } else {
      stats.openWorkOrders += 1;
    }

    if (!COMPLETED_WORK_ORDER_STATUSES.includes(wo.status)) {
      return;
    }

    if (
      categoryForMaintenanceType(wo.type_maintenance) ===
      MachineTimelineCategory.PREVENTIVE
    ) {
      stats.preventiveCompleted += 1;
    } else {
      stats.correctiveCompleted += 1;
    }
    stats.lastMaintenanceAt = this.latestDate(
      stats.lastMaintenanceAt,
      wo.date_end,
    );
  }

  private addWorkOrderDowntimeStats(
    stats: WorkOrderSummaryStats,
    wo: WorkOrderDocument,
  ): void {
    if (!wo.date_start || !wo.date_end) {
      return;
    }

    stats.downtimeMs += wo.date_end.getTime() - wo.date_start.getTime();
    stats.downtimeCount += 1;
  }

  private addUpcomingMaintenanceCandidate(
    stats: WorkOrderSummaryStats,
    wo: WorkOrderDocument,
    now: Date,
  ): void {
    if (CLOSED_WORK_ORDER_STATUSES.includes(wo.status)) {
      return;
    }

    const dueCandidate = wo.due_date ?? wo.scheduled_date;
    if (!dueCandidate || dueCandidate < now) {
      return;
    }

    if (!stats.nextMaintenanceAt || dueCandidate < stats.nextMaintenanceAt) {
      stats.nextMaintenanceAt = dueCandidate;
    }
  }

  private filterTimelineEvents(
    events: MachineTimelineEvent[],
    query: MachineTimelineQueryDto,
  ): MachineTimelineEvent[] {
    const typeSet = this.timelineTypeSet(query.types);
    const dateFilter = this.timelineDateFilter(query);
    const searchPattern = this.timelineSearchPattern(query.search);

    return events
      .filter((event) => this.matchesTypeFilter(event, typeSet))
      .filter((event) => this.matchesDateFilter(event, dateFilter))
      .filter((event) => this.matchesSearchFilter(event, searchPattern));
  }

  private timelineTypeSet(typesParam?: string): Set<string> | null {
    const types = parseCsvParam(typesParam);
    if (types?.length) {
      return new Set(types);
    }

    return null;
  }

  private timelineDateFilter(
    query: MachineTimelineQueryDto,
  ): ReturnType<typeof buildDateRangeFilter> | undefined {
    if (!query.dateFrom && !query.dateTo) {
      return undefined;
    }

    return buildDateRangeFilter(
      this.toOptionalDate(query.dateFrom),
      this.toOptionalDate(query.dateTo),
    );
  }

  private timelineSearchPattern(search?: string): RegExp | null {
    if (!search) {
      return null;
    }

    return buildCaseInsensitiveSearchFilter(search);
  }

  private toOptionalDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    return new Date(value);
  }

  private matchesTypeFilter(
    event: MachineTimelineEvent,
    typeSet: Set<string> | null,
  ): boolean {
    return !typeSet || typeSet.has(event.category);
  }

  private matchesDateFilter(
    event: MachineTimelineEvent,
    dateFilter: ReturnType<typeof buildDateRangeFilter>,
  ): boolean {
    if (!dateFilter) {
      return true;
    }

    if (dateFilter.$gte && event.at < dateFilter.$gte) return false;
    if (dateFilter.$lt && event.at >= dateFilter.$lt) return false;
    return true;
  }

  private matchesSearchFilter(
    event: MachineTimelineEvent,
    pattern: RegExp | null,
  ): boolean {
    return !pattern || this.matchesSearch(event, pattern);
  }

  private latestDate(...dates: Array<Date | null | undefined>): Date | null {
    return dates.reduce<Date | null>((latest, date) => {
      if (!date) return latest;
      if (!latest || date > latest) return date;
      return latest;
    }, null);
  }

  private toMachineTypeSummary(
    machineType: MachineTypeDocument | undefined,
  ): MachineTimelineSummary['machine']['type'] {
    if (!machineType?.name || !machineType._id) {
      return null;
    }

    return { id: this.idString(machineType) ?? '', name: machineType.name };
  }

  private ageInDays(source: Date | undefined, now: Date): number | null {
    if (!source) {
      return null;
    }

    return Math.floor((now.getTime() - source.getTime()) / 86_400_000);
  }

  private roundNullableHours(value: number | null): number | null {
    if (value === null) {
      return null;
    }

    return Math.round(value * 100) / 100;
  }

  private workOrderEndDetails(cancelled: boolean): {
    type: MachineTimelineEventType;
    title: string;
    verb: string;
  } {
    if (cancelled) {
      return {
        type: MachineTimelineEventType.WORK_ORDER_CANCELLED,
        title: 'Work order cancelled',
        verb: 'cancelled',
      };
    }

    return {
      type: MachineTimelineEventType.WORK_ORDER_COMPLETED,
      title: 'Work order completed',
      verb: 'completed',
    };
  }

  private lubricationDescription(
    lubrifiant: Lubrifiant | undefined,
    quantity: number,
  ): string {
    if (lubrifiant?.nom) {
      return `Applied ${lubrifiant.nom} (${quantity})`;
    }

    return `Lubrication logged (${quantity})`;
  }

  private stockMovementDescription(
    part: Catalogue | undefined,
    quantity: number,
  ): string {
    if (part?.nom_piece) {
      return `${part.nom_piece} x${quantity}`;
    }

    return `${quantity} unit(s)`;
  }

  private toWorkOrderRelatedEntity(
    workOrderId: Types.ObjectId | string | { _id?: unknown } | undefined,
  ): TimelineRelatedEntity | undefined {
    if (!workOrderId) {
      return undefined;
    }

    return {
      kind: 'work_order',
      id: this.idString(workOrderId) ?? '',
    };
  }

  private async resolveActors(events: MachineTimelineEvent[]): Promise<void> {
    const actorIds = [
      ...new Set(
        events
          .map((event) => event.actorUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!actorIds.length) return;

    const actors = await this.userModel
      .find({ _id: { $in: actorIds.map((id) => new Types.ObjectId(id)) } })
      .select(SAFE_USER_PROJECTION)
      .exec();
    const actorById = new Map(
      actors.map((actor) => [
        actor._id.toString(),
        {
          id: actor._id.toString(),
          name: actor.nom_complet,
          role: actor.role,
        },
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
      return this.idString(value._id as never);
    }
    return undefined;
  }

  private assertObjectId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid machine id');
    }
  }
}
