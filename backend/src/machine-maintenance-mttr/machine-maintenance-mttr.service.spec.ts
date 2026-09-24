import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MachineMaintenanceMttrService } from './machine-maintenance-mttr.service';

function queryResult<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('MachineMaintenanceMttrService', () => {
  const typeId = new Types.ObjectId();
  const machineId = new Types.ObjectId();
  const userId = new Types.ObjectId().toHexString();

  it('groups real stop intervals by dynamic machine type and month', async () => {
    const entryModel = {
      find: jest.fn().mockReturnValue(
        queryResult([
          {
            _id: new Types.ObjectId(),
            machine_id: machineId,
            machine_type_id: typeId,
            started_at: new Date('2026-03-01T08:00:00.000Z'),
            ended_at: new Date('2026-03-01T09:00:00.000Z'),
            duration_minutes: 60,
            source: 'OPERATOR_REPORT',
          },
          {
            _id: new Types.ObjectId(),
            machine_id: machineId,
            machine_type_id: typeId,
            started_at: new Date('2026-03-02T08:00:00.000Z'),
            ended_at: new Date('2026-03-02T10:00:00.000Z'),
            duration_minutes: 120,
            source: 'ADMIN_MANUAL',
          },
        ]),
      ),
    };
    const machineModel = {
      find: jest
        .fn()
        .mockReturnValue(
          queryResult([
            { _id: machineId, machine_id: 'F040.15', type_id: typeId },
          ]),
        ),
    };
    const machineTypeModel = {
      find: jest
        .fn()
        .mockReturnValue(queryResult([{ _id: typeId, name: 'Braiding' }])),
    };
    const service = new MachineMaintenanceMttrService(
      entryModel as never,
      machineModel as never,
      machineTypeModel as never,
    );

    const result = await service.getYear('2026');
    expect(result.processes[0].months[2]).toMatchObject({
      interventionCount: 2,
      totalMinutes: 180,
      mttrMinutes: 90,
    });
    expect(result.summary).toMatchObject({
      interventionCount: 2,
      totalMinutes: 180,
      mttrMinutes: 90,
    });
  });

  it('calculates duration on Admin creation and rejects reversed times', async () => {
    const entryModel = { create: jest.fn().mockResolvedValue({}) };
    const machineModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: machineId, type_id: typeId }),
      }),
    };
    const service = new MachineMaintenanceMttrService(
      entryModel as never,
      machineModel as never,
      {} as never,
    );
    await service.create(
      {
        machineId: machineId.toHexString(),
        startedAt: '2026-03-01T08:00:00.000Z',
        endedAt: '2026-03-01T09:30:00.000Z',
      },
      userId,
    );
    expect(entryModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        duration_minutes: 90,
        source: 'ADMIN_MANUAL',
      }),
    );
    await expect(
      service.create(
        {
          machineId: machineId.toHexString(),
          startedAt: '2026-03-01T10:00:00.000Z',
          endedAt: '2026-03-01T09:00:00.000Z',
        },
        userId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
