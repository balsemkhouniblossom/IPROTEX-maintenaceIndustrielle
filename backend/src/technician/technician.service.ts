import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { SAFE_USER_PROJECTION } from '../users/safe-user-projection';
import {
  PaginatedResponse,
  PaginationParams,
  toPaginatedResponse,
} from '../common/pagination';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../schemas/maintenance-plan.schema';
import { DocumentEntity, DocumentDocument } from '../schemas/document.schema';
import { OTPieces, OTPiecesDocument } from '../schemas/ot-pieces.schema';
import { Catalogue, CatalogueDocument } from '../schemas/catalogue.schema';
import { Stock, StockDocument } from '../schemas/stock.schema';
import { Capteur, CapteurDocument } from '../schemas/capteur.schema';
import { Mesure, MesureDocument } from '../schemas/mesure.schema';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { WorkOrderAssignmentService } from '../work-orders/services/work-order-assignment.service';
import { WorkOrderLifecycleService } from '../work-orders/services/work-order-lifecycle.service';
import { DocumentAccessService } from '../documents/document-access.service';
import { Role } from '../schemas/user.schema';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { NotificationType } from '../schemas/notification.schema';
import {
  CLOSED_WORK_ORDER_STATUSES,
  COMPLETED_WORK_ORDER_STATUSES,
} from '../common/work-order-status';
import { KpiService } from '../kpi/kpi.service';
import { toWorkOrderResponse } from '../work-orders/contracts/work-order-response.mapper';
import { WorkOrderResponse } from '../work-orders/contracts/work-order-response.types';
import { PartRequestResponse } from '../work-orders/contracts/part-request-response.types';
import { MachineResponse } from '../machines/contracts/machine-response.types';
import { toMachineResponse } from '../machines/contracts/machine-response.mapper';
import {
  InterventionReportResponse,
  toInterventionReportResponse,
  toInterventionReportResponseOrNull,
} from '../common/response/intervention-report-response';
import {
  asPopulatedDoc,
  serializeDate,
} from '../common/response/serialization.util';
import {
  TechnicianPartResponse,
  TechnicianWorkOrderDetailResponse,
} from './contracts/technician-response.types';
import {
  toModuleTypeSummary,
  toTechnicianPartResponse,
} from './contracts/technician-response.mapper';
import {
  StockResponse,
  toStockResponse,
} from '../common/response/catalogue-response';
import {
  DocumentSummaryResponse,
  toDocumentSummary,
} from '../common/response/document-response';

const CLOSED_STATUSES = CLOSED_WORK_ORDER_STATUSES;
const REVIEW_STATUSES = [
  'waiting_validation',
  'technician_required',
  'returned',
];

const STATUS_FILTERS: Record<string, string[]> = {
  assigned: ['assigned'],
  in_progress: ['in_progress', 'EN_COURS'],
  waiting_parts: ['waiting_parts', 'EN_ATTENTE_PIECES'],
  review: REVIEW_STATUSES,
  completed: COMPLETED_WORK_ORDER_STATUSES,
  cancelled: ['cancelled', 'canceled', 'ANNULE'],
};
const MANUAL_DOCUMENT_FILTER: FilterQuery<DocumentDocument> = {
  $or: [
    {
      type_document: {
        $regex: /(manual|pdf|procedure|diagram|excel|xlsx|xls|spreadsheet)/i,
      },
    },
    { file_name: { $regex: /\.(pdf|xlsx?|xls)$/i } },
    { tags: { $regex: /(manual|maintenance-plan|procedure|diagram)/i } },
  ],
};

interface TechnicianFilters {
  status?: string;
  search?: string;
  maintenanceType?: string;
  priority?: string;
  machineId?: string;
  machineTypeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface OperatorSummary {
  _id: string;
  user_id?: string;
  nom_complet: string;
}

export type TechnicianWorkOrderView = WorkOrderResponse & {
  operator?: OperatorSummary;
};

export interface TechnicianDashboardResponse {
  counters: {
    assigned: number;
    inProgress: number;
    waitingParts: number;
    waitingReview: number;
    completedToday: number;
    urgent: number;
    overdue: number;
    dueToday: number;
    waitingValidation: number;
  };
  urgentTasks: TechnicianWorkOrderView[];
  current: TechnicianWorkOrderView[];
  waitingPartsTasks: TechnicianWorkOrderView[];
  upcoming: TechnicianWorkOrderView[];
  recent: TechnicianWorkOrderView[];
  manuals: DocumentSummaryResponse[];
}

export interface TechnicianMachineContextResponse {
  machine: MachineResponse;
  summary: {
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
  };
  components: Array<{
    _id: string;
    module_id: string;
    localisation?: string;
    type?: { _id?: string; name?: string };
    parent_module_id?: string | null;
    sensors: Array<{
      _id: string;
      capteur_id: string;
      code_capteur: string;
      type_capteur: string;
      unite_mesure?: string;
      is_active: boolean;
      last_seen_at?: string;
      latestMeasurement?: {
        _id: string;
        valeur: number;
        timestamp: string;
        status: string;
      } | null;
    }>;
  }>;
  openWork: WorkOrderResponse[];
  upcomingPreventive: Array<{
    _id: string;
    plan_id: string;
    instruction?: string;
    maintenance_code?: string;
    type_maintenance: string;
    nextDue?: string;
  }>;
  recentMaintenance: InterventionReportResponse[];
  documents: DocumentSummaryResponse[];
}

type TechnicianMachineStatsResponse =
  TechnicianMachineContextResponse['summary']['stats'];

type TechnicianMachineListItemResponse = MachineResponse & {
  technicianSummary: {
    stats: {
      openWorkOrders: number;
      lastMaintenanceAt: string | null;
      nextMaintenanceAt: string | null;
    };
  };
};

@Injectable()
export class TechnicianService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrdersModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly reportsModel: Model<InterventionReportDocument>,
    @InjectModel(Machine.name)
    private readonly machinesModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly modulesModel: Model<ModuleDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlansModel: Model<MaintenancePlanDocument>,
    @InjectModel(DocumentEntity.name)
    private readonly documentsModel: Model<DocumentDocument>,
    @InjectModel(OTPieces.name)
    private readonly partsModel: Model<OTPiecesDocument>,
    @InjectModel(Catalogue.name)
    private readonly catalogueModel: Model<CatalogueDocument>,
    @InjectModel(Stock.name) private readonly stockModel: Model<StockDocument>,
    @InjectModel(Capteur.name)
    private readonly capteursModel: Model<CapteurDocument>,
    @InjectModel(Mesure.name)
    private readonly mesuresModel: Model<MesureDocument>,
    private readonly workOrdersService: WorkOrdersService,
    private readonly workOrderAssignmentService: WorkOrderAssignmentService,
    private readonly workOrderLifecycleService: WorkOrderLifecycleService,
    private readonly documentAccessService: DocumentAccessService,
    private readonly notificationCenterService: NotificationCenterService,
    private readonly stockMovementsService: StockMovementsService,
    private readonly kpiService: KpiService,
  ) {}

  private objectId(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException(`Invalid ${label}`);
    return new Types.ObjectId(id);
  }

  private technicianScope(technicianId: string) {
    const id = this.objectId(technicianId, 'technician');
    return { $in: [id, technicianId] };
  }

  private async getAccessibleMachineIds(
    technicianId: string,
  ): Promise<Types.ObjectId[]> {
    const machineIds =
      await this.documentAccessService.listAccessibleMachineIds({
        userId: technicianId,
        role: Role.TECHNICIAN,
      });
    return machineIds ?? [];
  }

  private claimableUnassignedScope(
    machineIds: Types.ObjectId[],
  ): FilterQuery<WorkOrderDocument> | null {
    if (!machineIds.length) return null;
    return {
      machine_id: { $in: machineIds },
      status: { $nin: CLOSED_STATUSES },
      $or: [{ technician_id: { $exists: false } }, { technician_id: null }],
    };
  }

  private async actionableScope(
    technicianId: string,
  ): Promise<FilterQuery<WorkOrderDocument>> {
    const claimableScope = this.claimableUnassignedScope(
      await this.getAccessibleMachineIds(technicianId),
    );
    const branches: FilterQuery<WorkOrderDocument>[] = [
      { technician_id: this.technicianScope(technicianId) },
    ];
    if (claimableScope) branches.push(claimableScope);
    return {
      $or: branches,
    };
  }

  private async visibleScope(
    technicianId: string,
  ): Promise<FilterQuery<WorkOrderDocument>> {
    return this.actionableScope(technicianId);
  }

  private async accessibleManualMachineFilter(
    technicianId: string,
  ): Promise<FilterQuery<DocumentDocument>> {
    const machineIds = await this.getAccessibleMachineIds(technicianId);
    if (!machineIds.length) return { _id: { $exists: false } };
    return {
      machine_id: { $in: machineIds },
    };
  }

  async dashboard(technicianId: string): Promise<TechnicianDashboardResponse> {
    const scope = { technician_id: this.technicianScope(technicianId) };

    const [
      assigned,
      inProgress,
      waitingParts,
      waitingReview,
      kpiCounts,
      urgent,
      current,
      waiting,
      upcoming,
      recent,
    ] = await Promise.all([
      this.workOrdersModel.countDocuments({
        ...scope,
        status: { $in: STATUS_FILTERS.assigned },
      }),
      this.workOrdersModel.countDocuments({
        ...scope,
        status: { $in: STATUS_FILTERS.in_progress },
      }),
      this.workOrdersModel.countDocuments({
        ...scope,
        status: { $in: STATUS_FILTERS.waiting_parts },
      }),
      this.workOrdersModel.countDocuments({
        ...(await this.actionableScope(technicianId)),
        status: { $in: REVIEW_STATUSES },
      }),
      // overdue/dueToday/waitingValidation/completedToday: computed by the
      // shared KpiService (business-timezone-aware boundaries), the same
      // way every other dashboard in the app computes these four numbers.
      this.kpiService.getTechnicianDashboardCounts(technicianId),
      this.workOrdersModel.countDocuments({
        ...(await this.actionableScope(technicianId)),
        priorite: { $regex: /^urgent$/i },
        status: { $nin: CLOSED_STATUSES },
      }),
      this.workOrdersModel
        .find({ ...scope, status: { $in: STATUS_FILTERS.in_progress } })
        .sort({ priorite: -1, date_created: 1 })
        .limit(6)
        .populate({ path: 'machine_id', populate: { path: 'type_id' } })
        .exec(),
      this.workOrdersModel
        .find({ ...scope, status: { $in: STATUS_FILTERS.waiting_parts } })
        .sort({ date_created: 1 })
        .limit(6)
        .populate({ path: 'machine_id', populate: { path: 'type_id' } })
        .exec(),
      this.workOrdersModel
        .find({
          ...scope,
          status: {
            $in: [...STATUS_FILTERS.assigned, ...STATUS_FILTERS.in_progress],
          },
        })
        .sort({ due_date: 1, scheduled_date: 1, date_created: 1 })
        .limit(8)
        .populate({ path: 'machine_id', populate: { path: 'type_id' } })
        .exec(),
      this.workOrdersModel
        .find({ ...scope, status: { $in: STATUS_FILTERS.completed } })
        .sort({ date_closed: -1, date_end: -1 })
        .limit(6)
        .populate({ path: 'machine_id', populate: { path: 'type_id' } })
        .exec(),
    ]);

    const [urgentTasks, manuals] = await Promise.all([
      this.workOrdersModel
        .find({
          ...(await this.actionableScope(technicianId)),
          priorite: { $regex: /^urgent$/i },
          status: { $nin: CLOSED_STATUSES },
        })
        .sort({ date_created: 1 })
        .limit(6)
        .populate({ path: 'machine_id', populate: { path: 'type_id' } })
        .exec(),
      this.getDashboardManualExamples(technicianId),
    ]);
    const [
      urgentWithOperators,
      currentWithOperators,
      waitingWithOperators,
      upcomingWithOperators,
      recentWithOperators,
    ] = await Promise.all([
      this.attachOperators(urgentTasks),
      this.attachOperators(current),
      this.attachOperators(waiting),
      this.attachOperators(upcoming),
      this.attachOperators(recent),
    ]);
    return {
      counters: {
        assigned,
        inProgress,
        waitingParts,
        waitingReview,
        completedToday: kpiCounts.completedTodayCount,
        urgent,
        overdue: kpiCounts.overdueCount,
        dueToday: kpiCounts.dueTodayCount,
        waitingValidation: kpiCounts.waitingValidationCount,
      },
      urgentTasks: urgentWithOperators,
      current: currentWithOperators,
      waitingPartsTasks: waitingWithOperators,
      upcoming: upcomingWithOperators,
      recent: recentWithOperators,
      manuals: manuals.map(toDocumentSummary),
    };
  }

  async machines(
    technicianId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResponse<TechnicianMachineListItemResponse>> {
    const machineIds = await this.getAccessibleMachineIds(technicianId);
    if (!machineIds.length) {
      return toPaginatedResponse([], 0, pagination.page, pagination.limit);
    }

    const query: FilterQuery<MachineDocument> = { _id: { $in: machineIds } };
    const [items, total] = await Promise.all([
      this.machinesModel
        .find(query)
        .sort({ machine_id: 1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate('type_id')
        .exec(),
      this.machinesModel.countDocuments(query).exec(),
    ]);

    const visibleScope = await this.visibleScope(technicianId);
    const summaries = await Promise.all(
      items.map(async (machine) => {
        const machineObjectId = machine._id;
        const [openWorkOrders, lastMaintenance, nextMaintenance] =
          await Promise.all([
            this.workOrdersModel
              .countDocuments({
                machine_id: machineObjectId,
                ...visibleScope,
                status: { $nin: CLOSED_STATUSES },
              })
              .exec(),
            this.workOrdersModel
              .findOne({
                machine_id: machineObjectId,
                ...visibleScope,
                status: { $in: COMPLETED_WORK_ORDER_STATUSES },
              })
              .sort({ date_closed: -1, date_end: -1, execution_date: -1 })
              .select('date_closed date_end execution_date')
              .exec(),
            this.workOrdersModel
              .findOne({
                machine_id: machineObjectId,
                ...visibleScope,
                status: { $nin: CLOSED_STATUSES },
                $or: [
                  { due_date: { $ne: null } },
                  { scheduled_date: { $ne: null } },
                ],
              })
              .sort({ due_date: 1, scheduled_date: 1 })
              .select('due_date scheduled_date')
              .exec(),
          ]);

        return {
          machineId: machine._id.toString(),
          stats: {
            openWorkOrders,
            lastMaintenanceAt:
              serializeDate(
                lastMaintenance?.date_closed ??
                  lastMaintenance?.date_end ??
                  lastMaintenance?.execution_date,
              ) ?? null,
            nextMaintenanceAt:
              serializeDate(
                nextMaintenance?.due_date ?? nextMaintenance?.scheduled_date,
              ) ?? null,
          },
        };
      }),
    );
    const summaryByMachine = new Map(
      summaries.map((summary) => [summary.machineId, summary.stats]),
    );

    return toPaginatedResponse(
      items.map((machine) => ({
        ...toMachineResponse(machine),
        technicianSummary: {
          stats: summaryByMachine.get(machine._id.toString()) ?? {
            openWorkOrders: 0,
            lastMaintenanceAt: null,
            nextMaintenanceAt: null,
          },
        },
      })),
      total,
      pagination.page,
      pagination.limit,
    );
  }

  async machineContext(
    technicianId: string,
    machineId: string,
  ): Promise<TechnicianMachineContextResponse> {
    await this.documentAccessService.assertCanAccessMachine(
      { userId: technicianId, role: Role.TECHNICIAN },
      machineId,
    );
    const machineObjectId = this.objectId(machineId, 'machine');
    const visibleScope = await this.visibleScope(technicianId);

    const [machine, modules, openWork, plans, recentReports, documents, stats] =
      await Promise.all([
        this.machinesModel.findById(machineObjectId).populate('type_id').exec(),
        this.modulesModel
          .find({ machine_id: machineObjectId })
          .populate('mod_type_id')
          .populate('parent_module_id')
          .sort({ module_id: 1 })
          .exec(),
        this.workOrdersModel
          .find({
            machine_id: machineObjectId,
            ...visibleScope,
            status: { $nin: CLOSED_STATUSES },
          })
          .sort({ due_date: 1, date_created: -1 })
          .limit(10)
          .populate({ path: 'machine_id', populate: { path: 'type_id' } })
          .populate('module_id')
          .populate('technician_id', SAFE_USER_PROJECTION)
          .populate('plan_id')
          .exec(),
        this.maintenancePlansModel
          .find({
            $or: [
              { status: { $in: ['active', 'paused'] } },
              { status: { $exists: false } },
            ],
          })
          .populate({
            path: 'module_id',
            match: { machine_id: machineObjectId },
          })
          .sort({ maintenance_code: 1, plan_id: 1 })
          .limit(10)
          .exec(),
        this.reportsModel
          .find()
          .populate({
            path: 'ot_id',
            match: { machine_id: machineObjectId },
            populate: { path: 'machine_id' },
          })
          .populate('technician_id', SAFE_USER_PROJECTION)
          .sort({ date_fin: -1, date_debut: -1 })
          .limit(10)
          .exec(),
        this.documentsModel
          .find({ machine_id: machineObjectId })
          .sort({ date_ajout: -1 })
          .limit(20)
          .exec(),
        this.getTechnicianMachineStats(machineObjectId, visibleScope),
      ]);
    if (!machine) throw new NotFoundException('Machine not found');

    const moduleIds = modules.map((module) => module._id);
    const sensors = moduleIds.length
      ? await this.capteursModel
          .find({ module_id: { $in: moduleIds } })
          .sort({ type_capteur: 1, code_capteur: 1 })
          .exec()
      : [];
    const latestMeasurements = await Promise.all(
      sensors.map((sensor) =>
        this.mesuresModel
          .findOne({ capteur_id: sensor._id })
          .sort({ timestamp: -1 })
          .exec(),
      ),
    );
    const latestBySensor = new Map(
      sensors.map((sensor, index) => [
        sensor._id.toString(),
        latestMeasurements[index] ?? null,
      ]),
    );
    const sensorsByModule = new Map<string, CapteurDocument[]>();
    for (const sensor of sensors) {
      const key = this.referenceId(sensor.module_id)?.toString();
      if (!key) continue;
      sensorsByModule.set(key, [...(sensorsByModule.get(key) ?? []), sensor]);
    }

    return {
      machine: toMachineResponse(machine),
      summary: { stats },
      components: modules.map((module) => {
        return {
          _id: module._id.toString(),
          module_id: module.module_id,
          localisation: module.localisation,
          type: toModuleTypeSummary(module.mod_type_id),
          parent_module_id:
            this.referenceId(module.parent_module_id)?.toString() ?? null,
          sensors: (sensorsByModule.get(module._id.toString()) ?? []).map(
            (sensor) => {
              const latest = latestBySensor.get(sensor._id.toString());
              return {
                _id: sensor._id.toString(),
                capteur_id: sensor.capteur_id,
                code_capteur: sensor.code_capteur,
                type_capteur: sensor.type_capteur,
                unite_mesure: sensor.unite_mesure,
                is_active: sensor.is_active,
                last_seen_at: sensor.last_seen_at?.toISOString(),
                latestMeasurement: latest
                  ? {
                      _id: latest._id.toString(),
                      valeur: latest.valeur,
                      timestamp: latest.timestamp.toISOString(),
                      status: latest.status,
                    }
                  : null,
              };
            },
          ),
        };
      }),
      openWork: openWork.map(toWorkOrderResponse),
      upcomingPreventive: plans
        .filter((plan) => Boolean(plan.module_id))
        .map((plan) => ({
          _id: plan._id.toString(),
          plan_id: plan.plan_id,
          instruction: plan.instruction,
          maintenance_code: plan.maintenance_code,
          type_maintenance: plan.type_maintenance,
        })),
      recentMaintenance: recentReports
        .filter((report) => Boolean(report.ot_id))
        .map(toInterventionReportResponse),
      documents: documents.map(toDocumentSummary),
    };
  }

  private async getTechnicianMachineStats(
    machineObjectId: Types.ObjectId,
    visibleScope: FilterQuery<WorkOrderDocument>,
  ): Promise<TechnicianMachineStatsResponse> {
    const [workOrders, partsConsumed] = await Promise.all([
      this.workOrdersModel
        .find({ machine_id: machineObjectId, ...visibleScope })
        .select(
          'status type_maintenance date_start date_end date_closed execution_date due_date scheduled_date',
        )
        .exec(),
      this.partsModel
        .aggregate<{ total: number }>([
          {
            $lookup: {
              from: 'workorders',
              localField: 'ot_id',
              foreignField: '_id',
              as: 'workOrder',
            },
          },
          { $unwind: '$workOrder' },
          { $match: { 'workOrder.machine_id': machineObjectId } },
          { $group: { _id: null, total: { $sum: '$quantite_utilisee' } } },
        ])
        .exec(),
    ]);
    const completed = workOrders.filter((order) =>
      COMPLETED_WORK_ORDER_STATUSES.includes(order.status),
    );
    const open = workOrders.filter(
      (order) => !CLOSED_STATUSES.includes(order.status),
    );
    const timedDurations = completed
      .map((order) => {
        const start = order.date_start?.getTime();
        const end = (order.date_end ?? order.date_closed)?.getTime();
        return start && end && end > start ? (end - start) / 36e5 : null;
      })
      .filter((value): value is number => value != null);
    const sortedCompleted = [...completed].sort(
      (left, right) =>
        ((
          right.date_closed ??
          right.date_end ??
          right.execution_date
        )?.getTime() ?? 0) -
        ((
          left.date_closed ??
          left.date_end ??
          left.execution_date
        )?.getTime() ?? 0),
    );
    const sortedOpen = [...open].sort(
      (left, right) =>
        ((left.due_date ?? left.scheduled_date)?.getTime() ??
          Number.MAX_SAFE_INTEGER) -
        ((right.due_date ?? right.scheduled_date)?.getTime() ??
          Number.MAX_SAFE_INTEGER),
    );
    const lastMaintenance = sortedCompleted[0];
    const nextMaintenance = sortedOpen.find(
      (order) => order.due_date || order.scheduled_date,
    );

    return {
      totalInterventions: workOrders.length,
      preventiveCompleted: completed.filter(
        (order) => order.type_maintenance?.toLowerCase() === 'preventive',
      ).length,
      correctiveCompleted: completed.filter(
        (order) => order.type_maintenance?.toLowerCase() === 'corrective',
      ).length,
      openWorkOrders: open.length,
      closedWorkOrders: workOrders.length - open.length,
      downtimeHours: timedDurations.reduce((sum, value) => sum + value, 0),
      averageRepairTimeHours: timedDurations.length
        ? timedDurations.reduce((sum, value) => sum + value, 0) /
          timedDurations.length
        : null,
      partsConsumed: partsConsumed[0]?.total ?? 0,
      lastMaintenanceAt:
        serializeDate(
          lastMaintenance?.date_closed ??
            lastMaintenance?.date_end ??
            lastMaintenance?.execution_date,
        ) ?? null,
      nextMaintenanceAt:
        serializeDate(
          nextMaintenance?.due_date ?? nextMaintenance?.scheduled_date,
        ) ?? null,
      lastInspectionAt: null,
      lastLubricationAt: null,
    };
  }

  async workOrders(
    technicianId: string,
    pagination: PaginationParams,
    filters: TechnicianFilters,
  ): Promise<PaginatedResponse<TechnicianWorkOrderView>> {
    const query: FilterQuery<WorkOrderDocument> = {
      ...(await this.visibleScope(technicianId)),
    };
    if (filters.status)
      query.status = {
        $in: STATUS_FILTERS[filters.status] || [filters.status],
      };
    if (filters.maintenanceType)
      query.type_maintenance = filters.maintenanceType;
    if (filters.priority) query.priorite = filters.priority;
    if (filters.search?.trim()) {
      const term = filters.search.trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const machines = await this.machinesModel
        .find({
          $or: [
            { machine_id: regex },
            { reference: regex },
            { model: regex },
            { serial_no: regex },
            { fabricant: regex },
            { location: regex },
          ],
        })
        .select('_id')
        .limit(100)
        .exec();
      query.$and = [
        ...(Array.isArray(query.$and) ? query.$and : []),
        {
          $or: [
            { ot_id: regex },
            { description: regex },
            { code_panne: regex },
            { type_maintenance: regex },
            { priorite: regex },
            ...(machines.length
              ? [
                  {
                    machine_id: { $in: machines.map((machine) => machine._id) },
                  },
                ]
              : []),
          ],
        },
      ];
    }
    if (filters.machineId)
      query.machine_id = this.objectId(filters.machineId, 'machine');
    if (filters.machineTypeId) {
      const machines = await this.machinesModel
        .find({ type_id: this.objectId(filters.machineTypeId, 'machine type') })
        .select('_id')
        .exec();
      query.machine_id = { $in: machines.map((machine) => machine._id) };
    }
    if (filters.dateFrom || filters.dateTo) {
      const date: { $gte?: Date; $lte?: Date } = {};
      if (filters.dateFrom) date.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        date.$lte = new Date(filters.dateTo);
        if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo)) {
          date.$lte.setHours(23, 59, 59, 999);
        }
      }
      if (Object.values(date).some((value) => Number.isNaN(value.getTime())))
        throw new BadRequestException('Invalid date filter');
      query.due_date = date;
    }

    const now = new Date();
    const dueSortDate = {
      $ifNull: ['$due_date', { $ifNull: ['$scheduled_date', '$date_start'] }],
    };
    const priorityOrder = {
      $cond: [
        {
          $and: [
            { $ne: [dueSortDate, null] },
            { $lt: [dueSortDate, now] },
            { $not: [{ $in: ['$status', CLOSED_STATUSES] }] },
          ],
        },
        0,
        {
          $cond: [
            { $eq: [{ $toLower: { $ifNull: ['$priorite', ''] } }, 'urgent'] },
            1,
            {
              $cond: [
                { $eq: [{ $toLower: { $ifNull: ['$priorite', ''] } }, 'high'] },
                2,
                {
                  $cond: [{ $ne: [dueSortDate, null] }, 3, 4],
                },
              ],
            },
          ],
        },
      ],
    };
    const [ids, totalItems] = await Promise.all([
      this.workOrdersModel
        .aggregate<{
          _id: Types.ObjectId;
        }>([
          { $match: query },
          { $addFields: { technicianSort: priorityOrder, dueSortDate } },
          { $sort: { technicianSort: 1, dueSortDate: 1, date_created: -1 } },
          { $skip: pagination.skip },
          { $limit: pagination.limit },
          { $project: { _id: 1 } },
        ])
        .exec(),
      this.workOrdersModel.countDocuments(query).exec(),
    ]);
    const order = new Map(
      ids.map((item, index) => [item._id.toString(), index]),
    );
    const items = await this.workOrdersModel
      .find({ _id: { $in: ids.map((item) => item._id) } })
      .populate({ path: 'machine_id', populate: { path: 'type_id' } })
      .populate('technician_id', SAFE_USER_PROJECTION)
      .exec();
    items.sort(
      (a, b) =>
        (order.get(a._id.toString()) ?? 0) - (order.get(b._id.toString()) ?? 0),
    );
    const itemsWithOperators = await this.attachOperators(items);
    return toPaginatedResponse(
      itemsWithOperators,
      totalItems,
      pagination.page,
      pagination.limit,
    );
  }

  private async attachOperators(
    workOrders: WorkOrderDocument[],
  ): Promise<TechnicianWorkOrderView[]> {
    if (!workOrders.length) return [];

    const reports = await this.reportsModel
      .find({ ot_id: { $in: workOrders.map((workOrder) => workOrder._id) } })
      .sort({ date_debut: 1 })
      .populate({
        path: 'technician_id',
        match: { role: 'operator' },
        select: SAFE_USER_PROJECTION,
      })
      .exec();

    const operatorsByWorkOrder = new Map<string, OperatorSummary>();
    for (const report of reports) {
      const owner = asPopulatedDoc<{
        _id?: Types.ObjectId;
        user_id?: string;
        nom_complet?: string;
        role?: string;
      }>(report.technician_id);
      if (!owner?.nom_complet || owner.role !== 'operator') continue;
      const workOrderId = this.referenceId(report.ot_id)?.toString() || '';
      if (!workOrderId || operatorsByWorkOrder.has(workOrderId)) continue;
      operatorsByWorkOrder.set(workOrderId, {
        _id: owner._id?.toString() || '',
        user_id: owner.user_id,
        nom_complet: owner.nom_complet,
      });
    }

    return workOrders.map((workOrder) => {
      const response = toWorkOrderResponse(workOrder);
      const operator = operatorsByWorkOrder.get(workOrder._id.toString());
      return operator ? { ...response, operator } : response;
    });
  }

  private async getDashboardManualExamples(technicianId: string) {
    const examples = await this.documentsModel
      .aggregate([
        {
          $match: {
            ...MANUAL_DOCUMENT_FILTER,
            ...(await this.accessibleManualMachineFilter(technicianId)),
          },
        },
        {
          $lookup: {
            from: this.machinesModel.collection.name,
            localField: 'machine_id',
            foreignField: '_id',
            as: 'dashboardMachine',
          },
        },
        {
          $unwind: {
            path: '$dashboardMachine',
            preserveNullAndEmptyArrays: true,
          },
        },
        { $sort: { date_ajout: -1 } },
        {
          $group: {
            _id: { $ifNull: ['$dashboardMachine.type_id', null] },
            document: { $first: '$$ROOT' },
          },
        },
        { $replaceRoot: { newRoot: '$document' } },
        { $unset: 'dashboardMachine' },
        { $sort: { date_ajout: -1 } },
      ])
      .exec();

    return this.documentsModel.populate(examples, {
      path: 'machine_id',
      populate: { path: 'type_id' },
    });
  }

  async details(
    technicianId: string,
    workOrderId: string,
  ): Promise<TechnicianWorkOrderDetailResponse> {
    const workOrder = await this.workOrdersModel
      .findOne({
        _id: this.objectId(workOrderId, 'work order'),
        ...(await this.visibleScope(technicianId)),
      })
      .populate({ path: 'machine_id', populate: { path: 'type_id' } })
      .populate('module_id')
      .populate('technician_id', SAFE_USER_PROJECTION)
      .populate('plan_id')
      .exec();
    if (!workOrder) throw new NotFoundException('Work order not found');
    const machineId = this.referenceId(workOrder.machine_id);
    // The record passed the visibility scope, but every machine-scoped detail
    // view must still pass the explicit document-level machine authorization.
    if (machineId) {
      await this.documentAccessService.assertCanAccessMachine(
        { userId: technicianId, role: Role.TECHNICIAN },
        machineId.toString(),
      );
    }
    const manualScope = await this.accessibleManualMachineFilter(technicianId);
    const manualQuery: FilterQuery<DocumentDocument> | null = machineId
      ? {
          ...MANUAL_DOCUMENT_FILTER,
          $and: [{ machine_id: machineId }, manualScope],
        }
      : null;
    const [report, parts, manuals] = await Promise.all([
      this.reportsModel
        .findOne({ ot_id: workOrder._id })
        .populate('technician_id', SAFE_USER_PROJECTION)
        .exec(),
      this.partsModel.find({ ot_id: workOrder._id }).populate('part_id').exec(),
      manualQuery
        ? this.documentsModel.find(manualQuery).sort({ date_ajout: -1 }).exec()
        : [],
    ]);
    const stock = await this.stockModel
      .find({
        part_id: {
          $in: parts
            .map((part) => this.referenceId(part.part_id))
            .filter(Boolean),
        },
      })
      .populate('part_id')
      .exec();
    return {
      workOrder: toWorkOrderResponse(workOrder),
      report: toInterventionReportResponseOrNull(report),
      parts: parts.map(toTechnicianPartResponse),
      stock: stock.map(toStockResponse),
      manuals: manuals.map(toDocumentSummary),
    };
  }

  async manuals(
    technicianId: string,
    pagination: PaginationParams,
    machineId?: string,
  ): Promise<PaginatedResponse<DocumentSummaryResponse>> {
    this.objectId(technicianId, 'technician');
    const query: FilterQuery<DocumentDocument> = {
      ...MANUAL_DOCUMENT_FILTER,
      ...(await this.accessibleManualMachineFilter(technicianId)),
    };
    if (machineId) {
      await this.documentAccessService.assertCanAccessMachine(
        { userId: technicianId, role: Role.TECHNICIAN },
        machineId,
      );
      query.machine_id = this.objectId(machineId, 'machine');
    }
    const [items, total] = await Promise.all([
      this.documentsModel
        .find(query)
        .sort({ date_ajout: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate('machine_id')
        .exec(),
      this.documentsModel.countDocuments(query).exec(),
    ]);
    return toPaginatedResponse(
      items.map(toDocumentSummary),
      total,
      pagination.page,
      pagination.limit,
    );
  }

  async availableParts(
    technicianId: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResponse<StockResponse>> {
    this.objectId(technicianId, 'technician');
    const [stocks, total] = await Promise.all([
      this.stockModel
        .find()
        .sort({ quantite_en_stock: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .populate('part_id')
        .exec(),
      this.stockModel.countDocuments().exec(),
    ]);
    return toPaginatedResponse(
      stocks.map(toStockResponse),
      total,
      pagination.page,
      pagination.limit,
    );
  }

  async claim(
    technicianId: string,
    workOrderId: string,
  ): Promise<WorkOrderResponse> {
    const workOrder = await this.workOrderAssignmentService.claimForTechnician({
      technicianId,
      workOrderId,
      accessibleMachineIds: await this.getAccessibleMachineIds(technicianId),
    });
    return toWorkOrderResponse(workOrder);
  }

  /**
   * A technician's own "review" of a work order actionable in their scope
   * can never include final approval: `actionableScope` only ever matches
   * work orders assigned to this same technician (or unclaimed ones), so an
   * 'approve' here would always be self-approval. Final validation is
   * reserved for an independent authorized user via
   * `WorkOrdersService.applyValidationAction` through the Admin-only
   * validation endpoint. Only sending it back for correction, or starting
   * work on it, are legitimate self-service actions here.
   */
  async review(
    technicianId: string,
    workOrderId: string,
    action?: 'return' | 'intervene',
  ): Promise<WorkOrderResponse | null> {
    if (!action || !['return', 'intervene'].includes(action))
      throw new BadRequestException('Invalid review action');
    if (action === 'intervene') return this.start(technicianId, workOrderId);
    const id = this.objectId(workOrderId, 'work order');
    const reviewable = await this.workOrdersModel
      .findOne({
        _id: id,
        ...(await this.actionableScope(technicianId)),
        status: { $in: REVIEW_STATUSES },
      })
      .exec();
    if (!reviewable)
      throw new ConflictException('Report is no longer awaiting review');
    return this.workOrdersService.applyValidationAction(
      workOrderId,
      'request_correction',
      technicianId,
    );
  }

  async start(
    technicianId: string,
    workOrderId: string,
  ): Promise<WorkOrderResponse> {
    const workOrder = await this.workOrderLifecycleService.startForTechnician({
      technicianId,
      workOrderId,
      accessibleMachineIds: await this.getAccessibleMachineIds(technicianId),
    });
    return toWorkOrderResponse(workOrder);
  }

  async waitingParts(
    technicianId: string,
    workOrderId: string,
  ): Promise<WorkOrderResponse> {
    const workOrder =
      await this.workOrderLifecycleService.transitionForTechnician({
        technicianId,
        workOrderId,
        from: ['in_progress'],
        to: 'waiting_parts',
      });
    return toWorkOrderResponse(workOrder);
  }

  async resume(
    technicianId: string,
    workOrderId: string,
  ): Promise<WorkOrderResponse> {
    const workOrder =
      await this.workOrderLifecycleService.transitionForTechnician({
        technicianId,
        workOrderId,
        from: ['waiting_parts'],
        to: 'in_progress',
      });
    return toWorkOrderResponse(workOrder);
  }

  async updateReport(
    technicianId: string,
    workOrderId: string,
    update: {
      cause_racine?: string;
      description_action?: string;
      etat_final?: string;
    },
  ): Promise<InterventionReportResponse> {
    const id = this.objectId(workOrderId, 'work order');
    const workOrder = await this.workOrdersModel
      .findOne({
        _id: id,
        technician_id: this.technicianScope(technicianId),
        status: { $nin: CLOSED_STATUSES },
      })
      .exec();
    if (!workOrder) throw new ForbiddenException('Work order is not editable');
    const allowed = Object.fromEntries(
      Object.entries(update).filter(
        ([key, value]) =>
          ['cause_racine', 'description_action', 'etat_final'].includes(key) &&
          typeof value === 'string',
      ),
    );
    const report = await this.reportsModel
      .findOneAndUpdate({ ot_id: id }, { $set: allowed }, { new: true })
      .exec();
    if (!report) throw new NotFoundException('Intervention report not found');
    return toInterventionReportResponse(report);
  }

  async setPartQuantity(
    technicianId: string,
    workOrderId: string,
    partId?: string,
    quantity?: number,
  ): Promise<TechnicianPartResponse> {
    if (!partId) throw new BadRequestException('Part is required');
    if (!Number.isInteger(quantity) || (quantity ?? 0) <= 0)
      throw new BadRequestException('Part quantity must be a positive integer');
    const workOrder = this.objectId(workOrderId, 'work order');
    const part = this.objectId(partId, 'part');
    const session = await this.workOrdersModel.db.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const [order, catalogue] = await Promise.all([
          this.workOrdersModel
            .findOne({
              _id: workOrder,
              technician_id: this.technicianScope(technicianId),
              status: { $in: ['in_progress', 'waiting_parts'] },
            })
            .session(session)
            .exec(),
          this.catalogueModel.findById(part).session(session).exec(),
        ]);
        if (!order)
          throw new ForbiddenException('Work order is not available for parts');
        if (!catalogue) throw new NotFoundException('Part not found');
        const existing = await this.partsModel
          .findOne({ ot_id: workOrder, part_id: part })
          .session(session)
          .exec();
        const previous = existing?.quantite ?? 0;
        const delta = (quantity as number) - previous;
        if (delta !== 0) {
          const stock = await this.stockModel
            .findOne({ part_id: part })
            .session(session)
            .exec();
          if (!stock) {
            throw new NotFoundException('No stock record exists for this part');
          }
          await this.stockMovementsService.recordUsageChange(session, {
            stockId: stock._id.toString(),
            partId: part.toString(),
            delta,
            workOrderId: workOrder.toString(),
            actorId: technicianId,
          });
        }
        if (existing) {
          existing.quantite = quantity as number;
          return existing.save({ session });
        }
        return this.partsModel
          .create([{ ot_id: workOrder, part_id: part, quantite: quantity }], {
            session,
          })
          .then((rows) => rows[0]);
      });
      return toTechnicianPartResponse(result);
    } finally {
      await session.endSession();
    }
  }

  async requestPart(
    technicianId: string,
    workOrderId: string,
    partId?: string,
    quantity?: number,
  ): Promise<PartRequestResponse> {
    if (!partId) throw new BadRequestException('Part is required');
    if (!Number.isInteger(quantity) || (quantity ?? 0) <= 0)
      throw new BadRequestException('Part quantity must be a positive integer');
    return this.workOrdersService.requestPartsForOperator({
      operatorId: technicianId,
      workOrderId,
      partId,
      quantity: quantity as number,
    });
  }

  /**
   * Finishes the technician's own hands-on work and submits it for
   * independent validation â€” it never self-finalizes to `completed`. A
   * technician can never be the one who validates their own corrective or
   * preventive work: only `WorkOrdersService.applyValidationAction` (reached
   * via the Admin-only `/work-orders/:id/validation` endpoint) can move a
   * `waiting_validation` order on to `validated`, and that method refuses to
   * let the performer validate themselves. This mirrors how an Operator's
   * own submission already works â€” never straight to a terminal status.
   */
  async close(
    technicianId: string,
    workOrderId: string,
  ): Promise<WorkOrderResponse> {
    const id = this.objectId(workOrderId, 'work order');
    const report =
      await this.workOrderLifecycleService.requireInterventionReport(
        workOrderId,
      );
    const updated = await this.workOrderLifecycleService.closeForTechnician({
      technicianId,
      workOrderId,
      report,
    });

    await this.notificationCenterService.createIfNotExists({
      dedupeKey: `intervention_completed:${id.toString()}`,
      type: NotificationType.INTERVENTION_COMPLETED,
      title: `Intervention completed for work order ${updated.ot_id} - awaiting validation`,
      translationKey: 'templates.interventionCompleted',
      translationParams: { workOrder: updated.ot_id },
      recipientRole: Role.ADMIN,
      workOrderId: id.toString(),
      machineId: updated.machine_id?.toString(),
      referenceId: report._id.toString(),
    });

    return toWorkOrderResponse(updated);
  }

  private referenceId(value: unknown): Types.ObjectId | undefined {
    if (value instanceof Types.ObjectId) return value;
    if (value && typeof value === 'object' && '_id' in value) {
      const id = (value as { _id?: unknown })._id;
      if (id instanceof Types.ObjectId) return id;
      if (typeof id === 'string' && Types.ObjectId.isValid(id))
        return new Types.ObjectId(id);
    }
    if (typeof value === 'string' && Types.ObjectId.isValid(value))
      return new Types.ObjectId(value);
    return undefined;
  }
}
