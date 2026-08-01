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
import { DocumentEntity, DocumentDocument } from '../schemas/document.schema';
import { OTPieces, OTPiecesDocument } from '../schemas/ot-pieces.schema';
import { Catalogue, CatalogueDocument } from '../schemas/catalogue.schema';
import { Stock, StockDocument } from '../schemas/stock.schema';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { WorkOrdersService } from '../work-orders/work-orders.service';
import { DocumentAccessService } from '../documents/document-access.service';
import { Role } from '../schemas/user.schema';
import { NotificationCenterService } from '../notification-center/notification-center.service';
import { NotificationType } from '../schemas/notification.schema';
import {
  CLOSED_WORK_ORDER_STATUSES,
  COMPLETED_WORK_ORDER_STATUSES,
} from '../common/work-order-status';
import { KpiService } from '../kpi/kpi.service';

const CLOSED_STATUSES = CLOSED_WORK_ORDER_STATUSES;
const REVIEW_STATUSES = [
  'waiting_validation',
  'technician_required',
  'returned',
];
const STARTABLE_STATUSES = [
  'waiting_validation',
  'technician_required',
  'assigned',
  'returned',
];
const STATUS_FILTERS: Record<string, string[]> = {
  in_progress: ['in_progress', 'EN_COURS'],
  waiting_parts: ['waiting_parts', 'EN_ATTENTE_PIECES'],
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

export type TechnicianWorkOrderView = Record<string, unknown> & {
  operator?: OperatorSummary;
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
    @InjectModel(DocumentEntity.name)
    private readonly documentsModel: Model<DocumentDocument>,
    @InjectModel(OTPieces.name)
    private readonly partsModel: Model<OTPiecesDocument>,
    @InjectModel(Catalogue.name)
    private readonly catalogueModel: Model<CatalogueDocument>,
    @InjectModel(Stock.name) private readonly stockModel: Model<StockDocument>,
    private readonly workOrdersService: WorkOrdersService,
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

  private async claimableWorkOrderScope(
    technicianId: string,
  ): Promise<FilterQuery<WorkOrderDocument>> {
    const claimableScope = this.claimableUnassignedScope(
      await this.getAccessibleMachineIds(technicianId),
    );
    if (!claimableScope) {
      return { machine_id: { $in: [] } };
    }
    return claimableScope;
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

  async dashboard(technicianId: string) {
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
      recent,
    ] = await Promise.all([
      this.workOrdersModel.countDocuments({
        ...scope,
        status: { $nin: CLOSED_STATUSES },
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
      recentWithOperators,
    ] = await Promise.all([
      this.attachOperators(urgentTasks),
      this.attachOperators(current),
      this.attachOperators(waiting),
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
      recent: recentWithOperators,
      manuals,
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
      if (filters.dateTo) date.$lte = new Date(filters.dateTo);
      if (Object.values(date).some((value) => Number.isNaN(value.getTime())))
        throw new BadRequestException('Invalid date filter');
      query.date_created = date;
    }

    const priorityOrder = {
      $switch: {
        branches: [
          {
            case: {
              $eq: [{ $toLower: { $ifNull: ['$priorite', ''] } }, 'urgent'],
            },
            then: 0,
          },
          { case: { $in: ['$status', REVIEW_STATUSES] }, then: 1 },
          { case: { $eq: ['$status', 'assigned'] }, then: 2 },
          { case: { $eq: ['$status', 'in_progress'] }, then: 3 },
          { case: { $eq: ['$status', 'waiting_parts'] }, then: 4 },
        ],
        default: 5,
      },
    };
    const [ids, totalItems] = await Promise.all([
      this.workOrdersModel
        .aggregate<{
          _id: Types.ObjectId;
        }>([
          { $match: query },
          { $addFields: { technicianSort: priorityOrder } },
          { $sort: { technicianSort: 1, date_created: -1 } },
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
      const owner = report.technician_id as unknown as {
        _id?: Types.ObjectId;
        user_id?: string;
        nom_complet?: string;
        role?: string;
      } | null;
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
      const object = workOrder.toObject() as unknown as Record<string, unknown>;
      const operator = operatorsByWorkOrder.get(workOrder._id.toString());
      return operator ? { ...object, operator } : object;
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

  async details(technicianId: string, workOrderId: string) {
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
    if (machineId) {
      await this.documentAccessService.assertCanAccessMachine(
        { userId: technicianId, role: Role.TECHNICIAN },
        machineId.toHexString(),
      );
    }
    const [report, parts, manuals] = await Promise.all([
      this.reportsModel
        .findOne({ ot_id: workOrder._id })
        .populate('technician_id', SAFE_USER_PROJECTION)
        .exec(),
      this.partsModel.find({ ot_id: workOrder._id }).populate('part_id').exec(),
      machineId
        ? this.documentsModel
            .find({ machine_id: machineId, ...MANUAL_DOCUMENT_FILTER })
            .sort({ date_ajout: -1 })
            .exec()
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
    return { workOrder, report, parts, stock, manuals };
  }

  async manuals(
    technicianId: string,
    pagination: PaginationParams,
    machineId?: string,
  ): Promise<PaginatedResponse<DocumentEntity>> {
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
    return toPaginatedResponse(items, total, pagination.page, pagination.limit);
  }

  async availableParts(technicianId: string, pagination: PaginationParams) {
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
      stocks,
      total,
      pagination.page,
      pagination.limit,
    );
  }

  async claim(technicianId: string, workOrderId: string) {
    const technician = this.objectId(technicianId, 'technician');
    const id = this.objectId(workOrderId, 'work order');
    const alreadyMine = await this.workOrdersModel
      .findOne({ _id: id, technician_id: this.technicianScope(technicianId) })
      .exec();
    if (alreadyMine) return alreadyMine;
    const claimed = await this.workOrdersModel
      .findOneAndUpdate(
        {
          _id: id,
          ...(await this.claimableWorkOrderScope(technicianId)),
        },
        { $set: { technician_id: technician, status: 'assigned' } },
        { new: true },
      )
      .exec();
    if (!claimed)
      throw new ConflictException('Work order is closed or already assigned');
    return claimed;
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
  ) {
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
    const updated = await this.workOrdersService.applyValidationAction(
      workOrderId,
      'request_correction',
      technicianId,
    );
    return updated;
  }

  async start(technicianId: string, workOrderId: string) {
    const id = this.objectId(workOrderId, 'work order');
    const technician = this.objectId(technicianId, 'technician');
    const existing = await this.workOrdersModel
      .findOne({
        _id: id,
        technician_id: this.technicianScope(technicianId),
        status: 'in_progress',
      })
      .exec();
    if (existing) return existing;
    const updated = await this.workOrdersModel
      .findOneAndUpdate(
        {
          _id: id,
          status: { $in: STARTABLE_STATUSES },
          $or: [
            { technician_id: this.technicianScope(technicianId) },
            await this.claimableWorkOrderScope(technicianId),
          ],
        },
        {
          $set: {
            status: 'in_progress',
            technician_id: technician,
            date_start: new Date(),
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) throw new ConflictException('Work order cannot be started');
    await this.reportsModel
      .updateOne(
        { ot_id: id },
        {
          $set: {
            validation_responsable: 'validated',
          },
        },
      )
      .exec();
    return updated;
  }

  async waitingParts(technicianId: string, workOrderId: string) {
    return this.transition(
      technicianId,
      workOrderId,
      ['in_progress'],
      'waiting_parts',
    );
  }

  async resume(technicianId: string, workOrderId: string) {
    return this.transition(
      technicianId,
      workOrderId,
      ['waiting_parts'],
      'in_progress',
    );
  }

  private async transition(
    technicianId: string,
    workOrderId: string,
    from: string[],
    to: string,
  ) {
    const updated = await this.workOrdersModel
      .findOneAndUpdate(
        {
          _id: this.objectId(workOrderId, 'work order'),
          technician_id: this.technicianScope(technicianId),
          status: { $in: from },
        },
        { $set: { status: to } },
        { new: true },
      )
      .exec();
    if (!updated)
      throw new ConflictException('Invalid work-order status transition');
    return updated;
  }

  async updateReport(
    technicianId: string,
    workOrderId: string,
    update: {
      cause_racine?: string;
      description_action?: string;
      etat_final?: string;
    },
  ) {
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
    return report;
  }

  async setPartQuantity(
    technicianId: string,
    workOrderId: string,
    partId?: string,
    quantity?: number,
  ) {
    if (!partId) throw new BadRequestException('Part is required');
    if (!Number.isInteger(quantity) || (quantity ?? 0) <= 0)
      throw new BadRequestException('Part quantity must be a positive integer');
    const workOrder = this.objectId(workOrderId, 'work order');
    const part = this.objectId(partId, 'part');
    const session = await this.workOrdersModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
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
    } finally {
      await session.endSession();
    }
  }

  /**
   * Finishes the technician's own hands-on work and submits it for
   * independent validation — it never self-finalizes to `completed`. A
   * technician can never be the one who validates their own corrective or
   * preventive work: only `WorkOrdersService.applyValidationAction` (reached
   * via the Admin-only `/work-orders/:id/validation` endpoint) can move a
   * `waiting_validation` order on to `validated`, and that method refuses to
   * let the performer validate themselves. This mirrors how an Operator's
   * own submission already works — never straight to a terminal status.
   */
  async close(technicianId: string, workOrderId: string) {
    const id = this.objectId(workOrderId, 'work order');
    const report = await this.reportsModel.findOne({ ot_id: id }).exec();
    if (!report) throw new NotFoundException('Intervention report not found');
    if (!report.description_action?.trim() || !report.etat_final?.trim())
      throw new BadRequestException('Technical action and result are required');
    const now = new Date();
    const updated = await this.workOrdersModel
      .findOneAndUpdate(
        {
          _id: id,
          technician_id: this.technicianScope(technicianId),
          status: 'in_progress',
        },
        {
          $set: {
            status: 'waiting_validation',
            date_end: now,
            date_closed: now,
          },
          $push: {
            lifecycle_history: {
              action: 'closed_for_validation',
              from_status: 'in_progress',
              to_status: 'waiting_validation',
              actor_user_id: this.objectId(technicianId, 'technician'),
              at: now,
            },
          },
        },
        { new: true },
      )
      .exec();
    if (!updated)
      throw new ConflictException(
        'Work order must be in progress before closing',
      );
    await this.reportsModel
      .updateOne(
        { _id: report._id },
        {
          $set: { date_fin: now, validation_responsable: 'waiting_validation' },
        },
      )
      .exec();

    await this.notificationCenterService.createIfNotExists({
      dedupeKey: `intervention_completed:${id.toString()}`,
      type: NotificationType.INTERVENTION_COMPLETED,
      title: `Intervention completed for work order ${updated.ot_id} — awaiting validation`,
      recipientRole: Role.ADMIN,
      workOrderId: id.toString(),
      machineId: updated.machine_id?.toString(),
      referenceId: report._id.toString(),
    });

    return updated;
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
