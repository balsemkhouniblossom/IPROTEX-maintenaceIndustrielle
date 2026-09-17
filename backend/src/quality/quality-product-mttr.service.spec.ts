import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { QualityDefectSource } from '../schemas/quality-defect-occurrence.schema';
import { QualityProductMttrService } from './quality-product-mttr.service';

const chain = (result: unknown) => ({
  sort: () => chain(result),
  lean: () => ({ exec: async () => result }),
  exec: async () => result,
});

describe('Product Quality monthly MTTR service', () => {
  const monthlyModel = {
    find: jest.fn(() => chain([])),
    distinct: jest.fn(() => ({ exec: async () => [] })),
    findOneAndUpdate: jest.fn(() => chain(null)),
  };
  const occurrenceModel = {
    aggregate: jest.fn((_pipeline: Array<{ $match?: { source?: string } }>) =>
      chain([]),
    ),
  };
  const service = new QualityProductMttrService(
    monthlyModel as never,
    occurrenceModel as never,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    monthlyModel.find.mockReturnValue(chain([]));
    monthlyModel.distinct.mockReturnValue({ exec: async () => [] });
    occurrenceModel.aggregate.mockReturnValue(chain([]));
  });

  it('returns 12 months and keeps historical counts separate from manual values', async () => {
    monthlyModel.find.mockReturnValue(
      chain([
        {
          year: 2025,
          month: 1,
          resolved_defects: 2,
          total_resolution_minutes: 270,
          entered_by: new Types.ObjectId(),
          updated_by: new Types.ObjectId(),
        },
      ]),
    );
    occurrenceModel.aggregate
      .mockReturnValueOnce(
        chain([
          { _id: 1, count: 1 },
          { _id: 9, count: 5 },
        ]),
      )
      .mockReturnValueOnce(chain([{ _id: 2025 }]));
    const result = await service.getYear('2025');
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toEqual(
      expect.objectContaining({
        historicalDefects: 1,
        resolvedDefects: 2,
        totalResolutionMinutes: 270,
        mttrSeconds: 8100,
        source: 'MANUAL_MONTHLY_ENTRY',
      }),
    );
    expect(result.months[8]).toEqual(
      expect.objectContaining({
        historicalDefects: 5,
        resolvedDefects: null,
        mttrSeconds: null,
      }),
    );
    expect(occurrenceModel.aggregate.mock.calls[0][0][0].$match?.source).toBe(
      QualityDefectSource.HISTORICAL_IMPORT,
    );
  });

  it('uses weighted annual totals rather than averaging monthly MTTR values', async () => {
    monthlyModel.find.mockReturnValue(
      chain([
        {
          year: 2026,
          month: 1,
          resolved_defects: 1,
          total_resolution_minutes: 60,
        },
        {
          year: 2026,
          month: 2,
          resolved_defects: 3,
          total_resolution_minutes: 540,
        },
      ]),
    );
    const result = await service.getYear('2026');
    expect(result.totalResolvedDefects).toBe(4);
    expect(result.totalResolutionMinutes).toBe(600);
    expect(result.annualMttrSeconds).toBe(9000);
  });

  it('upserts one year/month record and calculates MTTR without persisting it', async () => {
    const userId = new Types.ObjectId().toString();
    monthlyModel.findOneAndUpdate.mockReturnValue(
      chain({
        resolved_defects: 4,
        total_resolution_minutes: 570,
        note: 'Verified',
        updatedAt: new Date(),
      }),
    );
    const result = await service.upsertMonth(
      '2026',
      '3',
      { resolvedDefects: 4, totalResolutionMinutes: 570, note: ' Verified ' },
      userId,
    );
    expect(result.mttrSeconds).toBe(8550);
    expect(monthlyModel.findOneAndUpdate).toHaveBeenCalledWith(
      { year: 2026, month: 3 },
      expect.objectContaining({
        $set: expect.objectContaining({
          resolved_defects: 4,
          total_resolution_minutes: 570,
          note: 'Verified',
        }),
        $setOnInsert: expect.objectContaining({
          entered_by: expect.any(Types.ObjectId),
        }),
      }),
      expect.objectContaining({ upsert: true, runValidators: true }),
    );
  });

  it('rejects invalid year, month, and actor', async () => {
    await expect(service.getYear('1999')).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertMonth(
        '2026',
        '13',
        { resolvedDefects: 1, totalResolutionMinutes: 1 },
        new Types.ObjectId().toString(),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertMonth(
        '2026',
        '1',
        { resolvedDefects: 1, totalResolutionMinutes: 1 },
        'invalid',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
