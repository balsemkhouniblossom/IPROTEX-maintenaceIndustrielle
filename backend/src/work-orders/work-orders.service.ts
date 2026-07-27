/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  WorkOrder,
  WorkOrderDocument,
  WorkOrderLifecycleAction,
} from '../schemas/work-order.schema';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { WorkOrdersQueryDto } from './dto/work-orders-query.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import {
  buildCaseInsensitiveSearchFilter,
  parseCsvParam,
  parseSortParam,
} from '../common/query-params.util';
import {
  isCorrectiveMaintenanceType,
  isSchedulableMaintenanceType,
  NOT_CORRECTIVE_TYPE_FILTER,
} from '../common/maintenance-type';

export const WORK_ORDERS_SORT_ALLOWED_FIELDS = [
  'date_created',
  'due_date',
  'priorite',
  'status',
] as const;
const WORK_ORDERS_DEFAULT_SORT: Record<string, 1 | -1> = { date_created: -1 };

function buildWorkOrdersFilter(
  query: WorkOrdersQueryDto = {},
): FilterQuery<WorkOrderDocument> {
  const filter: FilterQuery<WorkOrderDocument> = {};

  const statuses = parseCsvParam(query.status);
  if (statuses) filter.status = { $in: statuses };

  const priorities = parseCsvParam(query.priority);
  if (priorities) filter.priorite = { $in: priorities };

  if (query.machineId && Types.ObjectId.isValid(query.machineId)) {
    filter.machine_id = new Types.ObjectId(query.machineId);
  }
  if (query.technicianId && Types.ObjectId.isValid(query.technicianId)) {
    filter.technician_id = new Types.ObjectId(query.technicianId);
  }

  if (query.dateFrom || query.dateTo) {
    filter.date_created = {
      ...(query.dateFrom ? { $gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { $lte: new Date(query.dateTo) } : {}),
    };
  }

  if (query.search) {
    const searchRegex = buildCaseInsensitiveSearchFilter(query.search);
    filter.$or = [
      { ot_id: searchRegex },
      { description: searchRegex },
      { code_panne: searchRegex },
    ];
  }

  return filter;
}
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
  MaintenancePlanStatus,
} from '../schemas/maintenance-plan.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { DocumentEntity, DocumentDocument } from '../schemas/document.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../schemas/machine-type.schema';
import { User, UserDocument, Role } from '../schemas/user.schema';
import { Panne, PanneDocument } from '../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionDocument,
} from '../schemas/panne-solution.schema';
import { KPI, KPIDocument } from '../schemas/kpi.schema';
import { Stock, StockDocument } from '../schemas/stock.schema';
import { Catalogue, CatalogueDocument } from '../schemas/catalogue.schema';
import { OTPieces, OTPiecesDocument } from '../schemas/ot-pieces.schema';
import { Lubrifiant, LubrifiantDocument } from '../schemas/lubrifiant.schema';
import {
  LubrificationLog,
  LubrificationLogDocument,
} from '../schemas/lubrification-log.schema';
import {
  PartRequest,
  PartRequestDocument,
  PartRequestStatus,
} from '../schemas/part-request.schema';
import { CounterService } from '../counters/counter.service';
import { MaintenanceSchedulingService } from './maintenance-scheduling.service';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { NotificationType } from '../schemas/notification.schema';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { KpiService } from '../kpi/kpi.service';

type CalendarView = 'day' | 'week' | 'month' | 'year' | 'timeline';
type ValidationAction = 'approve' | 'reject' | 'request_correction';

const PART_REQUEST_DECISION_RULES: Record<
  'approve' | 'reject' | 'cancel',
  { from: PartRequestStatus; to: PartRequestStatus }
> = {
  approve: { from: PartRequestStatus.PENDING, to: PartRequestStatus.RESERVED },
  reject: { from: PartRequestStatus.PENDING, to: PartRequestStatus.CANCELLED },
  cancel: { from: PartRequestStatus.RESERVED, to: PartRequestStatus.CANCELLED },
};

interface SchedulerRunSummary {
  plansEvaluated: number;
  createdFirstExecution: number;
  createdNextExecution: number;
  skippedDuplicates: number;
}

interface CalendarFilters {
  machineId?: string;
  machineTypeId?: string;
  operatorId?: string;
  technicianId?: string;
  maintenanceType?: string;
  status?: string;
  priority?: string;
  month?: number;
  week?: number;
  year?: number;
}

export interface CalendarEventRow {
  id: string;
  workOrderId: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  startDate: string;
  endDate?: string;
  color: 'blue' | 'green' | 'orange' | 'red' | 'purple';
  machine: {
    id: string;
    code: string;
    model?: string;
    typeId?: string;
    typeName?: string;
  };
  module?: {
    id: string;
    code?: string;
    location?: string;
  };
  frequency: {
    value?: number;
    unit?: string;
    normalizedUnit: string;
    label: string;
  };
  assignedOperator?: {
    id: string;
    name: string;
  };
  assignedTechnician?: {
    id: string;
    name: string;
  };
  reminderStage: string;
}

interface PreventiveScheduleInput {
  machineId: string;
  planId: string;
  scheduledDate: string;
  operatorId: string;
}

interface RescheduleInput {
  workOrderId: string;
  newDueDate: string;
  reason: string;
  userId: string;
  role?: string;
}

interface CorrectiveReportForOperatorInput {
  operatorId: string;
  machineId: string;
  codePanne: string;
  faultDescription?: string;
  actions: string[];
  priority?: string;
}

interface SubmitPreventiveMaintenanceInput {
  operatorId: string;
  workOrderId: string;
  tasksCompleted: string[];
  condition: string;
  comments?: string;
  lubrication?: { lubrifiantId: string; quantity: number };
}

const SUBMITTABLE_PREVENTIVE_STATUSES = ['scheduled', 'overdue'];

interface PartRequestForOperatorInput {
  operatorId: string;
  workOrderId: string;
  partId: string;
  quantity: number;
}

const PART_REQUEST_BLOCKED_STATUSES = [
  'completed',
  'validated',
  'rejected',
  'cancelled',
  'canceled',
  'CLOTURE',
  'ANNULE',
];

interface OperatorCalendarScope {
  operatorId: string;
  workOrderId: string;
}

const OPERATOR_STARTABLE_STATUSES = ['scheduled', 'overdue', 'pending'];

@Injectable()
export class WorkOrdersService {
  private readonly logger = new Logger(WorkOrdersService.name);
  private static readonly CORRECTIVE_REPORT_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

  constructor(
    @InjectModel(WorkOrder.name)
    private workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Machine.name)
    private machineModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private moduleModel: Model<ModuleDocument>,
    @InjectModel(MaintenancePlan.name)
    private maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(InterventionReport.name)
    private interventionReportModel: Model<InterventionReportDocument>,
    @InjectModel(DocumentEntity.name)
    private documentModel: Model<DocumentDocument>,
    @InjectModel(MachineType.name)
    private machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(Panne.name)
    private panneModel: Model<PanneDocument>,
    @InjectModel(PanneSolution.name)
    private panneSolutionModel: Model<PanneSolutionDocument>,
    @InjectModel(KPI.name)
    private kpiModel: Model<KPIDocument>,
    @InjectModel(Stock.name)
    private stockModel: Model<StockDocument>,
    @InjectModel(Catalogue.name)
    private catalogueModel: Model<CatalogueDocument>,
    @InjectModel(OTPieces.name)
    private otPiecesModel: Model<OTPiecesDocument>,
    @InjectModel(Lubrifiant.name)
    private lubrifiantModel: Model<LubrifiantDocument>,
    @InjectModel(LubrificationLog.name)
    private lubrificationLogModel: Model<LubrificationLogDocument>,
    @InjectModel(PartRequest.name)
    private partRequestModel: Model<PartRequestDocument>,
    private counterService: CounterService,
    private schedulingService: MaintenanceSchedulingService,
    private notificationCenterService: NotificationCenterService,
    private stockMovementsService: StockMovementsService,
    private kpiService: KpiService,
  ) {}

  async create(createWorkOrderDto: CreateWorkOrderDto): Promise<WorkOrder> {
    if (!createWorkOrderDto.ot_id) {
      createWorkOrderDto.ot_id = await this.generateWorkOrderCode(
        createWorkOrderDto.type_maintenance,
      );
    }

    if (!createWorkOrderDto.date_created) {
      createWorkOrderDto.date_created = new Date().toISOString();
    }

    if (!createWorkOrderDto.due_date && createWorkOrderDto.date_start) {
      createWorkOrderDto.due_date = createWorkOrderDto.date_start;
    }

    if (!createWorkOrderDto.scheduled_date && createWorkOrderDto.due_date) {
      createWorkOrderDto.scheduled_date = createWorkOrderDto.due_date;
    }

    await this.assertNoDuplicatePreventiveOccurrence({
      machineId: createWorkOrderDto.machine_id,
      planId: createWorkOrderDto.plan_id,
      dueDate: createWorkOrderDto.due_date,
      excludeId: undefined,
    });

    const createdWorkOrder = new this.workOrderModel(createWorkOrderDto);
    const savedWorkOrder = await createdWorkOrder.save();

    if (this.isCompletedStatus(savedWorkOrder.status)) {
      await this.ensureAutoInterventionReport(savedWorkOrder);
      await this.ensureNextPreventiveWorkOrder(savedWorkOrder);
      await this.updateKpiForMachine(savedWorkOrder.machine_id?.toString());
    } else if (savedWorkOrder.technician_id) {
      await this.notificationCenterService.createIfNotExists({
        dedupeKey: `work_order_created:${savedWorkOrder._id.toString()}`,
        type: NotificationType.WORK_ORDER_CREATED,
        title: `New work order ${savedWorkOrder.ot_id} assigned`,
        recipientUserId: savedWorkOrder.technician_id.toString(),
        workOrderId: savedWorkOrder._id.toString(),
        machineId: savedWorkOrder.machine_id?.toString(),
      });
    }

    return savedWorkOrder;
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
    query: WorkOrdersQueryDto = {},
  ): Promise<PaginatedResponse<WorkOrder>> {
    const filter = buildWorkOrdersFilter(query);
    const sort = parseSortParam(
      query.sort,
      WORK_ORDERS_SORT_ALLOWED_FIELDS,
      WORK_ORDERS_DEFAULT_SORT,
    );

    try {
      const [items, totalItems] = await Promise.all([
        this.workOrderModel
          .find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .populate('machine_id')
          .populate('module_id')
          .populate('technician_id')
          .exec(),
        this.workOrderModel.countDocuments(filter).exec(),
      ]);

      return toPaginatedResponse(items, totalItems, page, limit);
    } catch (error) {
      // If populate fails, return work orders without population
      console.warn('Failed to populate work order references:', error);
      const [items, totalItems] = await Promise.all([
        this.workOrderModel.find(filter).sort(sort).skip(skip).limit(limit).exec(),
        this.workOrderModel.countDocuments(filter).exec(),
      ]);

      return toPaginatedResponse(items, totalItems, page, limit);
    }
  }

  async findOne(id: string): Promise<any> {
    try {
      return await this.workOrderModel
        .findById(id)
        .populate('machine_id')
        .populate('module_id')
        .populate('technician_id')
        .exec();
    } catch (error) {
      // If populate fails, return work order without population
      console.warn(
        'Failed to populate work order references for id:',
        id,
        error,
      );
      return this.workOrderModel.findById(id).exec();
    }
  }

  async update(
    id: string,
    updateWorkOrderDto: UpdateWorkOrderDto,
  ): Promise<any> {
    const updated = await this.workOrderModel
      .findByIdAndUpdate(id, updateWorkOrderDto, { new: true })
      .exec();

    if (!updated) {
      return updated;
    }

    if (this.isCompletedStatus(updated.status)) {
      await this.ensureAutoInterventionReport(updated);
      await this.ensureNextPreventiveWorkOrder(updated);
      await this.updateKpiForMachine(updated.machine_id?.toString());
    }

    return updated;
  }

  async remove(id: string): Promise<any> {
    return this.workOrderModel.findByIdAndDelete(id).exec();
  }

  /**
   * The Admin dashboard's legacy statistics endpoint — kept alive for any
   * existing caller, but every number here is now delegated to
   * `KpiService` (the single shared source for these calculations) rather
   * than re-implementing its own month-boundary/status-filter logic.
   * `GET /dashboard/admin` (`KpiService.getAdminDashboard()`) is the fuller,
   * canonical replacement new frontend code should prefer.
   */
  async getStatistics() {
    const adminDashboard = await this.kpiService.getAdminDashboard();
    const pendingOrders = await this.workOrderModel
      .countDocuments({
        status: { $in: ['pending', 'open', 'in_progress'] },
      })
      .exec();

    return {
      currentMonthWorkOrders: adminDashboard.workOrders.currentMonthCount,
      lastMonthWorkOrders: adminDashboard.workOrders.lastMonthCount,
      percentageChange: adminDashboard.workOrders.percentageChange,
      pendingMaintenance: pendingOrders,
      totalWorkOrders: adminDashboard.workOrders.totalCount,
    };
  }

  async triggerScheduler(source = 'manual') {
    const summary = await this.seedMissingPreventiveWorkOrders();
    this.logger.log(
      `Scheduler run (${source}) created_first=${summary.createdFirstExecution} created_next=${summary.createdNextExecution} skipped=${summary.skippedDuplicates}`,
    );
    return {
      source,
      executedAt: new Date().toISOString(),
      ...summary,
    };
  }

  async applyValidationAction(
    workOrderId: string,
    action: ValidationAction,
    validatorId?: string,
  ) {
    const workOrder = await this.workOrderModel.findById(workOrderId).exec();
    if (!workOrder) {
      return null;
    }

    const report = await this.interventionReportModel
      .findOne({ ot_id: workOrder._id })
      .sort({ date_fin: -1 })
      .exec();

    // The report's technician_id is the authoritative "who performed this
    // work" record once a report exists (it's never overwritten by a
    // validation decision — see below); fall back to the work order's own
    // technician_id only when no report has been filed yet.
    const performerId =
      report?.technician_id?.toString() ?? workOrder.technician_id?.toString();
    if (action === 'approve' && validatorId && performerId === validatorId) {
      throw new ForbiddenException('You cannot approve your own work');
    }

    const statusByAction: Record<ValidationAction, string> = {
      approve: 'validated',
      reject: 'rejected',
      request_correction: 'returned',
    };

    const reportStatusByAction: Record<ValidationAction, string> = {
      approve: 'validated',
      reject: 'rejected',
      request_correction: 'request_correction',
    };

    const lifecycleActionByAction: Record<
      ValidationAction,
      WorkOrderLifecycleAction
    > = {
      approve: 'validated',
      reject: 'rejected',
      request_correction: 'returned',
    };

    const nextStatus = statusByAction[action];
    const validatorObjectId =
      validatorId && Types.ObjectId.isValid(validatorId)
        ? new Types.ObjectId(validatorId)
        : undefined;
    const updatedWorkOrder = await this.workOrderModel
      .findByIdAndUpdate(
        workOrderId,
        {
          $set: {
            status: nextStatus,
            ...(action === 'approve' && validatorObjectId
              ? { validated_by: validatorObjectId, validated_at: new Date() }
              : {}),
          },
          $push: {
            lifecycle_history: {
              action: lifecycleActionByAction[action],
              from_status: workOrder.status,
              to_status: nextStatus,
              actor_user_id: validatorObjectId,
              at: new Date(),
            },
          },
        },
        { new: true },
      )
      .exec();

    if (report) {
      await this.interventionReportModel
        .findByIdAndUpdate(
          report._id,
          {
            validation_responsable: reportStatusByAction[action],
            ...(validatorId
              ? { validated_by: validatorId, validated_at: new Date() }
              : {}),
          },
          { new: true },
        )
        .exec();
    }

    if (action === 'approve' && updatedWorkOrder) {
      await this.ensureNextPreventiveWorkOrder(updatedWorkOrder);
      await this.updateKpiForMachine(updatedWorkOrder.machine_id?.toString());
    }

    if (
      updatedWorkOrder?.technician_id &&
      (action === 'approve' || action === 'reject')
    ) {
      await this.notificationCenterService.createIfNotExists({
        dedupeKey: `validation_decision:${workOrderId}:${action}`,
        type:
          action === 'approve'
            ? NotificationType.VALIDATION_APPROVED
            : NotificationType.VALIDATION_REJECTED,
        title:
          action === 'approve'
            ? `Your report for ${updatedWorkOrder.ot_id} was approved`
            : `Your report for ${updatedWorkOrder.ot_id} was rejected`,
        recipientUserId: updatedWorkOrder.technician_id.toString(),
        workOrderId: updatedWorkOrder._id.toString(),
        machineId: updatedWorkOrder.machine_id?.toString(),
      });
    }

    return updatedWorkOrder;
  }

  async getMachinePreventiveStates(machineId: string) {
    if (!Types.ObjectId.isValid(machineId)) {
      throw new BadRequestException('Invalid machine_id');
    }

    const machine = await this.machineModel.findById(machineId).exec();
    if (!machine) {
      throw new NotFoundException('Machine not found');
    }

    const modules = await this.moduleModel
      .find({ machine_id: new Types.ObjectId(machineId) })
      .exec();
    const moduleIds = modules.map((moduleEntity) => moduleEntity._id);
    const moduleById = new Map(
      modules.map((moduleEntity) => [
        moduleEntity._id.toString(),
        moduleEntity,
      ]),
    );

    const plans = await this.maintenancePlanModel
      .find({
        module_id: { $in: moduleIds },
        ...NOT_CORRECTIVE_TYPE_FILTER,
      })
      .sort({ maintenance_code: 1, plan_id: 1 })
      .exec();

    const orders = await this.workOrderModel
      .find({
        machine_id: new Types.ObjectId(machineId),
        ...NOT_CORRECTIVE_TYPE_FILTER,
      })
      .sort({
        due_date: 1,
        scheduled_date: 1,
        execution_date: 1,
        date_start: 1,
      })
      .populate('technician_id')
      .exec();

    const ordersByPlan = new Map<string, WorkOrderDocument[]>();
    for (const order of orders) {
      const planId = this.objectIdString(order.plan_id);
      if (!planId) continue;
      ordersByPlan.set(planId, [...(ordersByPlan.get(planId) || []), order]);
    }

    const today = new Date();
    const planStates = plans.map((plan) => {
      const planOrders = ordersByPlan.get(plan._id.toString()) || [];
      const historical = planOrders
        .filter((order) => this.isCompletedStatus(order.status))
        .sort(
          (left, right) =>
            new Date(
              right.execution_date ||
                right.date_closed ||
                right.date_end ||
                right.date_start ||
                0,
            ).getTime() -
            new Date(
              left.execution_date ||
                left.date_closed ||
                left.date_end ||
                left.date_start ||
                0,
            ).getTime(),
        );
      const active = planOrders.find(
        (order) =>
          !this.isCompletedStatus(order.status) &&
          !['cancelled', 'canceled', 'rejected'].includes(
            (order.status || '').toLowerCase(),
          ),
      );
      const activeDue = active ? this.getWorkOrderDueDate(active) : null;
      const lastCompleted = historical[0];
      const lastCompletedDate = lastCompleted
        ? new Date(
            lastCompleted.execution_date ||
              lastCompleted.date_closed ||
              lastCompleted.date_end ||
              lastCompleted.date_start ||
              lastCompleted.date_created,
          )
        : null;

      return {
        plan,
        module: moduleById.get(this.objectIdString(plan.module_id)) || null,
        currentOccurrence: active || null,
        currentState: this.schedulingService.calculateOperationalStatus({
          status: active?.status,
          dueDate: activeDue,
          today,
          intervalUnit: plan.unite_frequence || plan.frequence_label,
        }),
        lastCompletedDate: lastCompletedDate?.toISOString() || null,
        nextDueDate: activeDue?.toISOString() || null,
        frequency: {
          value: plan.frequence,
          unit: plan.unite_frequence,
          originalLabel: plan.frequence_label || plan.unite_frequence,
          normalized: this.schedulingService.normalizeFrequency(
            plan.unite_frequence || plan.frequence_label,
          ),
        },
      };
    });

    return {
      machineId,
      visibilityRule:
        'Operators can currently access all machines because no operator-machine assignment relationship exists in the current schema.',
      sections: {
        dueToday: planStates.filter(
          (item) => item.currentState === 'due_today',
        ),
        overdue: planStates.filter((item) => item.currentState === 'overdue'),
        upcoming: planStates.filter((item) =>
          ['scheduled', 'due_soon'].includes(item.currentState),
        ),
        waitingValidation: planStates.filter(
          (item) => item.currentState === 'waiting_validation',
        ),
        returned: planStates.filter((item) => item.currentState === 'returned'),
        preventivePlan: planStates,
      },
    };
  }

  async scheduleFirstPreventiveOccurrence(input: PreventiveScheduleInput) {
    const { machine, plan, moduleEntity } =
      await this.resolvePreventivePlanForMachine(input.machineId, input.planId);
    if (!this.isPlanSchedulable(plan)) {
      throw new ConflictException(
        `This maintenance plan is "${plan.status}" and cannot be scheduled`,
      );
    }
    const scheduledDate = new Date(input.scheduledDate);
    if (Number.isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Invalid scheduled_date');
    }

    await this.assertNoDuplicatePreventiveOccurrence({
      machineId: machine._id.toString(),
      planId: plan._id.toString(),
      dueDate: scheduledDate.toISOString(),
    });

    const otId = await this.generateWorkOrderCode(plan.type_maintenance);
    const created = await this.workOrderModel.create({
      ot_id: otId,
      machine_id: machine._id,
      module_id: moduleEntity._id,
      technician_id: new Types.ObjectId(input.operatorId),
      plan_id: plan._id,
      description: plan.instruction || 'Preventive maintenance task',
      type_maintenance: plan.type_maintenance,
      status: 'scheduled',
      priorite: 'medium',
      date_created: new Date(),
      date_start: scheduledDate,
      scheduled_date: scheduledDate,
      due_date: scheduledDate,
    });

    return {
      occurrence: created,
      schedulingState: this.schedulingService.calculateOperationalStatus({
        status: created.status,
        dueDate: created.due_date,
        intervalUnit: plan.unite_frequence || plan.frequence_label,
      }),
    };
  }

  /**
   * Creates the one-and-only first occurrence for a plan that has just
   * been activated, when appropriate — appropriate meaning: the plan is
   * actually schedulable (any non-corrective type: preventive, lubrication,
   * inspection, or a custom scheduled-maintenance label), and it does not
   * already have any occurrence at all (idempotent: re-activating, e.g.
   * Draft->Active after the very first activation somehow raced, never
   * creates a second). Unlike the Operator-driven
   * `scheduleFirstPreventiveOccurrence` (which takes an explicit chosen
   * date), this is Admin-triggered with no date input, so the occurrence is
   * due immediately — the plan just went live, so its first maintenance is
   * due now. Returns `null` (not an error) whenever creation is skipped,
   * since skipping is the normal, expected outcome for a corrective plan or
   * one that already has an occurrence.
   */
  async createInitialOccurrenceForPlan(
    planId: string,
  ): Promise<WorkOrderDocument | null> {
    if (!Types.ObjectId.isValid(planId)) {
      return null;
    }

    const plan = await this.maintenancePlanModel.findById(planId).exec();
    if (!plan || !isSchedulableMaintenanceType(plan.type_maintenance)) {
      return null;
    }

    const alreadyExists = await this.workOrderModel
      .exists({ plan_id: plan._id })
      .exec();
    if (alreadyExists) {
      return null;
    }

    const moduleEntity = await this.moduleModel.findById(plan.module_id).exec();
    if (!moduleEntity) {
      return null;
    }

    const now = new Date();
    const otId = await this.generateWorkOrderCode(plan.type_maintenance);
    return this.workOrderModel.create({
      ot_id: otId,
      machine_id: moduleEntity.machine_id,
      module_id: moduleEntity._id,
      plan_id: plan._id,
      description: plan.instruction || 'Preventive maintenance task',
      type_maintenance: plan.type_maintenance,
      status: 'scheduled',
      priorite: 'medium',
      date_created: now,
      date_start: now,
      scheduled_date: now,
      due_date: now,
    });
  }

  async reschedulePreventiveOccurrence(input: RescheduleInput) {
    if (!Types.ObjectId.isValid(input.workOrderId)) {
      throw new BadRequestException('Invalid work order id');
    }
    if (
      !['operator', 'technician', 'admin'].includes(
        (input.role || '').toLowerCase(),
      )
    ) {
      throw new ForbiddenException('User is not authorized to reschedule');
    }

    const workOrder = await this.workOrderModel
      .findById(input.workOrderId)
      .exec();
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    if (!isSchedulableMaintenanceType(workOrder.type_maintenance)) {
      throw new BadRequestException(
        'Only preventive, lubrication, or inspection occurrences can be rescheduled',
      );
    }
    if (this.isCompletedStatus(workOrder.status)) {
      throw new ConflictException('Completed occurrence cannot be rescheduled');
    }

    const nextDue = new Date(input.newDueDate);
    if (Number.isNaN(nextDue.getTime())) {
      throw new BadRequestException('Invalid new_due_date');
    }

    await this.assertNoDuplicatePreventiveOccurrence({
      machineId: this.objectIdString(workOrder.machine_id),
      planId: this.objectIdString(workOrder.plan_id),
      dueDate: nextDue.toISOString(),
      excludeId: workOrder._id.toString(),
    });

    const previousDue =
      workOrder.due_date || workOrder.scheduled_date || workOrder.date_start;
    const updated = await this.workOrderModel
      .findByIdAndUpdate(
        workOrder._id,
        {
          $set: {
            scheduled_date: nextDue,
            due_date: nextDue,
            date_start: nextDue,
            status: 'scheduled',
            original_due_date: workOrder.original_due_date || previousDue,
            reschedule_reason: input.reason,
            rescheduled_by: new Types.ObjectId(input.userId),
            rescheduled_at: new Date(),
          },
        },
        { new: true },
      )
      .exec();

    return {
      occurrence: updated,
      schedulingState: this.schedulingService.calculateOperationalStatus({
        status: updated?.status,
        dueDate: updated?.due_date,
      }),
    };
  }

  /**
   * Creates a corrective work order and its initial intervention report as a
   * single, reliable operation for an Operator. Both documents are created
   * inside one Mongo transaction: if either write fails, the whole operation
   * rolls back so a corrective report can never exist without its work order
   * (or vice versa). The caller (OperatorService) has already verified the
   * machine is assigned to this operator before this method runs; identity
   * always comes from `input.operatorId` (derived from the authenticated
   * request), never from client-supplied data.
   */
  async createCorrectiveReportForOperator(
    input: CorrectiveReportForOperatorInput,
  ): Promise<{
    workOrder: WorkOrderDocument;
    report: InterventionReportDocument;
    duplicate: boolean;
  }> {
    if (!Types.ObjectId.isValid(input.machineId)) {
      throw new BadRequestException('Invalid machine_id');
    }

    const machine = await this.machineModel.findById(input.machineId).exec();
    if (!machine) {
      throw new NotFoundException('Machine not found');
    }

    const codePanne = input.codePanne?.trim();
    if (!codePanne) {
      throw new BadRequestException('code_panne is required');
    }

    const actions = (input.actions || [])
      .map((action) => action.trim())
      .filter(Boolean);
    if (!actions.length) {
      throw new BadRequestException(
        'At least one action performed is required',
      );
    }

    const operatorObjectId = new Types.ObjectId(input.operatorId);
    const description = `${codePanne} | ${actions.join(' | ')}`;
    const descriptionAction = actions.join(' | ');

    // Idempotency guard: a double-click or a client retry that resubmits the
    // same fault for the same machine moments later returns the record that
    // already exists instead of creating a second, duplicate report.
    const dedupeWindowStart = new Date(
      Date.now() - WorkOrdersService.CORRECTIVE_REPORT_DEDUPE_WINDOW_MS,
    );
    const recentDuplicate = await this.workOrderModel
      .findOne({
        machine_id: machine._id,
        technician_id: operatorObjectId,
        type_maintenance: 'corrective',
        code_panne: codePanne,
        date_created: { $gte: dedupeWindowStart },
      })
      .sort({ date_created: -1 })
      .exec();

    if (recentDuplicate) {
      const existingReport = await this.interventionReportModel
        .findOne({ ot_id: recentDuplicate._id })
        .exec();
      if (existingReport) {
        return {
          workOrder: recentDuplicate,
          report: existingReport,
          duplicate: true,
        };
      }
    }

    const session = await this.workOrderModel.db.startSession();
    let result: {
      workOrder: WorkOrderDocument;
      report: InterventionReportDocument;
      duplicate: boolean;
    };
    try {
      result = await session.withTransaction(async () => {
        const otId = await this.generateWorkOrderCode('corrective');
        const now = new Date();

        const [workOrder] = await this.workOrderModel.create(
          [
            {
              ot_id: otId,
              machine_id: machine._id,
              technician_id: operatorObjectId,
              description,
              type_maintenance: 'corrective',
              status: 'waiting_validation',
              priorite: input.priority?.trim() || 'high',
              code_panne: codePanne,
              date_created: now,
              date_start: now,
            },
          ],
          { session },
        );

        const reportId = await this.generateReportCode();
        const [report] = await this.interventionReportModel.create(
          [
            {
              report_id: reportId,
              ot_id: workOrder._id,
              technician_id: operatorObjectId,
              date_debut: now,
              date_fin: now,
              cause_racine: input.faultDescription?.trim() || codePanne,
              description_action: descriptionAction,
              etat_final: 'waiting_validation',
              validation_responsable: 'waiting_validation',
            },
          ],
          { session },
        );

        return { workOrder, report, duplicate: false };
      });
    } finally {
      await session.endSession();
    }

    await this.notificationCenterService.createIfNotExists({
      dedupeKey: `corrective_awaiting_validation:${result.workOrder._id.toString()}`,
      type: NotificationType.CORRECTIVE_AWAITING_VALIDATION,
      title: `Corrective report for ${result.workOrder.ot_id} is awaiting validation`,
      recipientRole: Role.ADMIN,
      workOrderId: result.workOrder._id.toString(),
      machineId: machine._id.toString(),
      referenceId: result.report._id.toString(),
    });

    return result;
  }

  /**
   * Submits a preventive maintenance round for an already-assigned occurrence
   * as a single, reliable operation for an Operator: the existing preventive
   * WorkOrder is updated (never re-created), its intervention report is
   * created, and a lubrication log is recorded only when lubrication input
   * was supplied. All three writes share one Mongo transaction, so a failure
   * anywhere rolls the whole submission back — the work order is never left
   * pointing at a status with no matching report.
   *
   * Identity and the execution date/time always come from `input` as derived
   * by the caller (OperatorService, from the authenticated request) and from
   * this method's own server clock — never from anything resembling a
   * client-supplied status or timestamp. The atomic, status-guarded update
   * below is also what makes a duplicate/double submission fail safely: once
   * the first call moves the work order out of the submittable-status set,
   * a second call targeting the same work order finds no matching document
   * and is rejected as a conflict rather than creating a second report.
   *
   * Creating the next recurrence stays the sole responsibility of the
   * existing validation lifecycle (`applyValidationAction('approve')`): this
   * method only ever moves the occurrence to `waiting_validation`, never to a
   * completed status, so `ensureNextPreventiveWorkOrder` is not invoked here.
   * It does record `execution_date` as the real moment of submission so that,
   * once approved, the next occurrence is scheduled from when the work was
   * actually performed rather than from the original due date.
   */
  async submitPreventiveMaintenanceForOperator(
    input: SubmitPreventiveMaintenanceInput,
  ): Promise<{
    workOrder: WorkOrderDocument;
    report: InterventionReportDocument;
    lubricationLog: LubrificationLogDocument | null;
  }> {
    if (!Types.ObjectId.isValid(input.workOrderId)) {
      throw new BadRequestException('Invalid work_order_id');
    }

    const workOrderObjectId = new Types.ObjectId(input.workOrderId);
    const operatorObjectId = new Types.ObjectId(input.operatorId);

    const existing = await this.workOrderModel
      .findById(workOrderObjectId)
      .exec();
    if (!existing) {
      throw new NotFoundException('Work order not found');
    }
    if (!isSchedulableMaintenanceType(existing.type_maintenance)) {
      throw new BadRequestException(
        'Only preventive, lubrication, or inspection occurrences can be submitted through this endpoint',
      );
    }
    if (
      !existing.technician_id ||
      existing.technician_id.toString() !== input.operatorId
    ) {
      throw new ForbiddenException(
        'This preventive occurrence is not assigned to you',
      );
    }
    if (!SUBMITTABLE_PREVENTIVE_STATUSES.includes(existing.status)) {
      throw new ConflictException(
        'This preventive occurrence has already been submitted or is not in a submittable state',
      );
    }

    const tasksCompleted = (input.tasksCompleted || [])
      .map((task) => task.trim())
      .filter(Boolean);
    if (!tasksCompleted.length) {
      throw new BadRequestException(
        'At least one completed task is required',
      );
    }

    const condition = input.condition?.trim();
    if (!condition) {
      throw new BadRequestException('condition is required');
    }

    let lubrifiant: LubrifiantDocument | null = null;
    if (input.lubrication) {
      if (!Types.ObjectId.isValid(input.lubrication.lubrifiantId)) {
        throw new BadRequestException('Invalid lubrication.lubrifiant_id');
      }
      if (!Number.isFinite(input.lubrication.quantity) || input.lubrication.quantity <= 0) {
        throw new BadRequestException(
          'lubrication.quantity must be a positive number',
        );
      }
      lubrifiant = await this.lubrifiantModel
        .findById(input.lubrication.lubrifiantId)
        .exec();
      if (!lubrifiant) {
        throw new NotFoundException('Lubrifiant not found');
      }
    }

    const taskSummary = tasksCompleted.join(' | ');

    const session = await this.workOrderModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const now = new Date();

        const workOrder = await this.workOrderModel
          .findOneAndUpdate(
            {
              _id: workOrderObjectId,
              technician_id: operatorObjectId,
              status: { $in: SUBMITTABLE_PREVENTIVE_STATUSES },
            },
            {
              $set: {
                status: 'waiting_validation',
                description: taskSummary,
                execution_date: now,
                date_end: now,
              },
            },
            { session, new: true },
          )
          .exec();

        if (!workOrder) {
          // Lost the race with a concurrent/duplicate submission for the
          // same occurrence between the pre-check above and this guarded
          // update — fail safe rather than create a second report.
          throw new ConflictException(
            'This preventive occurrence has already been submitted or is not in a submittable state',
          );
        }

        const reportId = await this.generateReportCode();
        const [report] = await this.interventionReportModel.create(
          [
            {
              report_id: reportId,
              ot_id: workOrder._id,
              technician_id: operatorObjectId,
              date_debut: now,
              date_fin: now,
              cause_racine: input.comments?.trim() || undefined,
              description_action: taskSummary,
              etat_final: condition,
              validation_responsable: 'waiting_validation',
            },
          ],
          { session },
        );

        let lubricationLog: LubrificationLogDocument | null = null;
        if (input.lubrication && lubrifiant) {
          const logId = await this.generateLubrificationLogCode();
          const [createdLog] = await this.lubrificationLogModel.create(
            [
              {
                log_id: logId,
                module_id: workOrder.module_id,
                lubrifiant_id: lubrifiant._id,
                date_application: now,
                quantite: input.lubrication.quantity,
                technician_id: operatorObjectId,
              },
            ],
            { session },
          );
          lubricationLog = createdLog;
        }

        return { workOrder, report, lubricationLog };
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Records an Operator's request for spare parts against an existing
   * corrective work order they own. This never touches Stock — it only
   * stores a pending signal. Stock is only ever mutated later by the
   * Technician's own transactional consumption flow
   * (TechnicianService.setPartQuantity), once the part is actually approved
   * or used; this method has no code path that writes to the Stock
   * collection at all.
   */
  async requestPartsForOperator(
    input: PartRequestForOperatorInput,
  ): Promise<PartRequestDocument> {
    if (!Types.ObjectId.isValid(input.workOrderId)) {
      throw new BadRequestException('Invalid work_order_id');
    }
    if (!Types.ObjectId.isValid(input.partId)) {
      throw new BadRequestException('Invalid part_id');
    }
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }

    const workOrderObjectId = new Types.ObjectId(input.workOrderId);
    const operatorObjectId = new Types.ObjectId(input.operatorId);
    const partObjectId = new Types.ObjectId(input.partId);

    const workOrder = await this.workOrderModel
      .findById(workOrderObjectId)
      .exec();
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    if (!(workOrder.type_maintenance || '').toLowerCase().includes('correct')) {
      throw new BadRequestException(
        'Only corrective work orders can receive part requests through this endpoint',
      );
    }
    if (
      !workOrder.technician_id ||
      workOrder.technician_id.toString() !== input.operatorId
    ) {
      throw new ForbiddenException('This work order is not assigned to you');
    }
    if (PART_REQUEST_BLOCKED_STATUSES.includes(workOrder.status)) {
      throw new ConflictException(
        'Parts cannot be requested for a work order in this status',
      );
    }

    const part = await this.catalogueModel.findById(partObjectId).exec();
    if (!part) {
      throw new NotFoundException('Part not found');
    }

    const existingActive = await this.partRequestModel
      .findOne({
        ot_id: workOrder._id,
        part_id: part._id,
        status: { $in: [PartRequestStatus.PENDING, PartRequestStatus.RESERVED] },
      })
      .exec();
    if (existingActive) {
      throw new ConflictException(
        'There is already an active parts request for this part on this work order',
      );
    }

    try {
      const [request] = await this.partRequestModel.create([
        {
          request_id: await this.generatePartRequestCode(),
          ot_id: workOrder._id,
          part_id: part._id,
          quantity: input.quantity,
          requested_by: operatorObjectId,
          status: PartRequestStatus.PENDING,
          requested_at: new Date(),
        },
      ]);
      await this.notificationCenterService.createIfNotExists({
        dedupeKey: `part_request_created:${request._id.toString()}`,
        type: NotificationType.PART_REQUEST_CREATED,
        title: `A part was requested for work order ${workOrder.ot_id}`,
        recipientRole: Role.TECHNICIAN,
        workOrderId: workOrder._id.toString(),
        referenceId: request._id.toString(),
      });
      return request;
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          'There is already an active parts request for this part on this work order',
        );
      }
      throw error;
    }
  }

  /**
   * Decides a part request: 'approve' (Pending -> Reserved) puts a
   * transactional hold on Stock via `StockMovementsService.reserve`,
   * 'reject' (Pending -> Cancelled) never touches Stock at all (nothing
   * was ever held), and 'cancel' (Reserved -> Cancelled) releases a
   * reservation that will not be consumed after all. The PartRequest
   * status flip and the Stock movement always happen inside one Mongo
   * transaction, so the ledger and the request's status can never drift
   * apart — either both change or neither does. The atomic status-guarded
   * update on the request itself makes a double-decision (two people
   * deciding, or cancelling, at once) fail safe: whichever call wins the
   * race is the one that gets applied.
   */
  async decidePartRequest(input: {
    requestId: string;
    decision: 'approve' | 'reject' | 'cancel';
    deciderId: string;
    reason?: string;
  }): Promise<PartRequestDocument> {
    if (!Types.ObjectId.isValid(input.requestId)) {
      throw new BadRequestException('Invalid request id');
    }

    const existing = await this.partRequestModel
      .findById(input.requestId)
      .exec();
    if (!existing) {
      throw new NotFoundException('Part request not found');
    }

    const rule = PART_REQUEST_DECISION_RULES[input.decision];
    if (!rule) {
      throw new BadRequestException(`Unknown decision: ${input.decision}`);
    }
    if (existing.status !== rule.from) {
      throw new ConflictException(
        `Cannot ${input.decision} a part request in "${existing.status}" status`,
      );
    }

    let stock: StockDocument | null = null;
    if (input.decision === 'approve' || input.decision === 'cancel') {
      stock = await this.stockModel
        .findOne({ part_id: existing.part_id })
        .exec();
      if (!stock) {
        throw new NotFoundException('No stock record exists for this part');
      }
    }

    const session = await this.partRequestModel.db.startSession();
    let updated: PartRequestDocument | null;
    try {
      updated = await session.withTransaction(async () => {
        const result = await this.partRequestModel
          .findOneAndUpdate(
            { _id: existing._id, status: rule.from },
            { $set: { status: rule.to } },
            { new: true, session },
          )
          .exec();
        if (!result) {
          throw new ConflictException(
            `Cannot ${input.decision} a part request in "${existing.status}" status`,
          );
        }

        if (input.decision === 'approve' && stock) {
          await this.stockMovementsService.reserve(session, {
            stockId: stock._id.toString(),
            partId: existing.part_id.toString(),
            quantity: existing.quantity,
            workOrderId: existing.ot_id.toString(),
            partRequestId: existing._id.toString(),
            actorId: input.deciderId,
          });
        } else if (input.decision === 'cancel' && stock) {
          await this.stockMovementsService.cancelReservation(session, {
            stockId: stock._id.toString(),
            partId: existing.part_id.toString(),
            quantity: existing.quantity,
            workOrderId: existing.ot_id.toString(),
            partRequestId: existing._id.toString(),
            actorId: input.deciderId,
            reason: input.reason,
          });
        }

        return result;
      });
    } finally {
      await session.endSession();
    }

    const finalRequest = updated as PartRequestDocument;

    await this.notificationCenterService.createIfNotExists({
      dedupeKey: `part_request_decision:${finalRequest._id.toString()}:${input.decision}`,
      type: NotificationType.PART_REQUEST_DECISION,
      title:
        input.decision === 'approve'
          ? 'Your part request was approved and reserved'
          : input.decision === 'cancel'
            ? 'Your reserved part request was cancelled'
            : 'Your part request was rejected',
      recipientUserId: finalRequest.requested_by.toString(),
      workOrderId: finalRequest.ot_id.toString(),
      referenceId: finalRequest._id.toString(),
    });

    return finalRequest;
  }

  /**
   * Operator-scoped calendar event list. Every query is hard-scoped to
   * `technician_id: operatorId` — an Operator can never see another
   * Operator's or Technician's work orders here, regardless of what
   * filters are supplied. Date-range boundaries are computed in the
   * configured business timezone rather than the server host's clock.
   */
  async getCalendarEventsForOperator(
    view: CalendarView,
    date: Date,
    operatorId: string,
    filters: CalendarFilters,
  ) {
    const timeZone = this.schedulingService.getBusinessTimezone();
    const { rangeStart, rangeEnd } = this.getViewDateRange(
      view,
      date,
      timeZone,
    );
    const query: Record<string, unknown> = {
      technician_id: new Types.ObjectId(operatorId),
      $or: [
        { due_date: { $gte: rangeStart, $lte: rangeEnd } },
        { scheduled_date: { $gte: rangeStart, $lte: rangeEnd } },
        { execution_date: { $gte: rangeStart, $lte: rangeEnd } },
        { date_start: { $gte: rangeStart, $lte: rangeEnd } },
      ],
    };

    if (filters.machineId) {
      query.machine_id = new Types.ObjectId(filters.machineId);
    }
    if (filters.maintenanceType) {
      query.type_maintenance = filters.maintenanceType;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.priority) {
      query.priorite = filters.priority;
    }

    const workOrders = await this.workOrderModel
      .find(query)
      .populate('machine_id')
      .populate('module_id')
      .populate('technician_id')
      .populate('plan_id')
      .exec();

    const events = await this.toCalendarEvents(workOrders);
    const filteredEvents = events.filter((event) =>
      this.matchCalendarFilter(event, filters),
    );

    return {
      view,
      date: date.toISOString(),
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      totalItems: filteredEvents.length,
      items: filteredEvents,
    };
  }

  async getCalendarEventDetailsForOperator(
    workOrderId: string,
    operatorId: string,
  ) {
    if (!Types.ObjectId.isValid(workOrderId)) {
      throw new BadRequestException('Invalid work order id');
    }

    const workOrder = await this.workOrderModel
      .findById(workOrderId)
      .select({ technician_id: 1 })
      .exec();
    if (!workOrder) {
      throw new NotFoundException('Calendar event not found');
    }
    if (
      !workOrder.technician_id ||
      workOrder.technician_id.toString() !== operatorId
    ) {
      throw new ForbiddenException('This work order is not assigned to you');
    }

    return this.getCalendarEventDetails(workOrderId);
  }

  /** Personal dashboard widget, scoped to work orders assigned to this Operator. */
  async getCalendarWidgetForOperator(operatorId: string) {
    return this.getDashboardCalendarWidget({ technicianId: operatorId });
  }

  /** Personal notification cards, scoped to work orders assigned to this Operator. */
  async getNotificationCardsForOperator(operatorId: string) {
    return this.getNotificationCards({ technicianId: operatorId });
  }

  /** Personal timeline, scoped to work orders assigned to this Operator. */
  async getTimelineForOperator(
    date: Date,
    operatorId: string,
    machineId?: string,
  ) {
    return this.getTimeline(date, machineId, operatorId);
  }

  private async loadOwnedWorkOrderOrThrow(
    scope: OperatorCalendarScope,
  ): Promise<WorkOrderDocument> {
    if (!Types.ObjectId.isValid(scope.workOrderId)) {
      throw new BadRequestException('Invalid work order id');
    }
    const workOrder = await this.workOrderModel
      .findById(scope.workOrderId)
      .exec();
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    if (
      !workOrder.technician_id ||
      workOrder.technician_id.toString() !== scope.operatorId
    ) {
      throw new ForbiddenException('This work order is not assigned to you');
    }
    return workOrder;
  }

  /**
   * Marks that the Operator has begun work on an assigned occurrence. Only a
   * valid transition from a not-yet-started status is accepted; anything
   * else (already in progress, already submitted, closed, etc.) is a 409
   * rather than a silent no-op, and the guard is applied atomically so a
   * double-click can't race itself into two "starts".
   */
  async startWorkOrderForOperator(
    scope: OperatorCalendarScope,
  ): Promise<WorkOrderDocument> {
    await this.loadOwnedWorkOrderOrThrow(scope);

    const updated = await this.workOrderModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(scope.workOrderId),
          technician_id: new Types.ObjectId(scope.operatorId),
          status: { $in: OPERATOR_STARTABLE_STATUSES },
        },
        { $set: { status: 'in_progress', date_start: new Date() } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(
        'This work order cannot be started from its current status',
      );
    }
    return updated;
  }

  /**
   * Marks that the Operator has finished active work on an assigned
   * corrective occurrence, moving it to `waiting_validation` pending
   * Technician/Admin review — never straight to `completed`, since an
   * Operator is never the final approval authority in this system.
   *
   * Preventive, lubrication, and inspection occurrences are intentionally
   * rejected here: they must go through
   * `submitPreventiveMaintenanceForOperator`, which is the only path that
   * captures the checklist/lubrication data and computes the next
   * recurrence from the real execution date. Allowing this generic action
   * to complete a schedulable occurrence would silently skip both.
   */
  async completeWorkOrderForOperator(
    scope: OperatorCalendarScope,
  ): Promise<WorkOrderDocument> {
    const workOrder = await this.loadOwnedWorkOrderOrThrow(scope);

    if (isSchedulableMaintenanceType(workOrder.type_maintenance)) {
      throw new ConflictException(
        'Preventive, lubrication, or inspection occurrences must be completed through the preventive maintenance submission endpoint',
      );
    }

    const now = new Date();
    const updated = await this.workOrderModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(scope.workOrderId),
          technician_id: new Types.ObjectId(scope.operatorId),
          status: 'in_progress',
        },
        {
          $set: {
            status: 'waiting_validation',
            execution_date: workOrder.execution_date || now,
            date_end: now,
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ConflictException(
        'This work order must be in progress before it can be completed',
      );
    }
    return updated;
  }

  /**
   * Reschedules a preventive occurrence assigned to this Operator. Ownership
   * is verified here (the shared `reschedulePreventiveOccurrence` below only
   * checks that the caller's role is allowed to reschedule at all, not that
   * this specific occurrence belongs to them), then all of the existing
   * type/status/date validation is reused as-is.
   */
  async rescheduleWorkOrderForOperator(input: {
    operatorId: string;
    workOrderId: string;
    newDueDate: string;
    reason: string;
  }) {
    await this.loadOwnedWorkOrderOrThrow({
      operatorId: input.operatorId,
      workOrderId: input.workOrderId,
    });

    return this.reschedulePreventiveOccurrence({
      workOrderId: input.workOrderId,
      newDueDate: input.newDueDate,
      reason: input.reason,
      userId: input.operatorId,
      role: 'operator',
    });
  }

  async getCalendarEvents(
    view: CalendarView,
    date: Date,
    filters: CalendarFilters,
  ) {
    const { rangeStart, rangeEnd } = this.getViewDateRange(view, date);
    const query: Record<string, unknown> = {
      $or: [
        { due_date: { $gte: rangeStart, $lte: rangeEnd } },
        { scheduled_date: { $gte: rangeStart, $lte: rangeEnd } },
        { execution_date: { $gte: rangeStart, $lte: rangeEnd } },
        { date_start: { $gte: rangeStart, $lte: rangeEnd } },
      ],
    };

    if (filters.machineId) {
      query.machine_id = new Types.ObjectId(filters.machineId);
    }
    if (filters.technicianId) {
      query.technician_id = new Types.ObjectId(filters.technicianId);
    }
    if (filters.maintenanceType) {
      query.type_maintenance = filters.maintenanceType;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.priority) {
      query.priorite = filters.priority;
    }

    const workOrders = await this.workOrderModel
      .find(query)
      .populate('machine_id')
      .populate('module_id')
      .populate('technician_id')
      .populate('plan_id')
      .exec();

    const events = await this.toCalendarEvents(workOrders);
    const filteredEvents = events.filter((event) =>
      this.matchCalendarFilter(event, filters),
    );

    return {
      view,
      date: date.toISOString(),
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
      totalItems: filteredEvents.length,
      items: filteredEvents,
    };
  }

  async getCalendarEventDetails(workOrderId: string) {
    const workOrder = await this.workOrderModel
      .findById(workOrderId)
      .populate('machine_id')
      .populate('module_id')
      .populate('technician_id')
      .populate('plan_id')
      .exec();

    if (!workOrder) {
      return null;
    }

    const machineId = this.objectIdString(workOrder.machine_id);
    const machine = await this.machineModel
      .findById(machineId)
      .populate('type_id')
      .exec();

    const machineTypeId = this.objectIdString(machine?.type_id);
    const machineType = machineTypeId
      ? await this.machineTypeModel.findById(machineTypeId).exec()
      : null;

    const planId = this.objectIdString(workOrder.plan_id);
    const plan = planId
      ? await this.maintenancePlanModel.findById(planId).exec()
      : null;

    const documentation = machineId
      ? await this.documentModel.find({ machine_id: machineId }).exec()
      : [];

    const otPieces = await this.otPiecesModel
      .find({ ot_id: workOrder._id })
      .populate('part_id')
      .exec();

    const reports = await this.interventionReportModel
      .find({ ot_id: workOrder._id })
      .sort({ date_debut: -1 })
      .exec();

    const correctiveData =
      (workOrder.type_maintenance || '').toLowerCase() === 'corrective'
        ? await this.resolveCorrectiveData(workOrder.code_panne)
        : null;

    return {
      id: workOrder._id.toString(),
      machine: {
        id: machine?._id?.toString() || machineId,
        code:
          machine?.machine_id ||
          (typeof workOrder.machine_id === 'object' &&
          'machine_id' in workOrder.machine_id
            ? (workOrder.machine_id as unknown as { machine_id?: string })
                .machine_id || ''
            : ''),
        model: machine?.model,
      },
      machineType: {
        id: this.objectIdString(machineType) || machineTypeId,
        name: machineType?.name || 'Unknown',
      },
      module: {
        id: this.objectIdString(workOrder.module_id),
        code:
          typeof workOrder.module_id === 'object' &&
          'module_id' in workOrder.module_id
            ? (workOrder.module_id as unknown as { module_id?: string })
                .module_id || ''
            : '',
        location:
          typeof workOrder.module_id === 'object' &&
          'localisation' in workOrder.module_id
            ? (workOrder.module_id as unknown as { localisation?: string })
                .localisation || ''
            : '',
      },
      maintenanceType: workOrder.type_maintenance || 'preventive',
      description: workOrder.description || plan?.instruction || '',
      frequency: {
        value: plan?.frequence,
        unit: plan?.unite_frequence,
        label: this.formatFrequency(plan?.frequence, plan?.unite_frequence),
      },
      assignedOperator: {
        id: this.objectIdString(workOrder.technician_id),
        name:
          typeof workOrder.technician_id === 'object' &&
          'nom_complet' in workOrder.technician_id
            ? (workOrder.technician_id as unknown as { nom_complet?: string })
                .nom_complet || ''
            : '',
      },
      currentStatus: workOrder.status,
      spareParts: otPieces.map((piece) => ({
        id: piece._id.toString(),
        quantity: piece.quantite,
        name:
          typeof piece.part_id === 'object' && 'nom_piece' in piece.part_id
            ? (piece.part_id as unknown as { nom_piece?: string }).nom_piece ||
              'Unknown'
            : 'Unknown',
      })),
      manuals: documentation
        .filter((doc) => this.isMaintenanceDocumentType(doc.type_document))
        .map((doc) => ({
          id: doc._id.toString(),
          type: doc.type_document,
          fileName: doc.file_name,
          filePath: doc.file_path,
        })),
      history: reports.map((report) => ({
        id: report._id.toString(),
        reportId: report.report_id,
        start: report.date_debut,
        end: report.date_fin,
        action: report.description_action,
        status: report.validation_responsable || 'waiting_validation',
      })),
      corrective: correctiveData,
      actions: {
        canStart: !this.isCompletedStatus(workOrder.status),
        canComplete: !this.isCompletedStatus(workOrder.status),
        canGenerateReport: true,
        canOpenManual: documentation.length > 0,
        canViewHistory: reports.length > 0,
      },
    };
  }

  async getTimeline(date: Date, machineId?: string, technicianId?: string) {
    const timeZone = technicianId
      ? this.schedulingService.getBusinessTimezone()
      : undefined;

    const start = timeZone
      ? this.schedulingService.startOfBusinessDay(date, timeZone)
      : (() => {
          const value = new Date(date);
          value.setHours(0, 0, 0, 0);
          return value;
        })();

    const end = timeZone
      ? this.schedulingService.addBusinessDays(start, 370, timeZone)
      : (() => {
          const value = new Date(start);
          value.setDate(value.getDate() + 370);
          return value;
        })();

    const query: Record<string, unknown> = {
      $or: [
        { due_date: { $gte: start, $lte: end } },
        { scheduled_date: { $gte: start, $lte: end } },
        { execution_date: { $gte: start, $lte: end } },
        { date_start: { $gte: start, $lte: end } },
      ],
    };

    if (machineId) {
      query.machine_id = new Types.ObjectId(machineId);
    }
    if (technicianId) {
      query.technician_id = new Types.ObjectId(technicianId);
    }

    const workOrders = await this.workOrderModel
      .find(query)
      .populate('machine_id')
      .sort({ date_start: 1 })
      .exec();

    const groups: Record<string, CalendarEventRow[]> = {
      today: [],
      tomorrow: [],
      nextWeek: [],
      nextMonth: [],
      sixMonths: [],
      oneYear: [],
    };

    const today = timeZone
      ? this.schedulingService.startOfBusinessDay(new Date(), timeZone)
      : (() => {
          const value = new Date();
          value.setHours(0, 0, 0, 0);
          return value;
        })();

    const addDays = (value: Date, days: number) =>
      timeZone
        ? this.schedulingService.addBusinessDays(value, days, timeZone)
        : (() => {
            const result = new Date(value);
            result.setDate(result.getDate() + days);
            return result;
          })();
    const addMonths = (value: Date, months: number) =>
      timeZone
        ? this.schedulingService.addBusinessMonths(value, months, timeZone)
        : (() => {
            const result = new Date(value);
            result.setMonth(result.getMonth() + months);
            return result;
          })();

    const tomorrow = addDays(today, 1);
    const nextWeekLimit = addDays(today, 7);
    const nextMonthLimit = addMonths(today, 1);
    const sixMonthsLimit = addMonths(today, 6);
    const oneYearLimit = addMonths(today, 12);

    const events = await this.toCalendarEvents(workOrders);

    for (const event of events) {
      const due = new Date(event.dueDate);
      if (due < tomorrow) {
        groups.today.push(event);
      } else if (due < nextWeekLimit) {
        groups.tomorrow.push(event);
      } else if (due < nextMonthLimit) {
        groups.nextWeek.push(event);
      } else if (due < sixMonthsLimit) {
        groups.nextMonth.push(event);
      } else if (due < oneYearLimit) {
        groups.sixMonths.push(event);
      } else {
        groups.oneYear.push(event);
      }
    }

    return groups;
  }

  async getDashboardCalendarWidget(scope?: { technicianId?: string }) {
    // Always business-timezone-aware — regardless of whether this is an
    // Admin's unscoped fleet-wide view or an Operator/Technician's own
    // scoped view, "today" must mean the same instant everywhere.
    const timeZone = this.schedulingService.getBusinessTimezone();
    const now = new Date();
    const todayStart = this.schedulingService.startOfBusinessDay(now, timeZone);

    const addDays = (value: Date, days: number) =>
      this.schedulingService.addBusinessDays(value, days, timeZone);
    const addMonths = (value: Date, months: number) =>
      this.schedulingService.addBusinessMonths(value, months, timeZone);

    const todayEnd = addDays(todayStart, 1);
    const weekEnd = addDays(todayStart, 7);
    const nextWeekStart = new Date(weekEnd);
    const nextWeekEnd = addDays(weekEnd, 7);
    const nextMonthEnd = addMonths(todayStart, 1);

    const baseQuery: Record<string, unknown> = {
      $or: [
        { due_date: { $exists: true } },
        { date_start: { $exists: true } },
      ],
    };
    if (scope?.technicianId) {
      baseQuery.technician_id = new Types.ObjectId(scope.technicianId);
    }

    const baseOrders = await this.workOrderModel
      .find(
        baseQuery,
        {
          _id: 1,
          ot_id: 1,
          status: 1,
          due_date: 1,
          scheduled_date: 1,
          execution_date: 1,
          date_start: 1,
          date_created: 1,
        },
      )
      .sort({ date_start: 1 })
      .lean()
      .exec();

    const classify = (order: {
      _id: unknown;
      ot_id?: string;
      status?: string;
      due_date?: Date;
      scheduled_date?: Date;
      execution_date?: Date;
      date_start?: Date;
      date_created?: Date;
    }) => {
      const due = this.getWorkOrderDueDate(order);
      return {
        id: this.objectIdString(order._id),
        workOrderId: this.objectIdString(order._id),
        title: order.ot_id || 'Work order',
        status: order.status || 'pending',
        dueDate: due,
        color: due
          ? this.computeEventColor(order.status || 'pending', due, now)
          : 'blue',
      };
    };

    const rows = baseOrders.map(classify);
    return {
      today: rows.filter((row) => {
        const due = row.dueDate;
        return due !== null && due >= todayStart && due < todayEnd;
      }),
      thisWeek: rows.filter((row) => {
        const due = row.dueDate;
        return due !== null && due >= todayStart && due < weekEnd;
      }),
      nextWeek: rows.filter((row) => {
        const due = row.dueDate;
        return due !== null && due >= nextWeekStart && due < nextWeekEnd;
      }),
      nextMonth: rows.filter((row) => {
        const due = row.dueDate;
        return due !== null && due >= todayStart && due < nextMonthEnd;
      }),
      overdue: rows.filter((row) => row.color === 'red'),
      waitingValidation: rows.filter(
        (row) => row.status === 'waiting_validation',
      ),
      counts: {
        today: rows.filter((row) => {
          const due = row.dueDate;
          return due !== null && due >= todayStart && due < todayEnd;
        }).length,
        thisWeek: rows.filter((row) => {
          const due = row.dueDate;
          return due !== null && due >= todayStart && due < weekEnd;
        }).length,
        nextWeek: rows.filter((row) => {
          const due = row.dueDate;
          return due !== null && due >= nextWeekStart && due < nextWeekEnd;
        }).length,
        nextMonth: rows.filter((row) => {
          const due = row.dueDate;
          return due !== null && due >= todayStart && due < nextMonthEnd;
        }).length,
        overdue: rows.filter((row) => row.color === 'red').length,
        waitingValidation: rows.filter(
          (row) => row.status === 'waiting_validation',
        ).length,
      },
    };
  }

  async getNotificationCards(scope?: { technicianId?: string }) {
    // Always business-timezone-aware — see getDashboardCalendarWidget for
    // why this can no longer fall back to server-local boundaries just
    // because no technician scope was supplied (the Admin-facing route).
    const timeZone = this.schedulingService.getBusinessTimezone();
    const now = new Date();
    const dayStart = this.schedulingService.startOfBusinessDay(now, timeZone);
    const dayEnd = this.schedulingService.addBusinessDays(dayStart, 1, timeZone);
    const upcomingLimit = this.schedulingService.addBusinessDays(now, 7, timeZone);

    const ordersQuery: Record<string, unknown> = {
      $or: [
        { due_date: { $exists: true } },
        { date_start: { $exists: true } },
      ],
    };
    if (scope?.technicianId) {
      ordersQuery.technician_id = new Types.ObjectId(scope.technicianId);
    }

    const orders = await this.workOrderModel.find(ordersQuery).exec();
    const completedToday = orders.filter((order) => {
      const closed = order.date_closed || order.date_end;
      if (!closed) return false;
      const closedDate = new Date(closed);
      return (
        this.isCompletedStatus(order.status) &&
        closedDate >= dayStart &&
        closedDate < dayEnd
      );
    });

    const waitingValidation = orders.filter(
      (order) => order.status === 'waiting_validation',
    );

    const dueToday = orders.filter((order) => {
      const due = this.getWorkOrderDueDate(order);
      return (
        due !== null &&
        due >= dayStart &&
        due < dayEnd &&
        !this.isCompletedStatus(order.status) &&
        order.status !== 'waiting_validation'
      );
    });

    const upcoming = orders.filter((order) => {
      const due = this.getWorkOrderDueDate(order);
      return (
        due !== null &&
        due > dayEnd &&
        due <= upcomingLimit &&
        !this.isCompletedStatus(order.status) &&
        order.status !== 'waiting_validation'
      );
    });

    const overdue = orders.filter((order) => {
      const due = this.getWorkOrderDueDate(order);
      return (
        due !== null &&
        due < now &&
        !this.isCompletedStatus(order.status) &&
        order.status !== 'waiting_validation'
      );
    });

    const criticalSensorAlarms = await this.mesureCriticalAlarmCount();
    const stockAlerts = await this.stockAlertCount();

    const approvedTodayQuery: Record<string, unknown> = {
      validation_responsable: 'validated',
      date_fin: { $gte: dayStart, $lt: dayEnd },
    };
    if (scope?.technicianId) {
      approvedTodayQuery.technician_id = new Types.ObjectId(
        scope.technicianId,
      );
    }
    const approvedToday = await this.interventionReportModel.countDocuments(
      approvedTodayQuery,
    );

    return [
      {
        key: 'upcoming_maintenance',
        title: 'Upcoming Maintenance',
        count: upcoming.length,
        severity: 'info',
      },
      {
        key: 'maintenance_due_today',
        title: 'Maintenance Due Today',
        count: dueToday.length,
        severity: 'warning',
      },
      {
        key: 'maintenance_completed',
        title: 'Maintenance Completed',
        count: completedToday.length,
        severity: 'success',
      },
      {
        key: 'maintenance_waiting_validation',
        title: 'Maintenance Waiting Validation',
        count: waitingValidation.length,
        severity: 'purple',
      },
      {
        key: 'maintenance_overdue',
        title: 'Maintenance Overdue',
        count: overdue.length,
        severity: 'danger',
      },
      {
        key: 'critical_sensor_alarm',
        title: 'Critical Sensor Alarm',
        count: criticalSensorAlarms,
        severity: 'danger',
      },
      {
        key: 'stock_alert',
        title: 'Stock Alert',
        count: stockAlerts,
        severity: 'warning',
      },
      {
        key: 'technician_validation_completed',
        title: 'Technician Validation Completed',
        count: approvedToday,
        severity: 'success',
      },
    ];
  }

  async getCorrectiveAssistant(machineId?: string) {
    const pannes = await this.panneModel.find().exec();
    const panneIds = pannes.map((item) => item._id);
    const solutions = await this.panneSolutionModel
      .find({ panne_id: { $in: panneIds } })
      .populate('panne_id')
      .exec();

    const machineDocuments = machineId
      ? await this.documentModel.find({ machine_id: machineId }).exec()
      : [];

    return {
      machineId,
      pannes: pannes.map((panne) => {
        const relatedSolutions = solutions.filter(
          (solution) =>
            this.objectIdString(solution.panne_id) === panne._id.toString(),
        );
        return {
          id: panne._id.toString(),
          code: panne.code_panne,
          description: panne.description,
          gravity: panne.gravite,
          recommendedSolutions: relatedSolutions.map((solution) => ({
            id: solution._id.toString(),
            probableCause: solution.cause_probable,
            recommendedAction: solution.solution_recommandee,
          })),
        };
      }),
      documents: machineDocuments
        .filter((doc) => this.isMaintenanceDocumentType(doc.type_document))
        .map((doc) => ({
          id: doc._id.toString(),
          type: doc.type_document,
          fileName: doc.file_name,
          filePath: doc.file_path,
        })),
    };
  }

  private async seedMissingPreventiveWorkOrders(): Promise<SchedulerRunSummary> {
    const summary: SchedulerRunSummary = {
      plansEvaluated: 0,
      createdFirstExecution: 0,
      createdNextExecution: 0,
      skippedDuplicates: 0,
    };

    const plans = await this.maintenancePlanModel.find().exec();
    if (!plans.length) {
      return summary;
    }

    const modules = await this.moduleModel.find().exec();
    const machines = await this.machineModel.find().exec();
    const existingPreventiveOrders = await this.workOrderModel
      .find(NOT_CORRECTIVE_TYPE_FILTER, {
        _id: 1,
        machine_id: 1,
        module_id: 1,
        plan_id: 1,
        type_maintenance: 1,
        status: 1,
        date_start: 1,
        date_created: 1,
        date_end: 1,
        date_closed: 1,
        technician_id: 1,
        description: 1,
        priorite: 1,
      })
      .lean()
      .exec();

    const moduleById = new Map<string, any>();
    const machineById = new Map<string, any>();
    const latestOrderByPlanKey = new Map<string, any>();
    const dueKeySet = new Set<string>();

    modules.forEach((module) => {
      moduleById.set(module._id.toString(), module);
    });
    machines.forEach((machine) => {
      machineById.set(machine._id.toString(), machine);
    });

    for (const order of existingPreventiveOrders) {
      const key = this.buildPlanKey(
        order.machine_id,
        order.module_id,
        order.plan_id,
      );
      const current = latestOrderByPlanKey.get(key);
      const currentDate = current
        ? new Date(current.date_start || current.date_created || 0).getTime()
        : -1;
      const nextDate = new Date(
        order.date_start || order.date_created || 0,
      ).getTime();

      if (!current || nextDate >= currentDate) {
        latestOrderByPlanKey.set(key, order);
      }

      const dueTime = new Date(
        order.date_start || order.date_created || 0,
      ).getTime();
      dueKeySet.add(`${key}|${dueTime}`);
    }

    for (const plan of plans) {
      summary.plansEvaluated += 1;
      const planType = plan.type_maintenance || '';
      if (planType && isCorrectiveMaintenanceType(planType)) {
        continue;
      }

      const moduleId = this.objectIdString(plan.module_id);
      const moduleEntity = moduleById.get(moduleId);
      if (!moduleEntity) {
        continue;
      }

      const machineId = this.objectIdString(moduleEntity.machine_id);
      const machine = machineById.get(machineId);
      if (!machine) {
        continue;
      }

      const key = this.buildPlanKey(machine, moduleEntity, plan);
      const existing = latestOrderByPlanKey.get(key);

      if (!existing) {
        summary.skippedDuplicates += 1;
        continue;
      }

      if (this.isCompletedStatus(existing.status)) {
        const created = await this.ensureNextPreventiveWorkOrder(
          existing,
          dueKeySet,
          latestOrderByPlanKey,
        );
        if (created) {
          summary.createdNextExecution += 1;
        } else {
          summary.skippedDuplicates += 1;
        }
      }
    }

    return summary;
  }

  private async createSeedWorkOrder(
    machine: any,
    moduleEntity: any,
    plan: any,
    dueKeySet?: Set<string>,
    latestOrderByPlanKey?: Map<string, any>,
  ): Promise<boolean> {
    const baseDate = machine.installation_date
      ? new Date(machine.installation_date)
      : new Date();
    const dueDate = this.computeNextDueDate(
      baseDate,
      plan.frequence,
      plan.unite_frequence,
    );

    const key = this.buildPlanKey(machine, moduleEntity, plan);
    const dueKey = `${key}|${dueDate.getTime()}`;
    if (dueKeySet?.has(dueKey)) {
      return false;
    }

    const otId = await this.generateWorkOrderCode(plan.type_maintenance);
    const created = await this.workOrderModel.create({
      ot_id: otId,
      machine_id: this.objectIdString(machine),
      module_id: this.objectIdString(moduleEntity),
      plan_id: this.objectIdString(plan),
      description: plan.instruction || 'Preventive maintenance task',
      type_maintenance: plan.type_maintenance,
      status: 'pending',
      priorite: 'medium',
      date_created: new Date(),
      date_start: dueDate,
    });

    dueKeySet?.add(dueKey);
    latestOrderByPlanKey?.set(key, created);

    return true;
  }

  private async ensureNextPreventiveWorkOrder(
    workOrder: any,
    dueKeySet?: Set<string>,
    latestOrderByPlanKey?: Map<string, any>,
  ): Promise<boolean> {
    if (!isSchedulableMaintenanceType(workOrder.type_maintenance)) {
      return false;
    }

    const planId = this.objectIdString(workOrder.plan_id);
    if (!planId) {
      return false;
    }

    const plan = await this.maintenancePlanModel.findById(planId).exec();
    if (!plan) {
      return false;
    }
    if (!this.isPlanSchedulable(plan)) {
      // Paused/Archived/Completed/Draft plans stop future scheduling
      // entirely, without touching any already-created WorkOrder/report —
      // that history is untouched by this early return.
      return false;
    }

    const baseDate =
      workOrder.execution_date ||
      workOrder.date_closed ||
      workOrder.date_end ||
      workOrder.date_start;

    if (!baseDate) {
      return false;
    }

    const nextDue = this.schedulingService.calculateNextDueDate({
      performedAt: new Date(baseDate),
      frequency: plan.frequence,
      intervalUnit: plan.unite_frequence || plan.frequence_label,
      timezone: process.env.BUSINESS_TIMEZONE || 'Africa/Tunis',
    });

    const key = this.buildPlanKey(
      workOrder.machine_id,
      workOrder.module_id,
      workOrder.plan_id,
    );
    const dueKey = `${key}|${nextDue.getTime()}`;
    if (dueKeySet?.has(dueKey)) {
      return false;
    }

    const duplicate = await this.workOrderModel
      .findOne({
        machine_id: workOrder.machine_id,
        plan_id: workOrder.plan_id,
        type_maintenance: workOrder.type_maintenance,
        status: { $nin: ['completed', 'validated', 'cancelled', 'canceled'] },
        due_date: nextDue,
      })
      .exec();
    if (duplicate) {
      return false;
    }

    const nextOtId = await this.generateWorkOrderCode(
      workOrder.type_maintenance,
    );
    const created = await this.workOrderModel.create({
      ot_id: nextOtId,
      machine_id: workOrder.machine_id,
      module_id: workOrder.module_id,
      technician_id: workOrder.technician_id,
      plan_id: workOrder.plan_id,
      description: workOrder.description,
      type_maintenance: workOrder.type_maintenance,
      status: 'pending',
      priorite: workOrder.priorite || 'medium',
      date_created: new Date(),
      date_start: nextDue,
      scheduled_date: nextDue,
      due_date: nextDue,
      recurrence_source_occurrence_id: new Types.ObjectId(
        this.objectIdString(workOrder),
      ),
    });

    dueKeySet?.add(dueKey);
    latestOrderByPlanKey?.set(key, created);

    return true;
  }

  private async ensureAutoInterventionReport(workOrder: any) {
    const existing = await this.interventionReportModel
      .findOne({ ot_id: this.objectIdString(workOrder) })
      .exec();
    if (existing) {
      return;
    }

    const reportId = await this.generateReportCode();
    const now = new Date();
    const dateDebut =
      workOrder.execution_date ||
      workOrder.date_start ||
      workOrder.date_created ||
      now;
    const dateFin = workOrder.date_end || workOrder.date_closed || now;

    const codePanne = workOrder.code_panne;
    const correctiveInfo = codePanne
      ? await this.resolveCorrectiveData(codePanne)
      : null;

    await this.interventionReportModel.create({
      report_id: reportId,
      ot_id: this.objectIdString(workOrder),
      technician_id: workOrder.technician_id,
      date_debut: dateDebut,
      date_fin: dateFin,
      cause_racine: correctiveInfo?.faultDescription || workOrder.code_panne,
      description_action:
        correctiveInfo?.recommendedSolution || workOrder.description,
      etat_final: this.isCompletedStatus(workOrder.status)
        ? 'completed'
        : 'in_progress',
      validation_responsable:
        workOrder.status === 'validated' ? 'validated' : 'waiting_validation',
    });
  }

  async updateKpiForMachine(machineId?: string) {
    if (!machineId) {
      return;
    }

    const machineObjectId = new Types.ObjectId(machineId);
    const orders = await this.workOrderModel
      .find({ machine_id: machineObjectId })
      .sort({ date_created: 1 })
      .exec();

    if (!orders.length) {
      return;
    }

    const completed = orders.filter((order) =>
      this.isCompletedStatus(order.status),
    );
    const corrective = completed.filter((order) =>
      isCorrectiveMaintenanceType(order.type_maintenance),
    );
    const preventive = completed.filter((order) =>
      isSchedulableMaintenanceType(order.type_maintenance),
    );

    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const durations = completed
      .map((order) => {
        const start = order.date_start || order.date_created;
        const end = order.date_end || order.date_closed;
        if (!start || !end) {
          return null;
        }
        return (
          (new Date(end).getTime() - new Date(start).getTime()) /
          (1000 * 60 * 60)
        );
      })
      .filter((value): value is number => value !== null && value >= 0);

    const mttr = durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : 0;

    const failures = corrective
      .map(
        (order) =>
          new Date(
            order.date_closed || order.date_end || order.date_created || now,
          ),
      )
      .sort((a, b) => a.getTime() - b.getTime());

    let mtbf = 0;
    if (failures.length >= 2) {
      let totalGapHours = 0;
      for (let i = 1; i < failures.length; i += 1) {
        totalGapHours +=
          (failures[i].getTime() - failures[i - 1].getTime()) /
          (1000 * 60 * 60);
      }
      mtbf = totalGapHours / (failures.length - 1);
    }

    const total = orders.length;
    const overdueCount = orders.filter((order) => {
      const due = this.getWorkOrderDueDate(order);
      return (
        due !== null &&
        due < now &&
        !this.isCompletedStatus(order.status) &&
        order.status !== 'waiting_validation'
      );
    }).length;

    const availability = mtbf + mttr > 0 ? (mtbf / (mtbf + mttr)) * 100 : 100;
    const overdueRate = total > 0 ? (overdueCount / total) * 100 : 0;

    const existing = await this.kpiModel
      .findOne({ machine_id: machineObjectId })
      .sort({ date_calcul: -1 })
      .exec();

    const payload = {
      kpi_id: existing?.kpi_id || (await this.generateKpiCode()),
      machine_id: machineObjectId,
      mtbf_value: Number(mtbf.toFixed(2)),
      mttr_value: Number(mttr.toFixed(2)),
      availability_rate: Number(availability.toFixed(2)),
      date_calcul: now,
      periode_debut: sixMonthsAgo,
      periode_fin: now,
      completed_preventive: preventive.length,
      completed_corrective: corrective.length,
      overdue_rate: Number(overdueRate.toFixed(2)),
    };

    if (existing) {
      await this.kpiModel.findByIdAndUpdate(existing._id, payload).exec();
    } else {
      await this.kpiModel.create(payload);
    }
  }

  private async toCalendarEvents(
    workOrders: any[],
  ): Promise<CalendarEventRow[]> {
    const machineTypeCache = new Map<string, MachineType | null>();
    const userCache = new Map<string, User | null>();

    const rows: CalendarEventRow[] = [];
    for (const workOrder of workOrders) {
      const now = new Date();
      const dueDate = this.getWorkOrderDueDate(workOrder) || now;
      const plan = await this.resolvePlan(workOrder.plan_id, workOrder.plan_id);
      const machine = await this.resolveMachine(
        workOrder.machine_id,
        workOrder.machine_id,
      );
      const moduleEntity = await this.resolveModule(
        workOrder.module_id,
        workOrder.module_id,
      );

      const machineTypeId = machine ? this.objectIdString(machine.type_id) : '';
      let machineType: MachineType | null = null;
      if (machineTypeId) {
        if (!machineTypeCache.has(machineTypeId)) {
          const fetched = await this.machineTypeModel
            .findById(machineTypeId)
            .exec();
          machineTypeCache.set(machineTypeId, fetched);
        }
        machineType = machineTypeCache.get(machineTypeId) || null;
      }

      const technicianId = this.objectIdString(workOrder.technician_id);
      let technician: User | null = null;
      if (technicianId) {
        const hydratedTechnician = this.extractHydratedEntity<User>(
          workOrder.technician_id,
          ['nom_complet'],
        );
        if (hydratedTechnician) {
          technician = hydratedTechnician;
          userCache.set(technicianId, hydratedTechnician);
        } else if (!userCache.has(technicianId)) {
          const fetchedUser = await this.userModel
            .findById(technicianId)
            .exec();
          userCache.set(technicianId, fetchedUser);
        }
        technician = technician || userCache.get(technicianId) || null;
      }

      rows.push({
        id: workOrder._id.toString(),
        workOrderId: workOrder._id.toString(),
        title:
          workOrder.description ||
          plan?.instruction ||
          `${(workOrder.type_maintenance || 'maintenance').toUpperCase()} task`,
        type: workOrder.type_maintenance || 'preventive',
        status: this.schedulingService.calculateOperationalStatus({
          status: workOrder.status,
          dueDate,
          intervalUnit: plan?.unite_frequence,
        }),
        priority: workOrder.priorite || 'medium',
        dueDate: dueDate.toISOString(),
        startDate: new Date(
          workOrder.execution_date ||
            workOrder.scheduled_date ||
            workOrder.due_date ||
            workOrder.date_start ||
            now,
        ).toISOString(),
        endDate: workOrder.date_end
          ? new Date(workOrder.date_end).toISOString()
          : undefined,
        color: this.computeEventColor(workOrder.status, dueDate, now),
        machine: {
          id:
            this.objectIdString(machine) ||
            this.objectIdString(workOrder.machine_id),
          code:
            machine?.machine_id ||
            (workOrder.machine_id &&
            typeof workOrder.machine_id === 'object' &&
            'machine_id' in workOrder.machine_id
              ? (workOrder.machine_id as unknown as { machine_id?: string })
                  .machine_id || ''
              : ''),
          model: machine?.model,
          typeId: this.objectIdString(machineType) || machineTypeId,
          typeName: machineType?.name,
        },
        module: moduleEntity
          ? {
              id: this.objectIdString(moduleEntity),
              code: moduleEntity.module_id,
              location: moduleEntity.localisation,
            }
          : undefined,
        frequency: {
          value: plan?.frequence,
          unit: plan?.unite_frequence,
          normalizedUnit: this.normalizeFrequencyUnit(plan?.unite_frequence),
          label: this.formatFrequency(plan?.frequence, plan?.unite_frequence),
        },
        assignedOperator: technician
          ? {
              id: this.objectIdString(technician),
              name: technician.nom_complet,
            }
          : undefined,
        assignedTechnician: technician
          ? {
              id: this.objectIdString(technician),
              name: technician.nom_complet,
            }
          : undefined,
        reminderStage: this.computeReminderStage(
          workOrder.status,
          dueDate,
          now,
        ),
      });
    }

    return rows.sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
    );
  }

  private getViewDateRange(view: CalendarView, date: Date, timeZone?: string) {
    const base = new Date(date);
    if (Number.isNaN(base.getTime())) {
      base.setTime(Date.now());
    }

    if (!timeZone) {
      const rangeStart = new Date(base);
      const rangeEnd = new Date(base);

      if (view === 'day') {
        rangeStart.setHours(0, 0, 0, 0);
        rangeEnd.setHours(23, 59, 59, 999);
        return { rangeStart, rangeEnd };
      }

      if (view === 'week' || view === 'timeline') {
        const day = rangeStart.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        rangeStart.setDate(rangeStart.getDate() + diff);
        rangeStart.setHours(0, 0, 0, 0);
        rangeEnd.setTime(rangeStart.getTime());
        rangeEnd.setDate(rangeEnd.getDate() + 6);
        rangeEnd.setHours(23, 59, 59, 999);
        return { rangeStart, rangeEnd };
      }

      if (view === 'month') {
        rangeStart.setDate(1);
        rangeStart.setHours(0, 0, 0, 0);
        rangeEnd.setMonth(rangeEnd.getMonth() + 1, 0);
        rangeEnd.setHours(23, 59, 59, 999);
        return { rangeStart, rangeEnd };
      }

      rangeStart.setMonth(0, 1);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd.setMonth(11, 31);
      rangeEnd.setHours(23, 59, 59, 999);
      return { rangeStart, rangeEnd };
    }

    // Business-timezone-aware variant: used by the Operator-scoped calendar
    // so "today"/"this week"/etc. line up with the timezone the maintenance
    // business actually operates in, rather than the server host's clock.
    if (view === 'day') {
      const rangeStart = this.schedulingService.startOfBusinessDay(
        base,
        timeZone,
      );
      const rangeEnd = this.schedulingService.endOfBusinessDay(base, timeZone);
      return { rangeStart, rangeEnd };
    }

    if (view === 'week' || view === 'timeline') {
      const rangeStart = this.schedulingService.startOfBusinessWeek(
        base,
        timeZone,
      );
      const rangeEnd = new Date(
        this.schedulingService.addBusinessDays(rangeStart, 7, timeZone).getTime() -
          1,
      );
      return { rangeStart, rangeEnd };
    }

    if (view === 'month') {
      const rangeStart = this.schedulingService.startOfBusinessMonth(
        base,
        timeZone,
      );
      const rangeEnd = new Date(
        this.schedulingService
          .addBusinessMonths(rangeStart, 1, timeZone)
          .getTime() - 1,
      );
      return { rangeStart, rangeEnd };
    }

    const rangeStart = this.schedulingService.startOfBusinessYear(
      base,
      timeZone,
    );
    const rangeEnd = new Date(
      this.schedulingService.addBusinessMonths(rangeStart, 12, timeZone).getTime() -
        1,
    );
    return { rangeStart, rangeEnd };
  }

  private matchCalendarFilter(
    event: CalendarEventRow,
    filters: CalendarFilters,
  ) {
    if (
      filters.machineTypeId &&
      event.machine.typeId !== filters.machineTypeId
    ) {
      return false;
    }
    if (
      filters.operatorId &&
      event.assignedOperator?.id !== filters.operatorId
    ) {
      return false;
    }
    if (filters.month) {
      const eventMonth = new Date(event.dueDate).getMonth() + 1;
      if (eventMonth !== filters.month) {
        return false;
      }
    }
    if (filters.year) {
      const eventYear = new Date(event.dueDate).getFullYear();
      if (eventYear !== filters.year) {
        return false;
      }
    }
    if (filters.week) {
      const eventWeek = this.getIsoWeek(new Date(event.dueDate));
      if (eventWeek !== filters.week) {
        return false;
      }
    }
    return true;
  }

  private normalizeFrequencyUnit(value?: string): string {
    return this.schedulingService.normalizeFrequency(value).toLowerCase();
  }

  private computeNextDueDate(
    fromDate: Date,
    frequency?: number,
    unit?: string,
  ): Date {
    return this.schedulingService.calculateNextDueDate({
      performedAt: fromDate,
      frequency,
      intervalUnit: unit,
    });
  }

  private formatFrequency(value?: number, unit?: string): string {
    const qty = value && value > 0 ? value : 1;
    const normalized = this.normalizeFrequencyUnit(unit);
    if (normalized === 'daily') return `${qty} x day`;
    if (normalized === 'weekly') return `${qty} x week`;
    if (normalized === 'monthly') return `${qty} x month`;
    if (normalized === 'quarterly') return 'Every 3 months';
    if (normalized === 'semiannual') return 'Every 6 months';
    if (normalized === 'yearly') return `${qty} x year`;
    if (normalized === 'per_loading') return 'Every loading';
    if (normalized === 'per_shift') return 'Every shift';
    if (normalized === 'per_production_order') return 'Every production order';
    return `${qty} x month`;
  }

  private computeEventColor(
    status: string,
    dueDate: Date,
    now: Date,
  ): 'blue' | 'green' | 'orange' | 'red' | 'purple' {
    if (status === 'completed' || status === 'validated') {
      return 'green';
    }
    if (status === 'waiting_validation') {
      return 'purple';
    }

    const diffDays = Math.floor(
      (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays < 0) {
      return 'red';
    }
    if (diffDays <= 7) {
      return 'orange';
    }
    return 'blue';
  }

  private computeReminderStage(
    status: string,
    dueDate: Date,
    now: Date,
  ): string {
    if (this.isCompletedStatus(status)) {
      return 'completed';
    }

    const diffMs = dueDate.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays >= 7) return 'upcoming_7_days';
    if (diffDays >= 3) return 'reminder_3_days';
    if (diffDays >= 1) return 'reminder_1_day';
    if (diffDays >= 0) return 'due_today';

    const overdueDays = Math.abs(diffDays);
    if (overdueDays >= 7) return 'overdue_notify_supervisor';
    if (overdueDays >= 3) return 'overdue_notify_technician';
    if (overdueDays >= 1) return 'overdue_next_day';
    return 'pending_end_of_shift';
  }

  private async resolveCorrectiveData(codePanne?: string) {
    if (!codePanne) {
      return null;
    }

    const panne = await this.panneModel
      .findOne({ code_panne: codePanne })
      .exec();
    if (!panne) {
      return null;
    }

    const solution = await this.panneSolutionModel
      .findOne({ panne_id: panne._id })
      .exec();

    return {
      faultCode: panne.code_panne,
      faultDescription: panne.description,
      probableCause: solution?.cause_probable,
      recommendedSolution: solution?.solution_recommandee,
    };
  }

  private async resolveMachine(value: unknown, hydrated?: unknown) {
    const inlineMachine = this.extractHydratedEntity<Machine>(hydrated, [
      'machine_id',
    ]);
    if (inlineMachine) return inlineMachine;
    const machineId = this.objectIdString(value);
    if (!machineId) return null;
    return this.machineModel.findById(machineId).exec();
  }

  private async resolveModule(value: unknown, hydrated?: unknown) {
    const inlineModule = this.extractHydratedEntity<ModuleEntity>(hydrated, [
      'module_id',
    ]);
    if (inlineModule) return inlineModule;
    const moduleId = this.objectIdString(value);
    if (!moduleId) return null;
    return this.moduleModel.findById(moduleId).exec();
  }

  private async resolvePlan(value: unknown, hydrated?: unknown) {
    const inlinePlan = this.extractHydratedEntity<MaintenancePlan>(hydrated, [
      'plan_id',
    ]);
    if (inlinePlan) return inlinePlan;
    const planId = this.objectIdString(value);
    if (!planId) return null;
    return this.maintenancePlanModel.findById(planId).exec();
  }

  private async resolvePreventivePlanForMachine(
    machineId: string,
    planId: string,
  ) {
    if (!Types.ObjectId.isValid(machineId)) {
      throw new BadRequestException('Invalid machine_id');
    }
    if (!Types.ObjectId.isValid(planId)) {
      throw new BadRequestException('Invalid plan_id');
    }

    const [machine, plan] = await Promise.all([
      this.machineModel.findById(machineId).exec(),
      this.maintenancePlanModel.findById(planId).exec(),
    ]);
    if (!machine) {
      throw new NotFoundException('Machine not found');
    }
    if (!plan) {
      throw new NotFoundException('Maintenance plan not found');
    }
    if (!isSchedulableMaintenanceType(plan.type_maintenance)) {
      throw new BadRequestException(
        'Maintenance plan is not schedulable (corrective plans cannot be scheduled this way)',
      );
    }

    const moduleEntity = await this.moduleModel
      .findOne({
        _id: plan.module_id,
        machine_id: machine._id,
      })
      .exec();
    if (!moduleEntity) {
      throw new BadRequestException(
        'Maintenance plan does not apply to machine',
      );
    }

    return { machine, plan, moduleEntity };
  }

  private async assertNoDuplicatePreventiveOccurrence(input: {
    machineId?: string;
    planId?: string;
    dueDate?: string;
    excludeId?: string;
  }) {
    if (!input.machineId || !input.planId || !input.dueDate) {
      return;
    }
    if (
      !Types.ObjectId.isValid(input.machineId) ||
      !Types.ObjectId.isValid(input.planId)
    ) {
      return;
    }
    const dueDate = new Date(input.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      return;
    }

    const dayStart = this.schedulingService.startOfLocalDay(dueDate);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const query: Record<string, unknown> = {
      machine_id: new Types.ObjectId(input.machineId),
      plan_id: new Types.ObjectId(input.planId),
      ...NOT_CORRECTIVE_TYPE_FILTER,
      status: {
        $nin: ['completed', 'validated', 'cancelled', 'canceled', 'rejected'],
      },
      $or: [
        { due_date: { $gte: dayStart, $lt: dayEnd } },
        { scheduled_date: { $gte: dayStart, $lt: dayEnd } },
        { execution_date: { $gte: dayStart, $lt: dayEnd } },
        { date_start: { $gte: dayStart, $lt: dayEnd } },
      ],
    };

    if (input.excludeId && Types.ObjectId.isValid(input.excludeId)) {
      query._id = { $ne: new Types.ObjectId(input.excludeId) };
    }

    const duplicate = await this.workOrderModel.findOne(query).exec();
    if (duplicate) {
      throw new ConflictException(
        'Duplicate preventive occurrence already exists',
      );
    }
  }

  private extractHydratedEntity<T>(
    value: unknown,
    requiredKeys: string[],
  ): T | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    for (const key of requiredKeys) {
      if (!(key in value)) {
        return null;
      }
    }

    return value as T;
  }

  private getWorkOrderDueDate(workOrder: {
    due_date?: Date | string;
    scheduled_date?: Date | string;
    execution_date?: Date | string;
    date_start?: Date | string;
    date_created?: Date | string;
  }): Date | null {
    const source =
      workOrder.due_date ||
      workOrder.scheduled_date ||
      workOrder.execution_date ||
      workOrder.date_start;
    return source ? new Date(source) : null;
  }

  private isCompletedStatus(status?: string) {
    return status === 'completed' || status === 'validated';
  }

  /**
   * A plan with no `status` at all is legacy/imported data that predates
   * this lifecycle field entirely (Mongoose defaults only apply on insert,
   * never retroactively to documents already in the database, and the two
   * raw-driver import scripts under backend/scripts/ bypass Mongoose
   * entirely). Treating "no status" the same as Active preserves exactly
   * the scheduling behavior every pre-existing plan already had — only a
   * plan that has explicitly gone through the new lifecycle and is
   * currently Draft/Paused/Archived/Completed is blocked from scheduling.
   */
  private isPlanSchedulable(plan: { status?: MaintenancePlanStatus }): boolean {
    return !plan.status || plan.status === MaintenancePlanStatus.ACTIVE;
  }

  private objectIdString(value: unknown): string {
    if (!value) return '';

    if (typeof value === 'string') {
      return value;
    }

    if (value instanceof Types.ObjectId) {
      return value.toString();
    }

    if (typeof value === 'object' && value !== null && '_id' in value) {
      const maybeId = (value as { _id?: unknown })._id;
      return this.objectIdString(maybeId);
    }

    return '';
  }

  private buildPlanKey(
    machine: unknown,
    moduleEntity: unknown,
    plan: unknown,
  ): string {
    return [
      this.objectIdString(machine),
      this.objectIdString(moduleEntity),
      this.objectIdString(plan),
    ].join('|');
  }

  private async generateWorkOrderCode(type?: string) {
    const sequence = await this.counterService.getNextSequence('work_order');
    const prefix = (type || 'maintenance').toLowerCase().startsWith('correct')
      ? 'WO-COR'
      : 'WO-PREV';
    return `${prefix}-${sequence.toString().padStart(6, '0')}`;
  }

  private async generateReportCode() {
    const sequence = await this.counterService.getNextSequence(
      'intervention_report',
    );
    return `REP-${sequence.toString().padStart(6, '0')}`;
  }

  private async generateKpiCode() {
    const sequence = await this.counterService.getNextSequence('kpi');
    return `KPI-${sequence.toString().padStart(6, '0')}`;
  }

  private async generateLubrificationLogCode() {
    const sequence = await this.counterService.getNextSequence(
      'lubrification_log',
    );
    return `LUB-${sequence.toString().padStart(6, '0')}`;
  }

  private async generatePartRequestCode() {
    const sequence = await this.counterService.getNextSequence(
      'part_request',
    );
    return `PR-${sequence.toString().padStart(6, '0')}`;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: number }).code === 11000
    );
  }

  private getIsoWeek(date: Date) {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private async mesureCriticalAlarmCount() {
    // No schema change: derive count from "critical" sensor status already stored in Mesure.status.
    const now = new Date();
    const last24h = new Date(now);
    last24h.setHours(last24h.getHours() - 24);

    // This collection can be huge; keep a cheap count query.
    const mesureModel = this.workOrderModel.db.model('Mesure');
    return mesureModel.countDocuments({
      status: { $in: ['critical', 'alarm', 'danger'] },
      timestamp: { $gte: last24h, $lte: now },
    });
  }

  private async stockAlertCount() {
    const { count } = await this.kpiService.computeStockAlerts();
    return count;
  }

  private isMaintenanceDocumentType(type?: string) {
    const value = (type || '').toLowerCase();
    if (!value) return false;
    return (
      value.includes('manual') ||
      value.includes('maintenance') ||
      value.includes('electrical') ||
      value.includes('pneumatic') ||
      value.includes('safety') ||
      value.includes('spare') ||
      value.includes('catalogue')
    );
  }
}
