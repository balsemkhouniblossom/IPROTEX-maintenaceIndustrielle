import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderOperatorCommandService } from './work-order-operator-command.service';
import { WorkOrderLifecycleService } from './work-order-lifecycle.service';

function chain<T>(value: T) {
  const result: {
    select: jest.Mock;
    populate: jest.Mock;
    sort: jest.Mock;
    exec: jest.Mock;
  } = {
    select: jest.fn(),
    populate: jest.fn(),
    sort: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  result.select.mockReturnValue(result);
  result.populate.mockReturnValue(result);
  result.sort.mockReturnValue(result);
  return result;
}

describe('WorkOrderOperatorCommandService', () => {
  const operatorId = new Types.ObjectId().toHexString();
  const otherOperatorId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId();

  function ownedOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: workOrderId,
      technician_id: new Types.ObjectId(operatorId),
      type_maintenance: 'corrective',
      status: 'scheduled',
      ...overrides,
    };
  }

  let workOrderModel: {
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let preventiveSchedulingService: {
    reschedulePreventiveOccurrence: jest.Mock;
  };
  let service: WorkOrderOperatorCommandService;

  beforeEach(() => {
    workOrderModel = {
      findById: jest.fn().mockReturnValue(chain(ownedOrder())),
      findOneAndUpdate: jest.fn().mockReturnValue(chain(null)),
    };
    preventiveSchedulingService = {
      reschedulePreventiveOccurrence: jest.fn().mockResolvedValue({
        occurrence: ownedOrder(),
        schedulingState: 'scheduled',
      }),
    };
    // The real lifecycle service is used directly (rather than mocked) so
    // these tests exercise the actual atomic status-guarded transitions
    // this service delegates to — its own dedicated spec covers the
    // transition/history/self-approval details in isolation.
    const lifecycleService = new WorkOrderLifecycleService(
      workOrderModel as never,
      {} as never,
    );

    service = new WorkOrderOperatorCommandService(
      workOrderModel as never,
      lifecycleService,
      preventiveSchedulingService as never,
    );
  });

  describe('startWorkOrderForOperator', () => {
    it('rejects when the work order does not exist', async () => {
      workOrderModel.findById.mockReturnValue(chain(null));

      await expect(
        service.startWorkOrderForOperator({
          operatorId,
          workOrderId: workOrderId.toHexString(),
        }),
      ).rejects.toThrow(NotFoundException);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects when the work order is not assigned to this operator', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(
          ownedOrder({ technician_id: new Types.ObjectId(otherOperatorId) }),
        ),
      );

      await expect(
        service.startWorkOrderForOperator({
          operatorId,
          workOrderId: workOrderId.toHexString(),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('transitions a startable occurrence to in_progress and records the start time', async () => {
      const updated = ownedOrder({ status: 'in_progress' });
      workOrderModel.findOneAndUpdate.mockReturnValue(chain(updated));

      const result = await service.startWorkOrderForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
      });

      expect(workOrderModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: workOrderId,
          technician_id: new Types.ObjectId(operatorId),
          status: { $in: ['scheduled', 'overdue', 'pending'] },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'in_progress' }),
        }),
        { new: true },
      );
      expect(result).toBe(updated);
    });

    it('rejects starting a work order that is not in a startable status', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(ownedOrder({ status: 'in_progress' })),
      );
      workOrderModel.findOneAndUpdate.mockReturnValue(chain(null));

      await expect(
        service.startWorkOrderForOperator({
          operatorId,
          workOrderId: workOrderId.toHexString(),
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('completeWorkOrderForOperator', () => {
    it('rejects a preventive occurrence, directing it to the dedicated submission endpoint', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(
          ownedOrder({ type_maintenance: 'preventive', status: 'in_progress' }),
        ),
      );

      await expect(
        service.completeWorkOrderForOperator({
          operatorId,
          workOrderId: workOrderId.toHexString(),
        }),
      ).rejects.toThrow(ConflictException);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each(['lubrication', 'inspection', 'annual-calibration'])(
      'rejects a %s occurrence, directing it to the dedicated submission endpoint same as preventive',
      async (type) => {
        workOrderModel.findById.mockReturnValue(
          chain(ownedOrder({ type_maintenance: type, status: 'in_progress' })),
        );

        await expect(
          service.completeWorkOrderForOperator({
            operatorId,
            workOrderId: workOrderId.toHexString(),
          }),
        ).rejects.toThrow(ConflictException);
        expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it('rejects completing a work order that is not currently in progress', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(ownedOrder({ status: 'scheduled' })),
      );
      workOrderModel.findOneAndUpdate.mockReturnValue(chain(null));

      await expect(
        service.completeWorkOrderForOperator({
          operatorId,
          workOrderId: workOrderId.toHexString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the work order is not assigned to this operator', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(
          ownedOrder({
            technician_id: new Types.ObjectId(otherOperatorId),
            status: 'in_progress',
          }),
        ),
      );

      await expect(
        service.completeWorkOrderForOperator({
          operatorId,
          workOrderId: workOrderId.toHexString(),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('moves a corrective occurrence in progress to waiting_validation, never straight to completed', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(ownedOrder({ status: 'in_progress' })),
      );
      const updated = ownedOrder({ status: 'waiting_validation' });
      workOrderModel.findOneAndUpdate.mockReturnValue(chain(updated));

      const result = await service.completeWorkOrderForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
      });

      expect(workOrderModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: workOrderId,
          technician_id: new Types.ObjectId(operatorId),
          status: { $in: ['in_progress'] },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'waiting_validation' }),
        }),
        { new: true },
      );
      expect(result).toBe(updated);
    });
  });

  describe('rescheduleWorkOrderForOperator', () => {
    it('rejects when the work order is not assigned to this operator, before touching the reschedule logic', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(
          ownedOrder({ technician_id: new Types.ObjectId(otherOperatorId) }),
        ),
      );

      await expect(
        service.rescheduleWorkOrderForOperator({
          operatorId,
          workOrderId: workOrderId.toHexString(),
          newDueDate: '2026-08-01T08:00:00.000Z',
          reason: 'Machine unavailable',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(
        preventiveSchedulingService.reschedulePreventiveOccurrence,
      ).not.toHaveBeenCalled();
    });

    it('delegates to the shared reschedule logic as the operator role once ownership is verified', async () => {
      const expected = {
        occurrence: ownedOrder(),
        schedulingState: 'scheduled',
      };
      preventiveSchedulingService.reschedulePreventiveOccurrence.mockResolvedValue(
        expected,
      );

      const result = await service.rescheduleWorkOrderForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        newDueDate: '2026-08-01T08:00:00.000Z',
        reason: 'Machine unavailable',
      });

      expect(
        preventiveSchedulingService.reschedulePreventiveOccurrence,
      ).toHaveBeenCalledWith({
        workOrderId: workOrderId.toHexString(),
        newDueDate: '2026-08-01T08:00:00.000Z',
        reason: 'Machine unavailable',
        userId: operatorId,
        role: 'operator',
      });
      expect(result).toBe(expected);
    });
  });
});
