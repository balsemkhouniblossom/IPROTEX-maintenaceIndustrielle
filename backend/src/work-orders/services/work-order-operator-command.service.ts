import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WorkOrder, WorkOrderDocument } from '../../schemas/work-order.schema';
import { isSchedulableMaintenanceType } from '../../common/maintenance-type';
import { WorkOrderLifecycleService } from './work-order-lifecycle.service';
import { WorkOrderPreventiveSchedulingService } from './work-order-preventive-scheduling.service';

export interface OperatorCalendarScope {
  operatorId: string;
  workOrderId: string;
}

export interface RescheduleForOperatorInput {
  operatorId: string;
  workOrderId: string;
  newDueDate: string;
  reason: string;
}

/**
 * Owns Operator-specific Work Order mutation orchestration: ownership
 * verification followed by start/complete/reschedule. The actual status
 * transition is never implemented here — it is always delegated to
 * `WorkOrderLifecycleService` (start/complete) or
 * `WorkOrderPreventiveSchedulingService` (reschedule, reusing its existing
 * recurrence/occurrence-key handling rather than a second calculation).
 * This service only decides whether the caller may act on this specific
 * Work Order and which canonical operation to invoke.
 */
@Injectable()
export class WorkOrderOperatorCommandService {
  constructor(
    @InjectModel(WorkOrder.name)
    private readonly workOrderModel: Model<WorkOrderDocument>,
    private readonly lifecycleService: WorkOrderLifecycleService,
    private readonly preventiveSchedulingService: WorkOrderPreventiveSchedulingService,
  ) {}

  /**
   * Marks that the Operator has begun work on an assigned occurrence. Only a
   * valid transition from a not-yet-started status is accepted; anything
   * else (already in progress, already submitted, closed, etc.) is a 409
   * rather than a silent no-op, and the guard is applied atomically so a
   * double-click can't race itself into two "starts".
   */
  async startWorkOrderForOperator(
    scope: OperatorCalendarScope,
  ): Promise<WorkOrderDocument> {
    await this.loadOwnedWorkOrderOrThrow(scope);
    try {
      return await this.lifecycleService.startForOperator(scope);
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      throw new ConflictException(
        'This work order cannot be started from its current status',
      );
    }
  }

  /**
   * Marks that the Operator has finished active work on an assigned
   * corrective occurrence, moving it to `waiting_validation` pending
   * Technician/Admin review — never straight to `completed`, since an
   * Operator is never the final approval authority in this system.
   *
   * Preventive, lubrication, and inspection occurrences are intentionally
   * rejected here: they must go through the dedicated preventive
   * maintenance submission flow (`WorkOrderReportService`), which is the
   * only path that captures the checklist/lubrication data and computes
   * the next recurrence from the real execution date. Allowing this
   * generic action to complete a schedulable occurrence would silently
   * skip both.
   */
  async completeWorkOrderForOperator(
    scope: OperatorCalendarScope,
  ): Promise<WorkOrderDocument> {
    const workOrder = await this.loadOwnedWorkOrderOrThrow(scope);

    if (isSchedulableMaintenanceType(workOrder.type_maintenance)) {
      throw new ConflictException(
        'Preventive, lubrication, or inspection occurrences must be completed through the preventive maintenance submission endpoint',
      );
    }

    return this.lifecycleService.completeForOperator({
      operatorId: scope.operatorId,
      workOrderId: scope.workOrderId,
      executionDate: workOrder.execution_date,
    });
  }

  /**
   * Reschedules a preventive occurrence assigned to this Operator. Ownership
   * is verified here (the underlying scheduling-service call only checks
   * that the caller's role is allowed to reschedule at all, not that this
   * specific occurrence belongs to them); all existing type/status/date
   * validation and occurrence-key handling is reused as-is from
   * `WorkOrderPreventiveSchedulingService`.
   */
  async rescheduleWorkOrderForOperator(input: RescheduleForOperatorInput) {
    await this.loadOwnedWorkOrderOrThrow({
      operatorId: input.operatorId,
      workOrderId: input.workOrderId,
    });

    return this.preventiveSchedulingService.reschedulePreventiveOccurrence({
      workOrderId: input.workOrderId,
      newDueDate: input.newDueDate,
      reason: input.reason,
      userId: input.operatorId,
      role: 'operator',
    });
  }

  private async loadOwnedWorkOrderOrThrow(
    scope: OperatorCalendarScope,
  ): Promise<WorkOrderDocument> {
    if (!Types.ObjectId.isValid(scope.workOrderId)) {
      throw new BadRequestException('Invalid work order id');
    }
    const workOrder = await this.workOrderModel
      .findById(scope.workOrderId)
      .exec();
    if (!workOrder) {
      throw new NotFoundException('Work order not found');
    }
    if (
      !workOrder.technician_id ||
      workOrder.technician_id.toString() !== scope.operatorId
    ) {
      throw new ForbiddenException('This work order is not assigned to you');
    }
    return workOrder;
  }
}
