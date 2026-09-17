import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import {
  ProductQualityMonthlyMttr,
  ProductQualityMonthlyMttrSchema,
} from '../schemas/product-quality-monthly-mttr.schema';
import {
  QualityDatePrecision,
  QualityDefectOccurrence,
  QualityDefectOccurrenceSchema,
  QualityDefectSource,
  QualityDefectStatus,
} from '../schemas/quality-defect-occurrence.schema';
import { QualityProductMttrService } from './quality-product-mttr.service';

jest.setTimeout(120_000);
describe('Product Quality monthly MTTR in isolated MongoDB', () => {
  let mongo: MongoMemoryServer;
  let connection: mongoose.Connection;
  let service: QualityProductMttrService;
  let occurrences: mongoose.Model<QualityDefectOccurrence>;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'product_mttr_monthly_test' },
    });
    connection = await mongoose
      .createConnection(mongo.getUri('product_mttr_monthly_test'))
      .asPromise();
    const monthly = connection.model(
      ProductQualityMonthlyMttr.name,
      ProductQualityMonthlyMttrSchema,
    );
    occurrences = connection.model(
      QualityDefectOccurrence.name,
      QualityDefectOccurrenceSchema,
    );
    service = new QualityProductMttrService(
      monthly as never,
      occurrences as never,
    );
  });
  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  });
  it('persists arbitrary years idempotently and reads official historical counts separately', async () => {
    const actor = new Types.ObjectId().toString();
    await occurrences.create([
      {
        occurrence_id: 'H-JAN',
        defect_code: 'F201',
        process: 'Tressage',
        occurrence_date: new Date('2025-01-15T00:00:00Z'),
        date_precision: QualityDatePrecision.DATE,
        quantity_affected: 1,
        source: QualityDefectSource.HISTORICAL_IMPORT,
        status: QualityDefectStatus.HISTORICAL,
      },
      {
        occurrence_id: 'H-SEP',
        defect_code: 'F201',
        process: 'Tressage',
        occurrence_date: new Date('2025-09-15T00:00:00Z'),
        date_precision: QualityDatePrecision.DATE,
        quantity_affected: 5,
        source: QualityDefectSource.HISTORICAL_IMPORT,
        status: QualityDefectStatus.HISTORICAL,
      },
    ]);
    await service.upsertMonth(
      '2025',
      '1',
      { resolvedDefects: 4, totalResolutionMinutes: 570, note: 'Initial' },
      actor,
    );
    await service.upsertMonth(
      '2025',
      '1',
      { resolvedDefects: 5, totalResolutionMinutes: 600, note: 'Corrected' },
      actor,
    );
    await service.upsertMonth(
      '2031',
      '12',
      { resolvedDefects: 2, totalResolutionMinutes: 90 },
      actor,
    );
    const result = await service.getYear('2025');
    expect(result.months[0]).toEqual(
      expect.objectContaining({
        historicalDefects: 1,
        resolvedDefects: 5,
        totalResolutionMinutes: 600,
        mttrSeconds: 7200,
        note: 'Corrected',
      }),
    );
    expect(result.months[8]).toEqual(
      expect.objectContaining({
        historicalDefects: 5,
        resolvedDefects: null,
        mttrSeconds: null,
      }),
    );
    expect(result.availableYears).toEqual(expect.arrayContaining([2025, 2031]));
    expect(
      await connection
        .model(ProductQualityMonthlyMttr.name)
        .countDocuments({ year: 2025, month: 1 }),
    ).toBe(1);
  });
});
