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
  const defectModel = {
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
    defectModel as never,
    machineTypeModel as never,
    occurrenceModel as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    entryModel.find.mockReturnValue(chain([]));
    entryModel.distinct.mockReturnValue({ exec: async () => [] });
    defectModel.find.mockReturnValue(chain([]));
    defectModel.distinct.mockReturnValue({ exec: async () => [] });
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
          unit: 'MINUTES',
        },
      ]),
    );
    const result = await service.getYear('2026');
    expect(result.processes).toHaveLength(2);
    expect(result.processes[1].name).toBe('Extrusion');
    expect(result.processes[0].months).toHaveLength(12);
    expect(result.processes[0].months[8]).toEqual(
      expect.objectContaining({ mttrValue: 2.5, unit: 'MINUTES' }),
    );
    expect(result.processes[0].months[0].mttrValue).toBeNull();
  });

  it('converts legacy hour entries to minutes when reading', async () => {
    machineTypeModel.find.mockReturnValue(
      chain([{ _id: windingId, name: 'Winding' }]),
    );
    entryModel.find.mockReturnValue(
      chain([
        {
          machine_type_id: windingId,
          month: 1,
          mttr_value: 2.5,
          unit: 'HOURS',
        },
      ]),
    );
    const result = await service.getYear('2026');
    expect(result.processes[0].months[0]).toEqual(
      expect.objectContaining({ mttrValue: 150, unit: 'MINUTES' }),
    );
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

  it('returns official counts as read-only and manual counts as editable', async () => {
    machineTypeModel.find.mockReturnValue(
      chain([
        { _id: windingId, name: 'Winding' },
        { _id: extrusionId, name: 'Extrusion' },
      ]),
    );
    defectModel.find.mockReturnValue(
      chain([
        {
          machine_type_id: extrusionId,
          month: 2,
          defect_count: 0,
          source: 'MANUAL',
        },
      ]),
    );
    occurrenceModel.aggregate.mockReturnValue({
      exec: async () => [
        {
          _id: { process: 'Bobinage', month: 1 },
          defectCount: 3,
          defectCodes: ['F201'],
        },
      ],
    });
    const result = await service.getYear(2025);
    expect(result.processes[0].months[0]).toEqual(
      expect.objectContaining({
        defectCount: 3,
        defectSource: 'OFFICIAL_IMPORT',
        defectReadOnly: true,
      }),
    );
    expect(result.processes[1].months[1]).toEqual(
      expect.objectContaining({
        defectCount: 0,
        defectSource: 'MANUAL',
        defectReadOnly: false,
      }),
    );
  });

  it('saves and clears only validated machine-type/month cells', async () => {
    const actor = new Types.ObjectId().toString();
    machineTypeModel.find.mockReturnValue(
      chain([{ _id: windingId, name: 'Winding' }]),
    );
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
    machineTypeModel.find.mockReturnValue(chain([]));
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

  it('saves aggregate manual defects without creating occurrence records', async () => {
    const actor = new Types.ObjectId().toString();
    machineTypeModel.find.mockReturnValue(
      chain([{ _id: windingId, name: 'Winding' }]),
    );
    occurrenceModel.aggregate.mockReturnValue({ exec: async () => [] });
    await service.save(
      {
        year: 2026,
        entries: [],
        defectEntries: [
          { machineTypeId: windingId.toString(), month: 1, defectCount: 0 },
          { machineTypeId: windingId.toString(), month: 2, defectCount: null },
        ],
      },
      actor,
    );
    expect(defectModel.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({ upsert: true }),
      }),
      expect.objectContaining({ deleteOne: expect.any(Object) }),
    ]);
    expect(occurrenceModel).not.toHaveProperty('bulkWrite');
  });

  it('rejects attempts to overwrite an official imported defect cell', async () => {
    const actor = new Types.ObjectId().toString();
    machineTypeModel.find.mockReturnValue(
      chain([{ _id: windingId, name: 'Winding' }]),
    );
    occurrenceModel.aggregate.mockReturnValue({
      exec: async () => [{ _id: { process: 'Bobinage', month: 1 } }],
    });
    await expect(
      service.save(
        {
          year: 2025,
          entries: [],
          defectEntries: [
            { machineTypeId: windingId.toString(), month: 1, defectCount: 9 },
          ],
        },
        actor,
      ),
    ).rejects.toThrow('Official imported defect data cannot be overwritten');
  });
});
