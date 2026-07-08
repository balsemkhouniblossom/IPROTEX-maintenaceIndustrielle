import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../schemas/work-order.schema';
import { CreateWorkOrderDto } from './dto/create-work-order.dto';
import { UpdateWorkOrderDto } from './dto/update-work-order.dto';
import { PaginatedResponse, toPaginatedResponse } from '../common/pagination';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { Module as ModuleEntity, ModuleDocument } from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../schemas/maintenance-plan.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../schemas/intervention-report.schema';
import {
  DocumentEntity,
  DocumentDocument,
} from '../schemas/document.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../schemas/machine-type.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { Panne, PanneDocument } from '../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionDocument,
} from '../schemas/panne-solution.schema';
import { KPI, KPIDocument } from '../schemas/kpi.schema';
import { Stock, StockDocument } from '../schemas/stock.schema';
import { Catalogue, CatalogueDocument } from '../schemas/catalogue.schema';
import { OTPieces, OTPiecesDocument } from '../schemas/ot-pieces.schema';
import { CounterService } from '../counters/counter.service';

type CalendarView = 'day' | 'week' | 'month' | 'year' | 'timeline';
type ValidationAction = 'approve' | 'reject' | 'request_correction';

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

interface CalendarEventRow {
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

@Injectable()
export class WorkOrdersService {
  private readonly logger = new Logger(WorkOrdersService.name);

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
    private counterService: CounterService,
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

    const createdWorkOrder = new this.workOrderModel(createWorkOrderDto);
    const savedWorkOrder = await createdWorkOrder.save();

    if (this.isCompletedStatus(savedWorkOrder.status)) {
      await this.ensureAutoInterventionReport(savedWorkOrder);
      await this.ensureNextPreventiveWorkOrder(savedWorkOrder);
      await this.updateKpiForMachine(savedWorkOrder.machine_id?.toString());
    }

    return savedWorkOrder;
  }

  async findAll(
    page: number,
    limit: number,
    skip: number,
  ): Promise<PaginatedResponse<WorkOrder>> {
    try {
      const [items, totalItems] = await Promise.all([
        this.workOrderModel
          .find()
          .skip(skip)
          .limit(limit)
          .populate('machine_id')
          .populate('module_id')
          .populate('technician_id')
          .exec(),
        this.workOrderModel.countDocuments().exec(),
      ]);

      return toPaginatedResponse(items, totalItems, page, limit);
    } catch (error) {
      // If populate fails, return work orders without population
      console.warn('Failed to populate work order references:', error);
      const [items, totalItems] = await Promise.all([
        this.workOrderModel.find().skip(skip).limit(limit).exec(),
        this.workOrderModel.countDocuments().exec(),
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

  async getStatistics() {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Get work orders for current month
    const currentMonthOrders = await this.workOrderModel
      .find({
        date_created: { $gte: currentMonth, $lt: nextMonth },
      })
      .exec();

    // Get work orders for last month
    const lastMonthOrders = await this.workOrderModel
      .find({
        date_created: { $gte: lastMonth, $lt: currentMonth },
      })
      .exec();

    // Get pending work orders (assuming 'pending' or 'open' status indicates due maintenance)
    const pendingOrders = await this.workOrderModel
      .find({
        status: { $in: ['pending', 'open', 'in_progress'] },
      })
      .exec();

    // Calculate percentage change
    const currentCount = currentMonthOrders.length;
    const lastCount = lastMonthOrders.length;
    const percentageChange =
      lastCount > 0 ? ((currentCount - lastCount) / lastCount) * 100 : 0;

    return {
      currentMonthWorkOrders: currentCount,
      lastMonthWorkOrders: lastCount,
      percentageChange: Math.round(percentageChange * 100) / 100, // Round to 2 decimal places
      pendingMaintenance: pendingOrders.length,
      totalWorkOrders: await this.workOrderModel.countDocuments().exec(),
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
    technicianId?: string,
  ) {
    const workOrder = await this.workOrderModel.findById(workOrderId).exec();
    if (!workOrder) {
      return null;
    }

    const statusByAction: Record<ValidationAction, string> = {
      approve: 'validated',
      reject: 'rejected',
      request_correction: 'waiting_correction',
    };

    const reportStatusByAction: Record<ValidationAction, string> = {
      approve: 'validated',
      reject: 'rejected',
      request_correction: 'request_correction',
    };

    const nextStatus = statusByAction[action];
    const updatedWorkOrder = await this.workOrderModel
      .findByIdAndUpdate(workOrderId, { status: nextStatus }, { new: true })
      .exec();

    const report = await this.interventionReportModel
      .findOne({ ot_id: workOrder._id })
      .sort({ date_fin: -1 })
      .exec();

    if (report) {
      await this.interventionReportModel
        .findByIdAndUpdate(
          report._id,
          {
            validation_responsable: reportStatusByAction[action],
            ...(technicianId ? { technician_id: technicianId } : {}),
          },
          { new: true },
        )
        .exec();
    }

    return updatedWorkOrder;
  }

  async getCalendarEvents(
    view: CalendarView,
    date: Date,
    filters: CalendarFilters,
  ) {
    const { rangeStart, rangeEnd } = this.getViewDateRange(view, date);
    const query: Record<string, unknown> = {
      date_start: { $gte: rangeStart, $lte: rangeEnd },
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

  async getTimeline(date: Date, machineId?: string) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 370);

    const query: Record<string, unknown> = {
      date_start: { $gte: start, $lte: end },
    };

    if (machineId) {
      query.machine_id = new Types.ObjectId(machineId);
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextWeekLimit = new Date(today);
    nextWeekLimit.setDate(nextWeekLimit.getDate() + 7);

    const nextMonthLimit = new Date(today);
    nextMonthLimit.setMonth(nextMonthLimit.getMonth() + 1);

    const sixMonthsLimit = new Date(today);
    sixMonthsLimit.setMonth(sixMonthsLimit.getMonth() + 6);

    const oneYearLimit = new Date(today);
    oneYearLimit.setFullYear(oneYearLimit.getFullYear() + 1);

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

  async getDashboardCalendarWidget() {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const nextWeekStart = new Date(weekEnd);
    const nextWeekEnd = new Date(weekEnd);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

    const nextMonthEnd = new Date(todayStart);
    nextMonthEnd.setMonth(nextMonthEnd.getMonth() + 1);

    const baseOrders = await this.workOrderModel
      .find({}, { _id: 1, ot_id: 1, status: 1, date_start: 1, date_created: 1 })
      .sort({ date_start: 1 })
      .lean()
      .exec();

    const classify = (order: {
      _id: unknown;
      ot_id?: string;
      status?: string;
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
        color: this.computeEventColor(order.status || 'pending', due, now),
      };
    };

    const rows = baseOrders.map(classify);
    return {
      today: rows.filter((row) => {
        const due = row.dueDate;
        return due >= todayStart && due < todayEnd;
      }),
      thisWeek: rows.filter((row) => {
        const due = row.dueDate;
        return due >= todayStart && due < weekEnd;
      }),
      nextWeek: rows.filter((row) => {
        const due = row.dueDate;
        return due >= nextWeekStart && due < nextWeekEnd;
      }),
      nextMonth: rows.filter((row) => {
        const due = row.dueDate;
        return due >= todayStart && due < nextMonthEnd;
      }),
      overdue: rows.filter((row) => row.color === 'red'),
      waitingValidation: rows.filter((row) => row.status === 'waiting_validation'),
      counts: {
        today: rows.filter((row) => {
          const due = row.dueDate;
          return due >= todayStart && due < todayEnd;
        }).length,
        thisWeek: rows.filter((row) => {
          const due = row.dueDate;
          return due >= todayStart && due < weekEnd;
        }).length,
        nextWeek: rows.filter((row) => {
          const due = row.dueDate;
          return due >= nextWeekStart && due < nextWeekEnd;
        }).length,
        nextMonth: rows.filter((row) => {
          const due = row.dueDate;
          return due >= todayStart && due < nextMonthEnd;
        }).length,
        overdue: rows.filter((row) => row.color === 'red').length,
        waitingValidation: rows.filter(
          (row) => row.status === 'waiting_validation',
        ).length,
      },
    };
  }

  async getNotificationCards() {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const upcomingLimit = new Date(now);
    upcomingLimit.setDate(upcomingLimit.getDate() + 7);

    const orders = await this.workOrderModel.find().exec();
    const completedToday = orders.filter((order) => {
      const closed = order.date_closed || order.date_end;
      if (!closed) return false;
      const closedDate = new Date(closed);
      return this.isCompletedStatus(order.status) && closedDate >= dayStart && closedDate < dayEnd;
    });

    const waitingValidation = orders.filter(
      (order) => order.status === 'waiting_validation',
    );

    const dueToday = orders.filter((order) => {
      const due = this.getWorkOrderDueDate(order);
      return due >= dayStart && due < dayEnd && !this.isCompletedStatus(order.status);
    });

    const upcoming = orders.filter((order) => {
      const due = this.getWorkOrderDueDate(order);
      return due > dayEnd && due <= upcomingLimit && !this.isCompletedStatus(order.status);
    });

    const overdue = orders.filter((order) => {
      const due = this.getWorkOrderDueDate(order);
      return due < now && !this.isCompletedStatus(order.status);
    });

    const criticalSensorAlarms = await this.mesureCriticalAlarmCount();
    const stockAlerts = await this.stockAlertCount();

    const approvedToday = await this.interventionReportModel.countDocuments({
      validation_responsable: 'validated',
      date_fin: { $gte: dayStart, $lt: dayEnd },
    });

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
          (solution) => this.objectIdString(solution.panne_id) === panne._id.toString(),
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
      .find(
        { type_maintenance: 'preventive' },
        {
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
        },
      )
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
      const key = this.buildPlanKey(order.machine_id, order.module_id, order.plan_id);
      const current = latestOrderByPlanKey.get(key);
      const currentDate = current
        ? new Date(current.date_start || current.date_created || 0).getTime()
        : -1;
      const nextDate = new Date(order.date_start || order.date_created || 0).getTime();

      if (!current || nextDate >= currentDate) {
        latestOrderByPlanKey.set(key, order);
      }

      const dueTime = new Date(order.date_start || order.date_created || 0).getTime();
      dueKeySet.add(`${key}|${dueTime}`);
    }

    for (const plan of plans) {
      summary.plansEvaluated += 1;
      const planType = (plan.type_maintenance || '').toLowerCase();
      if (planType && !planType.includes('prevent')) {
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
        const created = await this.createSeedWorkOrder(machine, moduleEntity, plan, dueKeySet, latestOrderByPlanKey);
        if (created) {
          summary.createdFirstExecution += 1;
        } else {
          summary.skippedDuplicates += 1;
        }
        continue;
      }

      if (this.isCompletedStatus(existing.status)) {
        const created = await this.ensureNextPreventiveWorkOrder(existing, dueKeySet, latestOrderByPlanKey);
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
    const dueDate = this.computeNextDueDate(baseDate, plan.frequence, plan.unite_frequence);

    const key = this.buildPlanKey(machine, moduleEntity, plan);
    const dueKey = `${key}|${dueDate.getTime()}`;
    if (dueKeySet?.has(dueKey)) {
      return false;
    }

    const otId = await this.generateWorkOrderCode('preventive');
    const created = await this.workOrderModel.create({
      ot_id: otId,
      machine_id: this.objectIdString(machine),
      module_id: this.objectIdString(moduleEntity),
      plan_id: this.objectIdString(plan),
      description: plan.instruction || 'Preventive maintenance task',
      type_maintenance: 'preventive',
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
    const type = (workOrder.type_maintenance || '').toLowerCase();
    if (!type.includes('prevent')) {
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

    const baseDate = workOrder.date_closed || workOrder.date_end || workOrder.date_start || workOrder.date_created;
    const nextDue = this.computeNextDueDate(
      new Date(baseDate || new Date()),
      plan.frequence,
      plan.unite_frequence,
    );

    const key = this.buildPlanKey(workOrder.machine_id, workOrder.module_id, workOrder.plan_id);
    const dueKey = `${key}|${nextDue.getTime()}`;
    if (dueKeySet?.has(dueKey)) {
      return false;
    }

    const nextOtId = await this.generateWorkOrderCode('preventive');
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
    const dateDebut = workOrder.date_start || workOrder.date_created || now;
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
      description_action: correctiveInfo?.recommendedSolution || workOrder.description,
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

    const completed = orders.filter((order) => this.isCompletedStatus(order.status));
    const corrective = completed.filter(
      (order) => (order.type_maintenance || '').toLowerCase() === 'corrective',
    );
    const preventive = completed.filter(
      (order) => (order.type_maintenance || '').toLowerCase().includes('prevent'),
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
        return (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60);
      })
      .filter((value): value is number => value !== null && value >= 0);

    const mttr = durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : 0;

    const failures = corrective
      .map((order) => new Date(order.date_closed || order.date_end || order.date_created || now))
      .sort((a, b) => a.getTime() - b.getTime());

    let mtbf = 0;
    if (failures.length >= 2) {
      let totalGapHours = 0;
      for (let i = 1; i < failures.length; i += 1) {
        totalGapHours +=
          (failures[i].getTime() - failures[i - 1].getTime()) / (1000 * 60 * 60);
      }
      mtbf = totalGapHours / (failures.length - 1);
    }

    const total = orders.length;
    const overdueCount = orders.filter((order) => {
      const due = this.getWorkOrderDueDate(order);
      return due < now && !this.isCompletedStatus(order.status);
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

  private async toCalendarEvents(workOrders: any[]): Promise<CalendarEventRow[]> {
    const machineTypeCache = new Map<string, MachineType | null>();
    const userCache = new Map<string, User | null>();

    const rows: CalendarEventRow[] = [];
    for (const workOrder of workOrders) {
      const dueDate = this.getWorkOrderDueDate(workOrder);
      const now = new Date();
      const plan = await this.resolvePlan(workOrder.plan_id, workOrder.plan_id);
      const machine = await this.resolveMachine(workOrder.machine_id, workOrder.machine_id);
      const moduleEntity = await this.resolveModule(workOrder.module_id, workOrder.module_id);

      const machineTypeId = machine ? this.objectIdString(machine.type_id) : '';
      let machineType: MachineType | null = null;
      if (machineTypeId) {
        if (!machineTypeCache.has(machineTypeId)) {
          const fetched = await this.machineTypeModel.findById(machineTypeId).exec();
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
          const fetchedUser = await this.userModel.findById(technicianId).exec();
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
        status: workOrder.status,
        priority: workOrder.priorite || 'medium',
        dueDate: dueDate.toISOString(),
        startDate: new Date(
          workOrder.date_start || workOrder.date_created || now,
        ).toISOString(),
        endDate: workOrder.date_end ? new Date(workOrder.date_end).toISOString() : undefined,
        color: this.computeEventColor(workOrder.status, dueDate, now),
        machine: {
          id: this.objectIdString(machine) || this.objectIdString(workOrder.machine_id),
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
        reminderStage: this.computeReminderStage(workOrder.status, dueDate, now),
      });
    }

    return rows.sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
    );
  }

  private getViewDateRange(view: CalendarView, date: Date) {
    const base = new Date(date);
    if (Number.isNaN(base.getTime())) {
      base.setTime(Date.now());
    }

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

  private matchCalendarFilter(event: CalendarEventRow, filters: CalendarFilters) {
    if (filters.machineTypeId && event.machine.typeId !== filters.machineTypeId) {
      return false;
    }
    if (filters.operatorId && event.assignedOperator?.id !== filters.operatorId) {
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
    const unit = (value || '').toLowerCase().replace(/\s+/g, '_');

    if (!unit) return 'monthly';
    if (unit.includes('jour') || unit.includes('day') || unit === 'd') return 'daily';
    if (unit.includes('week') || unit.includes('semaine') || unit.includes('w'))
      return 'weekly';
    if (unit.includes('3') && unit.includes('month')) return 'quarterly';
    if (unit.includes('6') && unit.includes('month')) return 'semiannual';
    if (unit.includes('year') || unit.includes('an') || unit.includes('ann')) return 'yearly';
    if (unit.includes('shift') || unit.includes('poste')) return 'per_shift';
    if (unit.includes('loading') || unit.includes('charg')) return 'per_loading';
    if (unit.includes('production') || unit.includes('ordre')) return 'per_production_order';
    if (unit.includes('month') || unit.includes('mois') || unit === 'm') return 'monthly';
    return 'monthly';
  }

  private computeNextDueDate(
    fromDate: Date,
    frequency?: number,
    unit?: string,
  ): Date {
    const base = new Date(fromDate);
    const value = frequency && frequency > 0 ? frequency : 1;
    const normalized = this.normalizeFrequencyUnit(unit);

    if (normalized === 'daily') {
      base.setDate(base.getDate() + value);
      return base;
    }
    if (normalized === 'weekly') {
      base.setDate(base.getDate() + value * 7);
      return base;
    }
    if (normalized === 'monthly') {
      base.setMonth(base.getMonth() + value);
      return base;
    }
    if (normalized === 'quarterly') {
      base.setMonth(base.getMonth() + 3 * value);
      return base;
    }
    if (normalized === 'semiannual') {
      base.setMonth(base.getMonth() + 6 * value);
      return base;
    }
    if (normalized === 'yearly') {
      base.setFullYear(base.getFullYear() + value);
      return base;
    }

    // Event-like units: due immediately on next operational cycle.
    base.setHours(base.getHours() + 8);
    return base;
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

  private computeReminderStage(status: string, dueDate: Date, now: Date): string {
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

    const panne = await this.panneModel.findOne({ code_panne: codePanne }).exec();
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
    const inlineMachine = this.extractHydratedEntity<Machine>(hydrated, ['machine_id']);
    if (inlineMachine) return inlineMachine;
    const machineId = this.objectIdString(value);
    if (!machineId) return null;
    return this.machineModel.findById(machineId).exec();
  }

  private async resolveModule(value: unknown, hydrated?: unknown) {
    const inlineModule = this.extractHydratedEntity<ModuleEntity>(hydrated, ['module_id']);
    if (inlineModule) return inlineModule;
    const moduleId = this.objectIdString(value);
    if (!moduleId) return null;
    return this.moduleModel.findById(moduleId).exec();
  }

  private async resolvePlan(value: unknown, hydrated?: unknown) {
    const inlinePlan = this.extractHydratedEntity<MaintenancePlan>(hydrated, ['plan_id']);
    if (inlinePlan) return inlinePlan;
    const planId = this.objectIdString(value);
    if (!planId) return null;
    return this.maintenancePlanModel.findById(planId).exec();
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
    date_start?: Date | string;
    date_created?: Date | string;
  }): Date {
    const source = workOrder.date_start || workOrder.date_created;
    return new Date(source || Date.now());
  }

  private isCompletedStatus(status?: string) {
    return status === 'completed' || status === 'validated';
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

  private buildPlanKey(machine: unknown, moduleEntity: unknown, plan: unknown): string {
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
    const sequence = await this.counterService.getNextSequence('intervention_report');
    return `REP-${sequence.toString().padStart(6, '0')}`;
  }

  private async generateKpiCode() {
    const sequence = await this.counterService.getNextSequence('kpi');
    return `KPI-${sequence.toString().padStart(6, '0')}`;
  }

  private getIsoWeek(date: Date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
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
    const stocks = await this.stockModel.find().exec();
    return stocks.filter((stock) => {
      const threshold =
        typeof stock.seuil_alerte_stock === 'number'
          ? stock.seuil_alerte_stock
          : stock.quantite_minimale;
      return typeof threshold === 'number' && stock.quantite_en_stock <= threshold;
    }).length;
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
