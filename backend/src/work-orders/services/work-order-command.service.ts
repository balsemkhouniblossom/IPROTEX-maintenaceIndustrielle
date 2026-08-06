import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { CreateWorkOrderDto } from '../dto/create-work-order.dto';
import { UpdateWorkOrderDto } from '../dto/update-work-order.dto';
import { CounterService } from '../../counters/counter.service';
import { WorkOrderNotificationService } from './work-order-notification.service';
import { WorkOrderReportService } from './work-order-report.service';
import { WorkOrderPreventiveSchedulingService } from './work-order-preventive-scheduling.service';
import { WorkOrderKpiService } from './work-order-kpi.service';
import {
  toWorkOrderResponse,
  toWorkOrderResponseOrNull,
} from '../contracts/work-order-response.mapper';
import { WorkOrderResponse } from '../contracts/work-order-response.types';

/**
 * Owns generic Work Order command mutations: `create`, `update`, `remove`.
 * These are ordinary CRUD-shaped writes (not a governed lifecycle
 * transition), but `create`/`update` both carry the pre-existing side-
 * effect orchestration for a Work Order that lands directly in a completed
 * status without going through the normal submission flow — auto report
 * backfill (`WorkOrderReportService`), next-occurrence scheduling
 * (`WorkOrderPreventiveSchedulingService`), and KPI recomputation
 * (`WorkOrderKpiService`) — reused here exactly as before, never
 * reimplemented. `remove` is, and always was, an unconditional physical
 * delete with no cascade — preserved as-is; this extraction does not
 * redesign deletion semantics.
 */
@Injectable()
export class WorkOrderCommandService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    private readonly counterService: CounterService,
    private readonly notificationService: WorkOrderNotificationService,
    private readonly reportService: WorkOrderReportService,
    private readonly preventiveSchedulingService: WorkOrderPreventiveSchedulingService,
    private readonly kpiService: WorkOrderKpiService,
  ) {}

  async create(
    createWorkOrderDto: CreateWorkOrderDto,
  ): Promise<WorkOrderResponse> {
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

    await this.preventiveSchedulingService.assertNoDuplicatePreventiveOccurrence(
      {
        machineId: createWorkOrderDto.machine_id,
        planId: createWorkOrderDto.plan_id,
        dueDate: createWorkOrderDto.due_date,
        excludeId: undefined,
      },
    );

    // A work order that lands directly in a completed status carries three
    // follow-on writes (auto report, next preventive occurrence, KPI
    // snapshot) alongside its own save. Without a shared transaction, a
    // failure in any of those three left a persisted "completed" work
    // order with no matching report/schedule/KPI — a silent, hard-to-spot
    // data gap. Wrapping the save with them means either all four writes
    // land or none do.
    const session = await this.workOrderModel.db.startSession();
    let savedWorkOrder: WorkOrderDocument;
    try {
      savedWorkOrder = await session.withTransaction(async () => {
        const createdWorkOrder = new this.workOrderModel(createWorkOrderDto);
        const saved = await createdWorkOrder.save({ session });

        if (this.isCompletedStatus(saved.status)) {
          await this.reportService.ensureAutoInterventionReport(saved, session);
          await this.preventiveSchedulingService.ensureNextPreventiveWorkOrder(
            saved,
            undefined,
            undefined,
            session,
          );
          await this.kpiService.updateKpiForMachine(
            saved.machine_id?.toString(),
            session,
          );
        }

        return saved;
      });
    } finally {
      await session.endSession();
    }

    // Notifications are a fire-and-forget side effect, not a data-
    // consistency concern — they stay outside the transaction so a
    // notification failure can never roll back an otherwise-successful
    // work order creation.
    if (!this.isCompletedStatus(savedWorkOrder.status)) {
      await this.notificationService.notifyCreated(savedWorkOrder);
    }

    return toWorkOrderResponse(savedWorkOrder);
  }

  async update(
    id: string,
    updateWorkOrderDto: UpdateWorkOrderDto,
  ): Promise<WorkOrderResponse | null> {
    const session = await this.workOrderModel.db.startSession();
    let updated: WorkOrderDocument | null;
    try {
      updated = await session.withTransaction(async () => {
        const result = await this.workOrderModel
          .findByIdAndUpdate(id, updateWorkOrderDto, { new: true, session })
          .exec();

        if (!result) {
          return null;
        }

        if (this.isCompletedStatus(result.status)) {
          await this.reportService.ensureAutoInterventionReport(
            result,
            session,
          );
          await this.preventiveSchedulingService.ensureNextPreventiveWorkOrder(
            result,
            undefined,
            undefined,
            session,
          );
          await this.kpiService.updateKpiForMachine(
            result.machine_id?.toString(),
            session,
          );
        }

        return result;
      });
    } finally {
      await session.endSession();
    }

    if (!updated) {
      return null;
    }

    return toWorkOrderResponse(updated);
  }

  async remove(id: string): Promise<WorkOrderResponse | null> {
    const removed = await this.workOrderModel.findByIdAndDelete(id).exec();
    return toWorkOrderResponseOrNull(removed);
  }

  private async generateWorkOrderCode(type?: string) {
    const sequence = await this.counterService.getNextSequence('work_order');
    const prefix = (type || 'maintenance').toLowerCase().startsWith('correct')
      ? 'WO-COR'
      : 'WO-PREV';
    return `${prefix}-${sequence.toString().padStart(6, '0')}`;
  }

  private isCompletedStatus(status?: string) {
    return status === 'completed' || status === 'validated';
  }
}
