import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderLifecycleService } from './work-order-lifecycle.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function findOneChain<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('WorkOrderLifecycleService', () => {
  const workOrderId = new Types.ObjectId();
  const technicianId = new Types.ObjectId();
  const validatorId = new Types.ObjectId().toHexString();

  let workOrderModel: {
    findById: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let interventionReportModel: {
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    updateOne: jest.Mock;
  };
  let service: WorkOrderLifecycleService;

  beforeEach(() => {
    workOrderModel = {
      findById: jest.fn().mockReturnValue(
        execResult({
          _id: workOrderId,
          status: 'waiting_validation',
          technician_id: technicianId,
        }),
      ),
      findOne: jest.fn().mockReturnValue(execResult(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(
        execResult({
          _id: workOrderId,
          status: 'validated',
          technician_id: technicianId,
        }),
      ),
    };
    interventionReportModel = {
      findOne: jest.fn().mockReturnValue(findOneChain(null)),
      findByIdAndUpdate: jest.fn().mockReturnValue(execResult(null)),
      updateOne: jest.fn().mockReturnValue(execResult({})),
    };
    service = new WorkOrderLifecycleService(
      workOrderModel as never,
      interventionReportModel as never,
    );
  });

  it('validates by expected current status and appends lifecycle history', async () => {
    await service.applyValidationAction({
      workOrderId: workOrderId.toHexString(),
      action: 'approve',
      validatorId,
    });

    expect(workOrderModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: workOrderId, status: { $in: ['waiting_validation'] } },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'validated' }),
        $push: {
          lifecycle_history: expect.objectContaining({
            action: 'validated',
            from_status: 'waiting_validation',
            to_status: 'validated',
            actor_user_id: expect.any(Types.ObjectId),
          }),
        },
      }),
      { new: true },
    );
  });

  it('rejects self-approval using the latest report performer when present', async () => {
    interventionReportModel.findOne.mockReturnValue(
      findOneChain({ _id: new Types.ObjectId(), technician_id: technicianId }),
    );

    await expect(
      service.applyValidationAction({
        workOrderId: workOrderId.toHexString(),
        action: 'approve',
        validatorId: technicianId.toHexString(),
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('fails stale validation transitions instead of overwriting newer status', async () => {
    workOrderModel.findOneAndUpdate.mockReturnValue(execResult(null));

    await expect(
      service.applyValidationAction({
        workOrderId: workOrderId.toHexString(),
        action: 'reject',
        validatorId,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('treats repeated identical validation decisions as idempotent replays', async () => {
    const alreadyValidated = {
      _id: workOrderId,
      status: 'validated',
      technician_id: technicianId,
    };
    workOrderModel.findById.mockReturnValue(execResult(alreadyValidated));

    const result = await service.applyValidationAction({
      workOrderId: workOrderId.toHexString(),
      action: 'approve',
      validatorId,
    });

    expect(result).toBe(alreadyValidated);
    expect(
      (result as unknown as { __validationAlreadyApplied?: boolean })
        .__validationAlreadyApplied,
    ).toBe(true);
    expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(interventionReportModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('starts technician work with a single atomic claim-and-transition update', async () => {
    const machineId = new Types.ObjectId();

    await service.startForTechnician({
      technicianId: technicianId.toHexString(),
      workOrderId: workOrderId.toHexString(),
      accessibleMachineIds: [machineId],
    });

    expect(workOrderModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: workOrderId,
        status: {
          $in: [
            'waiting_validation',
            'technician_required',
            'assigned',
            'returned',
          ],
        },
        $or: [
          {
            technician_id: { $in: [technicianId, technicianId.toHexString()] },
          },
          {
            machine_id: { $in: [machineId] },
            $or: [
              { technician_id: { $exists: false } },
              { technician_id: null },
            ],
          },
        ],
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'in_progress',
          technician_id: technicianId,
          date_start: expect.any(Date),
        }),
      }),
      { new: true },
    );
    expect(interventionReportModel.updateOne).toHaveBeenCalledWith(
      { ot_id: workOrderId },
      { $set: { validation_responsable: 'validated' } },
    );
  });
});
