import { BadRequestException, ConflictException } from '@nestjs/common';
import * as historical from './historical-defect-import.parser';
import * as catalogue from './product-defect-catalogue.parser';
import {
  prepareQualityImport,
  QualityImportPlan,
  QualityImportService,
} from './quality-import.service';

const entry = (extra = {}) => ({
  defectCode: 'F201',
  defectName: 'Loop',
  normalizedProcess: 'Tressage',
  source: 'OFFICIAL',
  sourceFile: 'catalogue.docx',
  sourceSection: 1,
  sourceParagraph: 2,
  importIdentity: 'catalogue-id',
  ...extra,
});
const occurrence = (extra = {}) => ({
  sourceDefectCode: '201',
  canonicalDefectCode: 'F201',
  process: 'Tressage',
  occurrenceDate: '2025-01-03',
  quantityAffected: 1,
  source: 'HISTORICAL_IMPORT' as const,
  sourceYear: 2025,
  sourceSheet: 'Janv',
  sourceRow: 4,
  sourceCell: 'D4',
  importIdentity: '1234567890abcdef',
  ...extra,
});
const makePlan = (
  extra: Partial<QualityImportPlan> = {},
): QualityImportPlan => ({
  catalogueCount: 1,
  occurrenceRecordCount: 1,
  affectedQuantity: 1,
  sourceWorkbook: 'history.xlsx',
  unmatchedCodes: [],
  warnings: [],
  errors: [],
  catalogue: [entry()],
  occurrences: [occurrence()],
  ...extra,
});
const query = (rows: unknown[]) => ({
  select: () => ({ lean: () => ({ exec: async () => rows }) }),
});
const existingOccurrence = () => {
  const item = occurrence();
  return {
    import_identity: item.importIdentity,
    defect_code: item.canonicalDefectCode,
    source_defect_code: item.sourceDefectCode,
    process: item.process,
    occurrence_date: new Date(`${item.occurrenceDate}T00:00:00.000Z`),
    quantity_affected: item.quantityAffected,
    source_sheet: item.sourceSheet,
    source_row: item.sourceRow,
    source_cell: item.sourceCell,
  };
};

describe('prepareQualityImport without local source files', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts official checkpoints and combines warnings', async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry({ defectCode: `F${i}`, importIdentity: `c${i}` }),
    );
    const occurrences = Array.from({ length: 30 }, (_, i) =>
      occurrence({
        canonicalDefectCode: entries[i % 20].defectCode,
        importIdentity: `o${i}`,
      }),
    );
    jest.spyOn(catalogue, 'parseProductDefectCatalogue').mockResolvedValue({
      sourceFile: '',
      sectionsInspected: 20,
      validEntries: entries,
      rejectedSections: [],
      duplicates: [],
      warnings: ['catalogue warning'],
      errors: [],
    });
    jest.spyOn(historical, 'parseHistoricalWorkbook').mockResolvedValue({
      workbook: '',
      year: 2025,
      sheetsProcessed: [],
      rowsInspected: 30,
      validOccurrenceCells: 30,
      totalOccurrenceQuantity: 30,
      occurrencesByMonth: {},
      occurrencesBySourceSheet: {},
      occurrencesByProcess: {},
      occurrencesByDefectCode: {},
      skippedCells: 0,
      warnings: ['history warning'],
      errors: [],
      occurrences,
      annualReconciliation: { available: false, dailyTotal: 30 },
    });
    const result = await prepareQualityImport(
      'catalogue.docx',
      'C:/imports/history.xlsx',
    );
    expect(result).toEqual(
      expect.objectContaining({
        catalogueCount: 20,
        occurrenceRecordCount: 30,
        affectedQuantity: 30,
        sourceWorkbook: 'history.xlsx',
        warnings: ['catalogue warning', 'history warning'],
        errors: [],
      }),
    );
  });

  it('reports parser, checkpoint, and deduplicated mapping errors', async () => {
    jest.spyOn(catalogue, 'parseProductDefectCatalogue').mockResolvedValue({
      sourceFile: '',
      sectionsInspected: 1,
      validEntries: [entry()],
      rejectedSections: [],
      duplicates: [],
      warnings: [],
      errors: ['catalogue error'],
    });
    jest.spyOn(historical, 'parseHistoricalWorkbook').mockResolvedValue({
      workbook: '',
      year: 2025,
      sheetsProcessed: [],
      rowsInspected: 2,
      validOccurrenceCells: 2,
      totalOccurrenceQuantity: 4,
      occurrencesByMonth: {},
      occurrencesBySourceSheet: {},
      occurrencesByProcess: {},
      occurrencesByDefectCode: {},
      skippedCells: 0,
      warnings: [],
      errors: ['history error'],
      occurrences: [
        occurrence({ canonicalDefectCode: 'F999' }),
        occurrence({ canonicalDefectCode: 'F999' }),
      ],
      annualReconciliation: { available: false, dailyTotal: 4 },
    });
    const result = await prepareQualityImport('catalogue.docx', 'history.xlsx');
    expect(result.unmatchedCodes).toEqual(['F999']);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'catalogue error',
        'history error',
        'Expected 20 official catalogue definitions; parsed 1',
        'Official workbook checkpoint differs: 2 records, 4 affected',
        'Unmapped historical codes: F999',
      ]),
    );
  });
});

describe('QualityImportService', () => {
  it('rejects invalid plans before database access', async () => {
    const c = { find: jest.fn() },
      o = { find: jest.fn() };
    const service = new QualityImportService(c as never, o as never);
    await expect(
      service.apply(makePlan({ errors: ['bad input'] })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(c.find).not.toHaveBeenCalled();
  });

  it('detects catalogue and historical conflicts', async () => {
    const c = {
      find: jest.fn(() =>
        query([{ defect_code: 'F201', import_identity: 'changed' }]),
      ),
    };
    const o = {
      find: jest.fn(() =>
        query([
          {
            ...existingOccurrence(),
            occurrence_date: 'invalid',
            quantity_affected: 9,
          },
        ]),
      ),
    };
    const result = await new QualityImportService(
      c as never,
      o as never,
    ).previewExisting(makePlan());
    expect(result.conflicts).toEqual(['F201', 'historical:1234567890ab']);
  });

  it('rejects conflicts before writes', async () => {
    const c = {
      find: jest.fn(() =>
        query([{ defect_code: 'F201', import_identity: 'changed' }]),
      ),
      bulkWrite: jest.fn(),
    };
    const o = { find: jest.fn(() => query([])), bulkWrite: jest.fn() };
    await expect(
      new QualityImportService(c as never, o as never).apply(makePlan()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(c.bulkWrite).not.toHaveBeenCalled();
  });

  it('writes new rows and reports inserted totals', async () => {
    const c = {
      find: jest
        .fn()
        .mockReturnValueOnce(query([]))
        .mockReturnValueOnce(query([{ _id: 'mongo-id', defect_code: 'F201' }]))
        .mockReturnValueOnce(
          query([{ defect_code: 'F201', import_identity: 'catalogue-id' }]),
        ),
      bulkWrite: jest.fn(),
    };
    const o = {
      find: jest
        .fn()
        .mockReturnValueOnce(query([]))
        .mockReturnValueOnce(query([existingOccurrence()])),
      bulkWrite: jest.fn(),
    };
    const result = await new QualityImportService(c as never, o as never).apply(
      makePlan(),
    );
    expect(result).toEqual({
      catalogueInserted: 1,
      catalogueSkipped: 0,
      occurrenceInserted: 1,
      occurrenceSkipped: 0,
      affectedQuantity: 1,
    });
    expect(c.bulkWrite).toHaveBeenCalledTimes(1);
    expect(o.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing catalogue link after catalogue insertion', async () => {
    const c = {
      find: jest
        .fn()
        .mockReturnValueOnce(query([]))
        .mockReturnValueOnce(query([])),
      bulkWrite: jest.fn(),
    };
    const o = { find: jest.fn(() => query([])), bulkWrite: jest.fn() };
    await expect(
      new QualityImportService(c as never, o as never).apply(makePlan()),
    ).rejects.toThrow('Catalogue link missing after import: F201');
    expect(o.bulkWrite).not.toHaveBeenCalled();
  });

  it('skips rows already imported', async () => {
    const cRow = {
      _id: 'mongo-id',
      defect_code: 'F201',
      import_identity: 'catalogue-id',
    };
    const c = { find: jest.fn(() => query([cRow])), bulkWrite: jest.fn() };
    const o = {
      find: jest.fn(() => query([existingOccurrence()])),
      bulkWrite: jest.fn(),
    };
    const result = await new QualityImportService(c as never, o as never).apply(
      makePlan(),
    );
    expect(result).toEqual(
      expect.objectContaining({
        catalogueInserted: 0,
        catalogueSkipped: 1,
        occurrenceInserted: 0,
        occurrenceSkipped: 1,
      }),
    );
    expect(c.bulkWrite).not.toHaveBeenCalled();
    expect(o.bulkWrite).not.toHaveBeenCalled();
  });
});
