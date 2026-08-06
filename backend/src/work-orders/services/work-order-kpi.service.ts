import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { KPI, KPIDocument } from '../../schemas/kpi.schema';
import { CounterService } from '../../counters/counter.service';
import {
  isCorrectiveMaintenanceType,
  isSchedulableMaintenanceType,
} from '../../common/maintenance-type';

/**
 * Owns Work Order-triggered KPI *write* orchestration — recomputing and
 * upserting the one current `KPI` document for a machine (MTBF/MTTR/
 * availability/overdue-rate/completed-preventive/completed-corrective).
 * This is a distinct responsibility from the shared dashboard-facing KPI
 * read service, which only ever *reads* aggregate KPI data; nothing there
 * writes a `KPI` document, so this stays the sole canonical write owner
 * rather than a thin adapter over it. Callers (Work Order create/update/
 * validation and the automation scheduler) trigger this once per relevant
 * transition; recomputing from the full order history each time makes a
 * repeated call idempotent — it always converges on the same figures for
 * an unchanged history rather than accumulating drift.
 */
@Injectable()
export class WorkOrderKpiService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    @InjectModel(KPI.name)
    private readonly kpiModel: Model<KPIDocument>,
    private readonly counterService: CounterService,
  ) {}

  async updateKpiForMachine(machineId?: string, session?: ClientSession) {
    if (!machineId) {
      return;
    }

    const machineObjectId = new Types.ObjectId(machineId);
    const orders = await this.workOrderModel
      .find({ machine_id: machineObjectId })
      .sort({ date_created: 1 })
      .session(session ?? null)
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
      .session(session ?? null)
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
      await this.kpiModel
        .findByIdAndUpdate(existing._id, payload, { session })
        .exec();
    } else {
      await this.kpiModel.create([payload], { session });
    }
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

  private async generateKpiCode() {
    const sequence = await this.counterService.getNextSequence('kpi');
    return `KPI-${sequence.toString().padStart(6, '0')}`;
  }
}
