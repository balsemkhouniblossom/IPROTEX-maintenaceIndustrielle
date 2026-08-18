import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SAFE_USER_PROJECTION } from '../../users/safe-user-projection';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { Machine, MachineDocument } from '../../schemas/machine.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../../schemas/maintenance-plan.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../../schemas/intervention-report.schema';
import {
  DocumentEntity,
  DocumentDocument,
} from '../../schemas/document.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../../schemas/machine-type.schema';
import { User, UserDocument } from '../../schemas/user.schema';
import { OTPieces, OTPiecesDocument } from '../../schemas/ot-pieces.schema';
import { MaintenanceSchedulingService } from '../maintenance-scheduling.service';
import { WorkOrderReportService } from './work-order-report.service';
import {
  asPopulatedDoc,
  serializeDate,
} from '../../common/response/serialization.util';

export type CalendarView = 'day' | 'week' | 'month' | 'year' | 'timeline';

export interface CalendarFilters {
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

export interface CalendarEventsResponse {
  view: CalendarView;
  date: string;
  rangeStart: string;
  rangeEnd: string;
  totalItems: number;
  items: CalendarEventRow[];
}

export type CalendarTimelineGroupKey =
  | 'today'
  | 'tomorrow'
  | 'nextWeek'
  | 'nextMonth'
  | 'sixMonths'
  | 'oneYear';

export type CalendarTimelineResponse = Record<
  CalendarTimelineGroupKey,
  CalendarEventRow[]
>;

export interface CalendarEventDetailsResponse {
  id: string;
  machine: {
    id: string;
    code: string;
    model?: string;
  };
  machineType: {
    id: string;
    name: string;
  };
  module: {
    id: string;
    code: string;
    location: string;
  };
  maintenanceType: string;
  description: string;
  frequency: {
    value?: number;
    unit?: string;
    label: string;
  };
  assignedOperator: {
    id: string;
    name: string;
  };
  currentStatus: string;
  spareParts: Array<{
    id: string;
    quantity: number;
    name: string;
  }>;
  manuals: Array<{
    id: string;
    type: string;
    fileName: string;
    filePath: string;
  }>;
  history: Array<{
    id: string;
    reportId: string;
    start: string;
    end: string;
    action?: string;
    status: string;
  }>;
  corrective: {
    faultCode: string;
    faultDescription?: string;
    probableCause?: string;
    recommendedSolution?: string;
  } | null;
  actions: {
    canStart: boolean;
    canComplete: boolean;
    canGenerateReport: boolean;
    canOpenManual: boolean;
    canViewHistory: boolean;
  };
}

/**
 * Owns every Work Order calendar/timeline read projection: event lists,
 * event detail lookups, and the multi-horizon timeline grouping. Purely
 * read-only — it never reschedules, transitions, or otherwise mutates a
 * Work Order (preventive rescheduling stays owned by the dedicated
 * scheduling service, reached only through the calling facade).
 */
@Injectable()
export class WorkOrderCalendarQueryService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(MachineType.name)
    private readonly machineTypeModel: Model<MachineTypeDocument>,
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
    @InjectModel(OTPieces.name)
    private readonly otPiecesModel: Model<OTPiecesDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly schedulingService: MaintenanceSchedulingService,
    private readonly reportService: WorkOrderReportService,
  ) {}

  async getCalendarEvents(
    view: CalendarView,
    date: Date,
    filters: CalendarFilters,
  ): Promise<CalendarEventsResponse> {
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
      .populate('technician_id', SAFE_USER_PROJECTION)
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
  ): Promise<CalendarEventsResponse> {
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
      .populate('technician_id', SAFE_USER_PROJECTION)
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

  async getCalendarEventDetails(
    workOrderId: string,
  ): Promise<CalendarEventDetailsResponse | null> {
    const workOrder = await this.workOrderModel
      .findById(workOrderId)
      .populate('machine_id')
      .populate('module_id')
      .populate('technician_id', SAFE_USER_PROJECTION)
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
      ? await this.documentModel
          .find({ machine_id: new Types.ObjectId(machineId) })
          .exec()
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
        ? await this.reportService.resolveCorrectiveData(workOrder.code_panne)
        : null;

    return {
      id: workOrder._id.toString(),
      machine: {
        id: machine?._id?.toString() || machineId,
        code:
          machine?.machine_id ||
          asPopulatedDoc<{ machine_id?: string }>(workOrder.machine_id)
            ?.machine_id ||
          '',
        model: machine?.model,
      },
      machineType: {
        id: this.objectIdString(machineType) || machineTypeId,
        name: machineType?.name || 'Unknown',
      },
      module: {
        id: this.objectIdString(workOrder.module_id),
        code:
          asPopulatedDoc<{ module_id?: string }>(workOrder.module_id)
            ?.module_id || '',
        location:
          asPopulatedDoc<{ localisation?: string }>(workOrder.module_id)
            ?.localisation || '',
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
          asPopulatedDoc<{ nom_complet?: string }>(workOrder.technician_id)
            ?.nom_complet || '',
      },
      currentStatus: workOrder.status,
      spareParts: otPieces.map((piece) => ({
        id: piece._id.toString(),
        quantity: piece.quantite,
        name:
          asPopulatedDoc<{ nom_piece?: string }>(piece.part_id)?.nom_piece ||
          'Unknown',
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
        start: serializeDate(report.date_debut)!,
        end: serializeDate(report.date_fin)!,
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

  /**
   * Ownership is enforced inline (hard-scoped to `technician_id ===
   * operatorId`) rather than via the shared mutation-side
   * `loadOwnedWorkOrderOrThrow` helper, since this is a pure read with no
   * write side effects to coordinate with.
   */
  async getCalendarEventDetailsForOperator(
    workOrderId: string,
    operatorId: string,
  ): Promise<CalendarEventDetailsResponse | null> {
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
    if (workOrder.technician_id?.toString() !== operatorId) {
      throw new ForbiddenException('This work order is not assigned to you');
    }

    return this.getCalendarEventDetails(workOrderId);
  }

  async getTimeline(
    date: Date,
    machineId?: string,
    technicianId?: string,
  ): Promise<CalendarTimelineResponse> {
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

    const groups: CalendarTimelineResponse = {
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

  /** Personal timeline, scoped to work orders assigned to this Operator. */
  async getTimelineForOperator(
    date: Date,
    operatorId: string,
    machineId?: string,
  ): Promise<CalendarTimelineResponse> {
    return this.getTimeline(date, machineId, operatorId);
  }

  private async toCalendarEvents(
    workOrders: WorkOrderDocument[],
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
            .select(SAFE_USER_PROJECTION)
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
            asPopulatedDoc<{ machine_id?: string }>(workOrder.machine_id)
              ?.machine_id ||
            '',
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
        this.schedulingService
          .addBusinessDays(rangeStart, 7, timeZone)
          .getTime() - 1,
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
      this.schedulingService
        .addBusinessMonths(rangeStart, 12, timeZone)
        .getTime() - 1,
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

  private getIsoWeek(date: Date) {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }

  private getWorkOrderDueDate(workOrder: {
    due_date?: Date | string;
    scheduled_date?: Date | string;
    execution_date?: Date | string;
    date_start?: Date | string;
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

  private objectIdString(value: unknown): string {
    if (!value) return '';

    if (typeof value === 'string') {
      return value;
    }

    if (value instanceof Types.ObjectId) {
      return value.toHexString();
    }

    if (typeof value === 'object' && value !== null && '_id' in value) {
      const maybeId = (value as { _id?: unknown })._id;
      return this.objectIdString(maybeId);
    }

    return '';
  }
}
