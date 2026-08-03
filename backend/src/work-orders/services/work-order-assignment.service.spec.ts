import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderAssignmentService } from './work-order-assignment.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('WorkOrderAssignmentService', () => {
  const technicianId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId().toHexString();
  const machineId = new Types.ObjectId();

  let workOrderModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let service: WorkOrderAssignmentService;

  beforeEach(() => {
    workOrderModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue(execResult({ _id: workOrderId })),
    };
    service = new WorkOrderAssignmentService(workOrderModel as never);
  });

  it('returns an already assigned own work order without claiming again', async () => {
    const existing = { _id: workOrderId, technician_id: technicianId };
    workOrderModel.findOne.mockReturnValue(execResult(existing));

    await expect(
      service.claimForTechnician({
        technicianId,
        workOrderId,
        accessibleMachineIds: [machineId],
      }),
    ).resolves.toBe(existing);

    expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('claims only unassigned accessible non-closed work orders atomically', async () => {
    await service.claimForTechnician({
      technicianId,
      workOrderId,
      accessibleMachineIds: [machineId],
    });

    expect(workOrderModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: expect.any(Types.ObjectId),
        machine_id: { $in: [machineId] },
        status: {
          $nin: [
            'completed',
            'validated',
            'cancelled',
            'canceled',
            'CLOTURE',
            'ANNULE',
          ],
        },
        $or: [{ technician_id: { $exists: false } }, { technician_id: null }],
      }),
      {
        $set: {
          technician_id: expect.any(Types.ObjectId),
          status: 'assigned',
        },
      },
      { new: true },
    );
  });

  it('rejects inaccessible or concurrently claimed work orders', async () => {
    workOrderModel.findOneAndUpdate.mockReturnValue(execResult(null));

    await expect(
      service.claimForTechnician({
        technicianId,
        workOrderId,
        accessibleMachineIds: [],
      }),
    ).rejects.toThrow(ConflictException);
  });
});
