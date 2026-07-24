import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { MachineType, MachineTypeDocument } from '../schemas/machine-type.schema';
import { Module, ModuleDocument } from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../schemas/maintenance-plan.schema';
import { Lubrifiant, LubrifiantDocument } from '../schemas/lubrifiant.schema';
import { KPI, KPIDocument } from '../schemas/kpi.schema';
import { Catalogue, CatalogueDocument } from '../schemas/catalogue.schema';
import { Stock, StockDocument } from '../schemas/stock.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { DocumentEntity, DocumentDocument } from '../schemas/document.schema';
import { Panne, PanneDocument } from '../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionDocument,
} from '../schemas/panne-solution.schema';
import { WorkOrdersService } from '../work-orders/work-orders.service';

type CalendarView = 'day' | 'week' | 'month' | 'year' | 'timeline';

interface CalendarFilters {
  machineId?: string;
  machineTypeId?: string;
  maintenanceType?: string;
  status?: string;
  priority?: string;
  month?: number;
  week?: number;
  year?: number;
}

interface FaultFilters {
  machineId?: string;
  machineTypeId?: string;
  search?: string;
}

interface FaultSolutionFilters extends FaultFilters {
  panneId?: string;
}

@Injectable()
export class OperatorService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(InterventionReport.name)
    private readonly reportModel: Model<InterventionReportDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(MachineType.name)
    private readonly machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(Module.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(Lubrifiant.name)
    private readonly lubrifiantModel: Model<LubrifiantDocument>,
    @InjectModel(KPI.name)
    private readonly kpiModel: Model<KPIDocument>,
    @InjectModel(Catalogue.name)
    private readonly catalogueModel: Model<CatalogueDocument>,
    @InjectModel(Stock.name)
    private readonly stockModel: Model<StockDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(Panne.name)
    private readonly panneModel: Model<PanneDocument>,
    @InjectModel(PanneSolution.name)
    private readonly panneSolutionModel: Model<PanneSolutionDocument>,
    private readonly workOrdersService: WorkOrdersService,
  ) {}

  private toObjectId(id: string): Types.ObjectId {
    return new Types.ObjectId(id);
  }

  private toObjectIdList(ids: string[]): Types.ObjectId[] {
    return ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => this.toObjectId(id));
  }

  private technicianScopeFilter(
    userId: string,
  ): string | { $in: Array<string | Types.ObjectId> } {
    if (!Types.ObjectId.isValid(userId)) {
      return userId;
    }

    return {
      $in: [userId, this.toObjectId(userId)],
    };
  }

  private toIdString(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Types.ObjectId) return value.toHexString();
    if (typeof value === 'object' && value !== null && '_id' in value) {
      const objectId = (value as { _id?: unknown })._id;
      if (typeof objectId === 'string') {
        return objectId;
      }

      if (objectId instanceof Types.ObjectId) {
        return objectId.toHexString();
      }

      return '';
    }
    return '';
  }

  private async getVisibleMachineIds(filters: {
    userId: string;
    machineId?: string;
    machineTypeId?: string;
  }): Promise<string[]> {
    const allowedIds = await this.getAllowedMachineIds(filters.userId);
    if (!allowedIds.length) {
      if (filters.machineId) {
        this.assertValidObjectId(filters.machineId, 'machine_id');
        throw new ForbiddenException('Operator is not assigned to this machine');
      }
      return [];
    }

    const query: Record<string, unknown> = {
      _id: { $in: this.toObjectIdList(allowedIds) },
    };

    if (
      filters.machineTypeId &&
      Types.ObjectId.isValid(filters.machineTypeId)
    ) {
      query.type_id = this.toObjectId(filters.machineTypeId);
    } else if (filters.machineTypeId) {
      throw new BadRequestException('Invalid machineTypeId');
    }

    if (filters.machineId) {
      this.assertValidObjectId(filters.machineId, 'machine_id');
      if (!allowedIds.includes(filters.machineId)) {
        throw new ForbiddenException('Operator is not assigned to this machine');
      }
      query._id = this.toObjectId(filters.machineId);
    }

    const machines = await this.machineModel
      .find(query)
      .select({ _id: 1 })
      .exec();

    return machines.map((machine) => machine._id.toString());
  }

  async getMyWorkOrders(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<WorkOrder>> {
    const query = { technician_id: this.technicianScopeFilter(userId) };

    const [items, totalItems] = await Promise.all([
      this.workOrderModel
        .find(query)
        .sort({ date_created: -1 })
        .skip(skip)
        .limit(limit)
        .populate('machine_id')
        .populate('module_id')
        .populate('plan_id')
        .exec(),
      this.workOrderModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getMachineTypes(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<MachineType>> {
    const machineIds = await this.getAllowedMachineIds(userId);
    if (!machineIds.length) return toPaginatedResponse([], 0, page, limit);

    const typeIds = await this.machineModel
      .distinct('type_id', { _id: { $in: this.toObjectIdList(machineIds) } })
      .exec();
    const query = { _id: { $in: this.toObjectIdList(typeIds.map((id) => this.toIdString(id))) } };

    const [items, totalItems] = await Promise.all([
      this.machineTypeModel.find(query).sort({ name: 1 }).skip(skip).limit(limit).exec(),
      this.machineTypeModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getModules(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<Module>> {
    const machineIds = await this.getAllowedMachineIds(userId);
    if (!machineIds.length) return toPaginatedResponse([], 0, page, limit);
    const query = { machine_id: { $in: this.toObjectIdList(machineIds) } };

    const [items, totalItems] = await Promise.all([
      this.moduleModel
        .find(query)
        .sort({ module_id: 1 })
        .skip(skip)
        .limit(limit)
        .populate('machine_id')
        .populate('mod_type_id')
        .exec(),
      this.moduleModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getMaintenancePlans(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<MaintenancePlan>> {
    const machineIds = await this.getAllowedMachineIds(userId);
    if (!machineIds.length) return toPaginatedResponse([], 0, page, limit);
    const modules = await this.moduleModel
      .find({ machine_id: { $in: this.toObjectIdList(machineIds) } })
      .select({ _id: 1 })
      .exec();
    const query = { module_id: { $in: modules.map((module) => module._id) } };

    const [items, totalItems] = await Promise.all([
      this.maintenancePlanModel
        .find(query)
        .sort({ plan_id: 1 })
        .skip(skip)
        .limit(limit)
        .populate('module_id')
        .exec(),
      this.maintenancePlanModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getLubrifiants(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<Lubrifiant>> {
    await this.assertHasOperatorScope(userId);
    const [items, totalItems] = await Promise.all([
      this.lubrifiantModel.find().sort({ nom: 1 }).skip(skip).limit(limit).exec(),
      this.lubrifiantModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getKpis(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<KPI>> {
    const machineIds = await this.getAllowedMachineIds(userId);
    if (!machineIds.length) return toPaginatedResponse([], 0, page, limit);
    const query = { machine_id: { $in: this.toObjectIdList(machineIds) } };

    const [items, totalItems] = await Promise.all([
      this.kpiModel.find(query).sort({ date_calcul: -1 }).skip(skip).limit(limit).exec(),
      this.kpiModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getCatalogues(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<Catalogue>> {
    await this.assertHasOperatorScope(userId);
    const [items, totalItems] = await Promise.all([
      this.catalogueModel.find().sort({ nom_piece: 1 }).skip(skip).limit(limit).exec(),
      this.catalogueModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getStocks(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<Stock>> {
    await this.assertHasOperatorScope(userId);
    const [items, totalItems] = await Promise.all([
      this.stockModel
        .find()
        .sort({ quantite_en_stock: -1 })
        .skip(skip)
        .limit(limit)
        .populate('part_id')
        .exec(),
      this.stockModel.countDocuments().exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getMyReports(
    userId: string,
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<InterventionReport>> {
    const query = { technician_id: this.technicianScopeFilter(userId) };

    const [items, totalItems] = await Promise.all([
      this.reportModel
        .find(query)
        .sort({ date_fin: -1, date_debut: -1 })
        .skip(skip)
        .limit(limit)
        .populate('ot_id')
        .populate('technician_id')
        .exec(),
      this.reportModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getMyMachines(
    userId: string,
    page: number,
    limit: number,
    skip: number,
    machineTypeId?: string,
  ): Promise<PaginatedResponse<Machine>> {
    const machineIds = await this.getVisibleMachineIds({ userId, machineTypeId });
    if (!machineIds.length) {
      return toPaginatedResponse([], 0, page, limit);
    }

    const query: Record<string, unknown> = {
      _id: { $in: this.toObjectIdList(machineIds) },
    };

    if (machineTypeId && Types.ObjectId.isValid(machineTypeId)) {
      query.type_id = this.toObjectId(machineTypeId);
    }

    const [items, totalItems] = await Promise.all([
      this.machineModel
        .find(query)
        .sort({ machine_id: 1 })
        .skip(skip)
        .limit(limit)
        .populate('type_id')
        .exec(),
      this.machineModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getMyCalendar(
    userId: string,
    params: {
      view: CalendarView;
      date: Date;
      machineId?: string;
      machineTypeId?: string;
      maintenanceType?: string;
      status?: string;
      priority?: string;
      month?: number;
      week?: number;
      year?: number;
    },
  ): Promise<unknown> {
    const filters: CalendarFilters = {
      machineId: params.machineId,
      machineTypeId: params.machineTypeId,
      maintenanceType: params.maintenanceType,
      status: params.status,
      priority: params.priority,
      month: params.month,
      week: params.week,
      year: params.year,
    };

    if (filters.machineId) {
      await this.assertCanAccessMachine(userId, filters.machineId);
    }

    return this.workOrdersService.getCalendarEvents(params.view, params.date, {
      ...filters,
      technicianId: userId,
      operatorId: userId,
    });
  }

  async getPreventiveStates(userId: string, machineId: string) {
    await this.assertCanAccessMachine(userId, machineId);
    return this.workOrdersService.getMachinePreventiveStates(machineId);
  }

  async schedulePreventive(
    userId: string,
    input: { machineId: string; planId: string; scheduledDate: string },
  ) {
    await this.assertCanAccessMachine(userId, input.machineId);
    return this.workOrdersService.scheduleFirstPreventiveOccurrence({
      ...input,
      operatorId: userId,
    });
  }

  async createCorrectiveReport(
    userId: string,
    input: {
      machineId: string;
      codePanne: string;
      faultDescription?: string;
      actions: string[];
      priority?: string;
    },
  ) {
    await this.assertCanAccessMachine(userId, input.machineId);
    return this.workOrdersService.createCorrectiveReportForOperator({
      machineId: input.machineId,
      codePanne: input.codePanne,
      faultDescription: input.faultDescription,
      actions: input.actions,
      priority: input.priority,
      operatorId: userId,
    });
  }

  async submitPreventiveMaintenance(
    userId: string,
    input: {
      workOrderId: string;
      tasksCompleted: string[];
      condition: string;
      comments?: string;
      lubrication?: { lubrifiantId: string; quantity: number };
    },
  ) {
    this.assertValidObjectId(input.workOrderId, 'work_order_id');
    const target = await this.workOrderModel
      .findById(input.workOrderId)
      .select({ machine_id: 1 })
      .exec();
    if (!target) {
      throw new NotFoundException('Work order not found');
    }

    await this.assertCanAccessMachine(userId, this.toIdString(target.machine_id));

    return this.workOrdersService.submitPreventiveMaintenanceForOperator({
      workOrderId: input.workOrderId,
      tasksCompleted: input.tasksCompleted,
      condition: input.condition,
      comments: input.comments,
      lubrication: input.lubrication,
      operatorId: userId,
    });
  }

  async requestParts(
    userId: string,
    input: { workOrderId: string; partId: string; quantity: number },
  ) {
    this.assertValidObjectId(input.workOrderId, 'work_order_id');
    const target = await this.workOrderModel
      .findById(input.workOrderId)
      .select({ machine_id: 1 })
      .exec();
    if (!target) {
      throw new NotFoundException('Work order not found');
    }

    await this.assertCanAccessMachine(userId, this.toIdString(target.machine_id));

    return this.workOrdersService.requestPartsForOperator({
      workOrderId: input.workOrderId,
      partId: input.partId,
      quantity: input.quantity,
      operatorId: userId,
    });
  }

  private async assertOperatorCanActOnWorkOrder(
    userId: string,
    workOrderId: string,
  ): Promise<void> {
    this.assertValidObjectId(workOrderId, 'work_order_id');
    const target = await this.workOrderModel
      .findById(workOrderId)
      .select({ machine_id: 1 })
      .exec();
    if (!target) {
      throw new NotFoundException('Work order not found');
    }
    await this.assertCanAccessMachine(userId, this.toIdString(target.machine_id));
  }

  async getCalendarWidget(userId: string) {
    return this.workOrdersService.getCalendarWidgetForOperator(userId);
  }

  async getCalendarNotifications(userId: string) {
    return this.workOrdersService.getNotificationCardsForOperator(userId);
  }

  async getCalendarTimeline(
    userId: string,
    params: { date: Date; machineId?: string },
  ) {
    if (params.machineId) {
      await this.assertCanAccessMachine(userId, params.machineId);
    }
    return this.workOrdersService.getTimelineForOperator(
      params.date,
      userId,
      params.machineId,
    );
  }

  async getCalendarEventDetails(userId: string, workOrderId: string) {
    await this.assertOperatorCanActOnWorkOrder(userId, workOrderId);
    return this.workOrdersService.getCalendarEventDetailsForOperator(
      workOrderId,
      userId,
    );
  }

  async startCalendarEvent(userId: string, workOrderId: string) {
    await this.assertOperatorCanActOnWorkOrder(userId, workOrderId);
    return this.workOrdersService.startWorkOrderForOperator({
      operatorId: userId,
      workOrderId,
    });
  }

  async completeCalendarEvent(userId: string, workOrderId: string) {
    await this.assertOperatorCanActOnWorkOrder(userId, workOrderId);
    return this.workOrdersService.completeWorkOrderForOperator({
      operatorId: userId,
      workOrderId,
    });
  }

  async rescheduleCalendarEvent(
    userId: string,
    workOrderId: string,
    input: { newDueDate: string; reason: string },
  ) {
    await this.assertOperatorCanActOnWorkOrder(userId, workOrderId);
    return this.workOrdersService.rescheduleWorkOrderForOperator({
      operatorId: userId,
      workOrderId,
      newDueDate: input.newDueDate,
      reason: input.reason,
    });
  }

  async getOperatorManuals(
    userId: string,
    page: number,
    limit: number,
    skip: number,
    machineId?: string,
    machineTypeId?: string,
  ): Promise<PaginatedResponse<DocumentEntity>> {
    const operatorMachines = await this.getMyMachines(
      userId,
      1,
      1000,
      0,
      machineTypeId,
    );

    const machineIds = operatorMachines.items.map((machine) =>
      this.toIdString(machine),
    );

    if (machineId) {
      if (!machineIds.includes(machineId)) {
        return toPaginatedResponse([], 0, page, limit);
      }
    }

    const scopedMachineIds = machineId ? [machineId] : machineIds;

    if (!scopedMachineIds.length) {
      return toPaginatedResponse([], 0, page, limit);
    }

    const typeRegex =
      /(manual|procedure|pdf|diagram|excel|xlsx|xls|spreadsheet)/i;
    const query = {
      machine_id: { $in: this.toObjectIdList(scopedMachineIds) },
      type_document: { $regex: typeRegex },
    };

    const [items, totalItems] = await Promise.all([
      this.documentModel
        .find(query)
        .sort({ date_ajout: -1 })
        .skip(skip)
        .limit(limit)
        .populate('machine_id')
        .exec(),
      this.documentModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  private async buildFaultScope(
    userId: string,
    filters: FaultFilters,
  ): Promise<{ machineIds: string[]; panneCodes?: string[] }> {
    const machineIds = await this.getVisibleMachineIds({
      userId,
      machineId: filters.machineId,
      machineTypeId: filters.machineTypeId,
    });

    if (!machineIds.length) {
      return { machineIds: [] };
    }

    const scopedOrders = await this.workOrderModel
      .find({
        machine_id: { $in: this.toObjectIdList(machineIds) },
        code_panne: { $exists: true, $ne: '' },
      })
      .select({ code_panne: 1 })
      .exec();

    const panneCodes = Array.from(
      new Set(
        scopedOrders
          .map((order) => (order.code_panne || '').trim())
          .filter(Boolean),
      ),
    );

    return { machineIds, panneCodes };
  }

  async getFaultsForOperator(
    userId: string,
    page: number,
    limit: number,
    skip: number,
    filters: FaultFilters,
  ): Promise<PaginatedResponse<Panne>> {
    const scope = await this.buildFaultScope(userId, filters);

    if (!scope.machineIds.length) {
      return toPaginatedResponse([], 0, page, limit);
    }

    const query: Record<string, unknown> = {};

    if (scope.panneCodes && scope.panneCodes.length > 0) {
      query.code_panne = { $in: scope.panneCodes };
    }

    if (filters.search?.trim()) {
      query.$or = [
        { code_panne: { $regex: filters.search.trim(), $options: 'i' } },
        { description: { $regex: filters.search.trim(), $options: 'i' } },
      ];
    }

    const [items, totalItems] = await Promise.all([
      this.panneModel
        .find(query)
        .sort({ code_panne: 1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.panneModel.countDocuments(query).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  async getFaultSolutionsForOperator(
    userId: string,
    page: number,
    limit: number,
    skip: number,
    filters: FaultSolutionFilters,
  ): Promise<PaginatedResponse<PanneSolution>> {
    const scope = await this.buildFaultScope(userId, filters);

    if (!scope.machineIds.length) {
      return toPaginatedResponse([], 0, page, limit);
    }

    const panneQuery: Record<string, unknown> = {};

    if (filters.panneId && Types.ObjectId.isValid(filters.panneId)) {
      panneQuery._id = this.toObjectId(filters.panneId);
    } else if (scope.panneCodes && scope.panneCodes.length > 0) {
      panneQuery.code_panne = { $in: scope.panneCodes };
    }

    if (filters.search?.trim()) {
      panneQuery.$or = [
        { code_panne: { $regex: filters.search.trim(), $options: 'i' } },
        { description: { $regex: filters.search.trim(), $options: 'i' } },
      ];
    }

    const scopedPannes = await this.panneModel
      .find(panneQuery)
      .select({ _id: 1 })
      .exec();
    const panneIds = scopedPannes.map((panne) => panne._id);

    if (!panneIds.length) {
      return toPaginatedResponse([], 0, page, limit);
    }

    const solutionQuery: Record<string, unknown> = {
      panne_id: { $in: panneIds },
    };

    if (filters.search?.trim()) {
      solutionQuery.$or = [
        {
          cause_probable: {
            $regex: filters.search.trim(),
            $options: 'i',
          },
        },
        {
          solution_recommandee: {
            $regex: filters.search.trim(),
            $options: 'i',
          },
        },
      ];
    }

    const [items, totalItems] = await Promise.all([
      this.panneSolutionModel
        .find(solutionQuery)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate('panne_id')
        .exec(),
      this.panneSolutionModel.countDocuments(solutionQuery).exec(),
    ]);

    return toPaginatedResponse(items, totalItems, page, limit);
  }

  private async assertCanAccessMachine(
    userId: string,
    machineId: string,
  ): Promise<void> {
    this.assertValidObjectId(machineId, 'machine_id');
    const allowedMachineIds = await this.getAllowedMachineIds(userId);
    if (!allowedMachineIds.includes(machineId)) {
      throw new ForbiddenException('Operator is not assigned to this machine');
    }
  }

  private async assertHasOperatorScope(userId: string): Promise<void> {
    const allowedMachineIds = await this.getAllowedMachineIds(userId);
    if (!allowedMachineIds.length) {
      throw new ForbiddenException('Operator has no assigned operational scope');
    }
  }

  private async getAllowedMachineIds(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }

    const operator = await this.userModel
      .findById(userId)
      .select({ assigned_machine_ids: 1 })
      .exec();
    const explicitIds = (operator?.assigned_machine_ids ?? []).map((id) =>
      this.toIdString(id),
    );

    const workOrderMachineIds = await this.workOrderModel
      .distinct('machine_id', {
        technician_id: this.technicianScopeFilter(userId),
      })
      .exec();

    return Array.from(
      new Set(
        [...explicitIds, ...workOrderMachineIds.map((id) => this.toIdString(id))]
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    );
  }

  private assertValidObjectId(value: string, field: string): void {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`Invalid ${field}`);
    }
  }
}
