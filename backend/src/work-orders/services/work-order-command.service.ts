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

    await this.preventiveSchedulingService.assertNoDuplicatePreventiveOccurrence(
      {
        machineId: createWorkOrderDto.machine_id,
        planId: createWorkOrderDto.plan_id,
        dueDate: createWorkOrderDto.due_date,
        excludeId: undefined,
      },
    );

    const createdWorkOrder = new this.workOrderModel(createWorkOrderDto);
    const savedWorkOrder = await createdWorkOrder.save();

    if (this.isCompletedStatus(savedWorkOrder.status)) {
      await this.reportService.ensureAutoInterventionReport(savedWorkOrder);
      await this.preventiveSchedulingService.ensureNextPreventiveWorkOrder(
        savedWorkOrder,
      );
      await this.kpiService.updateKpiForMachine(
        savedWorkOrder.machine_id?.toString(),
      );
    } else {
      await this.notificationService.notifyCreated(savedWorkOrder);
    }

    return savedWorkOrder;
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
      await this.reportService.ensureAutoInterventionReport(updated);
      await this.preventiveSchedulingService.ensureNextPreventiveWorkOrder(
        updated,
      );
      await this.kpiService.updateKpiForMachine(updated.machine_id?.toString());
    }

    return updated;
  }

  async remove(id: string): Promise<any> {
    return this.workOrderModel.findByIdAndDelete(id).exec();
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
