import {
  BadRequestException,
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
import { NOT_CORRECTIVE_TYPE_FILTER } from '../../common/maintenance-type';
import { MaintenanceSchedulingService } from '../maintenance-scheduling.service';
import { KpiService } from '../../kpi/kpi.service';

/**
 * Owns Work Order dashboard/statistics/widget read projections: the legacy
 * admin statistics summary, the calendar dashboard widget, notification
 * cards, and the per-machine preventive-state summary. Purely read-only —
 * it never writes a KPI document (the calling facade's own
 * `updateKpiForMachine` stays the sole KPI-write owner) and never
 * reschedules or mutates a Work Order.
 */
@Injectable()
export class WorkOrderDashboardQueryService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(Machine.name)
    private readonly machineModel: Model<MachineDocument>,
    @InjectModel(ModuleEntity.name)
    private readonly moduleModel: Model<ModuleDocument>,
    @InjectModel(MaintenancePlan.name)
    private readonly maintenancePlanModel: Model<MaintenancePlanDocument>,
    @InjectModel(InterventionReport.name)
    private readonly interventionReportModel: Model<InterventionReportDocument>,
    private readonly schedulingService: MaintenanceSchedulingService,
    private readonly kpiService: KpiService,
  ) {}

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

  async getMachinePreventiveStates(machineId: string) {
    if (!Types.ObjectId.isValid(machineId)) {
      throw new BadRequestException('Invalid machine_id');
    }

    const machine = await this.machineModel.findById(machineId).exec();
    if (!machine) {
      throw new NotFoundException('Machine not found');
    }

    const modules = await this.moduleModel
      .find(this.moduleMachineFilter(machineId))
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
        $expr: {
          $in: [
            { $toString: '$module_id' },
            moduleIds.map((moduleId) => moduleId.toString()),
          ],
        },
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
      .populate('technician_id', SAFE_USER_PROJECTION)
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
      $or: [{ due_date: { $exists: true } }, { date_start: { $exists: true } }],
    };
    if (scope?.technicianId) {
      baseQuery.technician_id = new Types.ObjectId(scope.technicianId);
    }

    const baseOrders = await this.workOrderModel
      .find(baseQuery, {
        _id: 1,
        ot_id: 1,
        status: 1,
        due_date: 1,
        scheduled_date: 1,
        execution_date: 1,
        date_start: 1,
        date_created: 1,
      })
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

  /** Personal dashboard widget, scoped to work orders assigned to this Operator. */
  async getCalendarWidgetForOperator(operatorId: string) {
    return this.getDashboardCalendarWidget({ technicianId: operatorId });
  }

  async getNotificationCards(scope?: { technicianId?: string }) {
    // Always business-timezone-aware — see getDashboardCalendarWidget for
    // why this can no longer fall back to server-local boundaries just
    // because no technician scope was supplied (the Admin-facing route).
    const timeZone = this.schedulingService.getBusinessTimezone();
    const now = new Date();
    const dayStart = this.schedulingService.startOfBusinessDay(now, timeZone);
    const dayEnd = this.schedulingService.addBusinessDays(
      dayStart,
      1,
      timeZone,
    );
    const upcomingLimit = this.schedulingService.addBusinessDays(
      now,
      7,
      timeZone,
    );

    const ordersQuery: Record<string, unknown> = {
      $or: [{ due_date: { $exists: true } }, { date_start: { $exists: true } }],
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
      approvedTodayQuery.technician_id = new Types.ObjectId(scope.technicianId);
    }
    const approvedToday =
      await this.interventionReportModel.countDocuments(approvedTodayQuery);

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

  /** Personal notification cards, scoped to work orders assigned to this Operator. */
  async getNotificationCardsForOperator(operatorId: string) {
    return this.getNotificationCards({ technicianId: operatorId });
  }

  private moduleMachineFilter(machineId: string): Record<string, unknown> {
    return {
      $expr: {
        $eq: [{ $toString: '$machine_id' }, machineId],
      },
    };
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
}
