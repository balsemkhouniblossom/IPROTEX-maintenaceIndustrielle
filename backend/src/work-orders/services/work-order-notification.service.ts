import { Injectable } from '@nestjs/common';
import { NotificationCenterService } from '../../notification-center/notification-center.service';
import { NotificationType } from '../../schemas/notification.schema';
import { Role } from '../../schemas/user.schema';

type WorkOrderNotificationPayload = {
  technician_id?: string | { toString(): string };
  _id?: string | { toString(): string };
  machine_id?: string | { toString(): string };
  ot_id?: string;
  description?: string;
};

@Injectable()
export class WorkOrderNotificationService {
  constructor(
    private readonly notificationCenterService: NotificationCenterService,
  ) {}

  notifyCreated(workOrder: WorkOrderNotificationPayload) {
    const technicianId = workOrder.technician_id?.toString?.();
    if (!technicianId) return Promise.resolve(null);
    return this.notificationCenterService.createIfNotExists({
      dedupeKey: `work_order_created:${workOrder._id?.toString?.()}`,
      type: NotificationType.WORK_ORDER_CREATED,
      title: `New work order ${workOrder.ot_id} assigned`,
      recipientUserId: technicianId,
      workOrderId: workOrder._id?.toString?.(),
      machineId: workOrder.machine_id?.toString?.(),
    });
  }

  notifyValidationDecision(input: {
    workOrderId: string;
    action: 'approve' | 'reject';
    technicianId: string;
    otId: string;
    machineId?: string;
  }) {
    return this.notificationCenterService.createIfNotExists({
      dedupeKey: `validation_decision:${input.workOrderId}:${input.action}`,
      type:
        input.action === 'approve'
          ? NotificationType.VALIDATION_APPROVED
          : NotificationType.VALIDATION_REJECTED,
      title:
        input.action === 'approve'
          ? `Your report for ${input.otId} was approved`
          : `Your report for ${input.otId} was rejected`,
      recipientUserId: input.technicianId,
      workOrderId: input.workOrderId,
      machineId: input.machineId,
    });
  }

  notifyCorrectiveAwaitingValidation(input: {
    workOrderId: string;
    otId: string;
    machineId?: string;
    reportId: string;
  }) {
    return this.notificationCenterService.createIfNotExists({
      dedupeKey: `corrective_awaiting_validation:${input.workOrderId}`,
      type: NotificationType.CORRECTIVE_AWAITING_VALIDATION,
      title: `Corrective report for ${input.otId} is awaiting validation`,
      recipientRole: Role.ADMIN,
      workOrderId: input.workOrderId,
      machineId: input.machineId,
      referenceId: input.reportId,
    });
  }

  notifyPartRequestCreated(input: {
    requestId: string;
    otId?: string;
    workOrderId: string;
  }) {
    return this.notificationCenterService.createIfNotExists({
      dedupeKey: `part_request_created:${input.requestId}`,
      type: NotificationType.PART_REQUEST_CREATED,
      title: `A part was requested for work order ${input.otId}`,
      recipientRole: Role.TECHNICIAN,
      workOrderId: input.workOrderId,
      referenceId: input.requestId,
    });
  }

  notifyPartRequestDecision(input: {
    requestId: string;
    decision: 'approve' | 'reject' | 'cancel';
    requesterUserId: string;
    workOrderId: string;
  }) {
    return this.notificationCenterService.createIfNotExists({
      dedupeKey: `part_request_decision:${input.requestId}:${input.decision}`,
      type: NotificationType.PART_REQUEST_DECISION,
      title: partRequestDecisionTitle(input.decision),
      recipientUserId: input.requesterUserId,
      workOrderId: input.workOrderId,
      referenceId: input.requestId,
    });
  }
}

function partRequestDecisionTitle(
  decision: 'approve' | 'reject' | 'cancel',
): string {
  if (decision === 'approve') {
    return 'Your part request was approved and reserved';
  }
  if (decision === 'cancel') {
    return 'Your reserved part request was cancelled';
  }
  return 'Your part request was rejected';
}
