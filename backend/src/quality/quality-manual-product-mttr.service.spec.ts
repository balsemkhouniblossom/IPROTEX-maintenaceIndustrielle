import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { QualityManualProductMttrService } from './quality-manual-product-mttr.service';

const chain = (result: unknown) => ({
  sort: () => chain(result),
  lean: () => ({ exec: async () => result }),
  exec: async () => result,
});

describe('Manual Product Quality MTTR service', () => {
  const windingId = new Types.ObjectId();
  const extrusionId = new Types.ObjectId();
  const entryModel = {
    find: jest.fn(() => chain([])),
    distinct: jest.fn(() => ({ exec: async () => [] })),
    bulkWrite: jest.fn(async () => ({})),
  };
  const machineTypeModel = {
    find: jest.fn(() => chain([])),
    countDocuments: jest.fn(() => ({ exec: async () => 0 })),
  };
  const occurrenceModel = {
    aggregate: jest.fn(() => ({ exec: async (): Promise<unknown[]> => [] })),
  };
  const service = new QualityManualProductMttrService(
    entryModel as never,
    machineTypeModel as never,
    occurrenceModel as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    entryModel.find.mockReturnValue(chain([]));
    entryModel.distinct.mockReturnValue({ exec: async () => [] });
    machineTypeModel.find.mockReturnValue(chain([]));
    machineTypeModel.countDocuments.mockReturnValue({ exec: async () => 0 });
    occurrenceModel.aggregate.mockReturnValue({
      exec: async (): Promise<unknown[]> => [],
    });
  });

  it('returns every current MachineType dynamically with 12 separate month values', async () => {
    machineTypeModel.find.mockReturnValue(
      chain([
        { _id: windingId, name: 'Winding' },
        { _id: extrusionId, name: 'Extrusion' },
      ]),
    );
    entryModel.find.mockReturnValue(
      chain([
        {
          machine_type_id: windingId,
          month: 9,
          mttr_value: 2.5,
          unit: 'HOURS',
        },
      ]),
    );
    const result = await service.getYear('2026');
    expect(result.processes).toHaveLength(2);
    expect(result.processes[1].name).toBe('Extrusion');
    expect(result.processes[0].months).toHaveLength(12);
    expect(result.processes[0].months[8]).toEqual(
      expect.objectContaining({ mttrValue: 2.5, unit: 'HOURS' }),
    );
    expect(result.processes[0].months[0].mttrValue).toBeNull();
  });

  it('returns historical defects as context without deriving MTTR', async () => {
    occurrenceModel.aggregate.mockReturnValue({
      exec: async () => [
        {
          _id: { process: 'Braiding', month: 9 },
          defectCount: 5,
          defectCodes: ['F205'],
        },
      ],
    });
    const result = await service.getYear('2025');
    expect(result.historical[0]).toEqual({
      process: 'Braiding',
      month: 9,
      defectCount: 5,
      defectCodes: ['F205'],
    });
    expect(result.processes).toEqual([]);
  });

  it('saves and clears only validated machine-type/month cells', async () => {
    const actor = new Types.ObjectId().toString();
    machineTypeModel.countDocuments.mockReturnValue({ exec: async () => 1 });
    await service.save(
      {
        year: 2031,
        entries: [
          { machineTypeId: windingId.toString(), month: 1, mttrValue: 2.5 },
          { machineTypeId: windingId.toString(), month: 2, mttrValue: null },
        ],
      },
      actor,
    );
    expect(entryModel.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({ upsert: true }),
      }),
      expect.objectContaining({ deleteOne: expect.any(Object) }),
    ]);
  });

  it('rejects duplicate cells, invalid years and unknown machine types', async () => {
    const actor = new Types.ObjectId().toString();
    await expect(service.getYear('invalid')).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.save(
        {
          year: 2026,
          entries: [
            { machineTypeId: windingId.toString(), month: 1, mttrValue: 5 },
            { machineTypeId: windingId.toString(), month: 1, mttrValue: 6 },
          ],
        },
        actor,
      ),
    ).rejects.toThrow('Duplicate process/month entry');
    await expect(
      service.save(
        {
          year: 2026,
          entries: [
            { machineTypeId: windingId.toString(), month: 1, mttrValue: 5 },
          ],
        },
        actor,
      ),
    ).rejects.toThrow('Unknown machine type');
  });
});
