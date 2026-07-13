import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import { Machine, MachineDocument } from '../schemas/machine.schema';
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
    machineId?: string;
    machineTypeId?: string;
  }): Promise<string[]> {
    const query: Record<string, unknown> = {};

    if (
      filters.machineTypeId &&
      Types.ObjectId.isValid(filters.machineTypeId)
    ) {
      query.type_id = this.toObjectId(filters.machineTypeId);
    }

    if (filters.machineId && Types.ObjectId.isValid(filters.machineId)) {
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
    void userId;

    const machineIds = await this.getVisibleMachineIds({ machineTypeId });
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

    return this.workOrdersService.getCalendarEvents(params.view, params.date, {
      ...filters,
      technicianId: userId,
      operatorId: userId,
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
    void userId;

    const machineIds = await this.getVisibleMachineIds({
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
}
