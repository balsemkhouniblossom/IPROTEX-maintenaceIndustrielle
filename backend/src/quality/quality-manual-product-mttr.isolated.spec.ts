import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import {
  ProductQualityMttrEntry,
  ProductQualityMttrEntrySchema,
} from '../schemas/product-quality-mttr-entry.schema';
import {
  QualityDefectOccurrence,
  QualityDefectOccurrenceSchema,
  QualityDefectSource,
} from '../schemas/quality-defect-occurrence.schema';
import { QualityManualProductMttrService } from './quality-manual-product-mttr.service';

jest.setTimeout(120_000);

describe('Manual Product Quality MTTR in isolated MongoDB', () => {
  let mongo: MongoMemoryServer;
  let connection: mongoose.Connection;
  let service: QualityManualProductMttrService;
  let machineTypes: mongoose.Model<MachineType>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create({
      instance: { dbName: 'manual_product_quality_mttr_test' },
    });
    connection = await mongoose
      .createConnection(mongo.getUri('manual_product_quality_mttr_test'))
      .asPromise();
    const entries = connection.model(
      ProductQualityMttrEntry.name,
      ProductQualityMttrEntrySchema,
    );
    machineTypes = connection.model(MachineType.name, MachineTypeSchema);
    const occurrences = connection.model(
      QualityDefectOccurrence.name,
      QualityDefectOccurrenceSchema,
    );
    service = new QualityManualProductMttrService(
      entries as never,
      machineTypes as never,
      occurrences as never,
    );
  });

  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  });

  it('persists direct MTTR independently by year, month, and dynamic machine type', async () => {
    const winding = await machineTypes.create({ type_id: 1, name: 'Winding' });
    const extrusion = await machineTypes.create({
      type_id: 2,
      name: 'Extrusion',
    });
    const actor = new Types.ObjectId().toString();
    await service.save(
      {
        year: 2026,
        entries: [
          { machineTypeId: winding.id, month: 9, mttrValue: 2.5 },
          { machineTypeId: extrusion.id, month: 9, mttrValue: 0.75 },
        ],
      },
      actor,
    );
    await service.save(
      {
        year: 2027,
        entries: [{ machineTypeId: winding.id, month: 9, mttrValue: 1.5 }],
      },
      actor,
    );
    const year2026 = await service.getYear(2026);
    const year2027 = await service.getYear(2027);
    expect(year2026.processes).toHaveLength(2);
    expect(
      year2026.processes.find((item) => item.name === 'Winding')?.months[8]
        .mttrValue,
    ).toBe(2.5);
    expect(
      year2026.processes.find((item) => item.name === 'Extrusion')?.months[8]
        .mttrValue,
    ).toBe(0.75);
    expect(
      year2027.processes.find((item) => item.name === 'Winding')?.months[8]
        .mttrValue,
    ).toBe(1.5);
    expect(year2027.processes[0].months[0].mttrValue).toBeNull();
  });

  it('loads historical context without creating manual MTTR', async () => {
    await connection.model(QualityDefectOccurrence.name).create({
      occurrence_id: 'HIST-2025-SEP',
      defect_code: 'F205',
      process: 'Braiding',
      occurrence_date: new Date('2025-09-15T00:00:00Z'),
      date_precision: 'DATE',
      quantity_affected: 5,
      source: QualityDefectSource.HISTORICAL_IMPORT,
      status: 'HISTORICAL',
    });
    const result = await service.getYear(2025);
    expect(result.historical).toEqual([
      expect.objectContaining({
        process: 'Braiding',
        month: 9,
        defectCount: 5,
      }),
    ]);
    expect(
      result.processes.every((process) =>
        process.months.every((month) => month.mttrValue === null),
      ),
    ).toBe(true);
  });
});
