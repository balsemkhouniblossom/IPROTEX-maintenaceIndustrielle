import { existsSync } from 'node:fs';
import {
  QualityImportService,
  prepareQualityImport,
} from './quality-import.service';
import { importIdentity } from './historical-defect-import.parser';

const catalogueFile =
  'C:/Users/Balsem/Downloads/FM_7_5-19_iproFlex_Defect_Catalogue_EN.docx';
const workbookFile =
  'C:/Users/Balsem/Downloads/Reporting de Défauts internes  iproflex 2025.xlsx';
const sourceTest =
  existsSync(catalogueFile) && existsSync(workbookFile) ? it : it.skip;

describe('controlled IPROTEX quality import', () => {
  it('builds a stable source identity without requiring local import files', () => {
    const source = {
      sourceSheet: 'Janv',
      sourceRow: 4,
      sourceCell: 'D4',
      sourceDefectCode: '201',
      process: 'Tressage',
      occurrenceDate: '2025-01-03',
    };
    expect(importIdentity(source)).toBe(importIdentity(source));
    expect(importIdentity(source)).toMatch(/^[a-f0-9]{64}$/);
    expect(importIdentity({ ...source, sourceCell: 'E4' })).not.toBe(
      importIdentity(source),
    );
  });

  sourceTest(
    'reconciles the official catalogue and daily-cell workbook without inventing MTTR',
    async () => {
      const plan = await prepareQualityImport(catalogueFile, workbookFile);
      expect(plan.errors).toEqual([]);
      expect(plan.catalogueCount).toBe(20);
      expect(plan.occurrenceRecordCount).toBe(30);
      expect(plan.affectedQuantity).toBe(30);
      expect(plan.unmatchedCodes).toEqual([]);
      expect(
        plan.catalogue.find((entry) => entry.defectCode === 'F201')?.defectName,
      ).toBe('Loop in the sleeve');
      expect(
        plan.catalogue.find((entry) => entry.defectCode === 'F401')?.defectName,
      ).toBe('Asymmetrical spool filling');
      const f201 = plan.catalogue.find((entry) => entry.defectCode === 'F201');
      expect(f201?.description).toContain('loops');
      expect(f201?.cause).toBeTruthy();
      expect(f201?.prevention).toBeTruthy();
      expect(f201?.evaluation).toBeTruthy();
      expect(f201?.testSamples).toBeTruthy();
      expect(f201?.testRegulation).toBeTruthy();
      expect(
        plan.catalogue.find((entry) => entry.defectCode === 'F103')
          ?.testProcedure,
      ).toBeTruthy();
      expect(
        plan.occurrences.every(
          (item) => !('resolvedAt' in item) && !('resolutionDuration' in item),
        ),
      ).toBe(true);
      expect(
        plan.occurrences.every(
          (item) => item.sourceCell && item.importIdentity.length === 64,
        ),
      ).toBe(true);
      expect(
        plan.occurrences.find(
          (item) =>
            item.sourceSheet === 'Oct' &&
            item.occurrenceDate.startsWith('2025-09'),
        ),
      ).toBeDefined();
    },
  );

  sourceTest(
    'produces deterministic import identities on repeat parsing',
    async () => {
      const first = await prepareQualityImport(catalogueFile, workbookFile);
      const second = await prepareQualityImport(catalogueFile, workbookFile);
      expect(first.catalogue.map((item) => item.importIdentity)).toEqual(
        second.catalogue.map((item) => item.importIdentity),
      );
      expect(first.occurrences.map((item) => item.importIdentity)).toEqual(
        second.occurrences.map((item) => item.importIdentity),
      );
      expect(new Set(first.catalogue.map((item) => item.defectCode)).size).toBe(
        first.catalogueCount,
      );
      expect(
        new Set(first.occurrences.map((item) => item.importIdentity)).size,
      ).toBe(first.occurrenceRecordCount);
    },
  );

  sourceTest(
    'writes insert-only upserts with exact catalogue links and no fabricated closure data',
    async () => {
      const plan = await prepareQualityImport(catalogueFile, workbookFile);
      const codes = [
        ...new Set(plan.occurrences.map((item) => item.canonicalDefectCode)),
      ];
      const catalogueRows = codes.map((code) => ({
        _id: `catalogue-${code}`,
        defect_code: code,
        import_identity: plan.catalogue.find((item) => item.defectCode === code)
          ?.importIdentity,
      }));
      const catalogueModel = {
        find: jest
          .fn()
          .mockReturnValueOnce({
            select: () => ({ lean: () => ({ exec: async () => [] }) }),
          })
          .mockReturnValueOnce({
            select: () => ({
              lean: () => ({ exec: async () => catalogueRows }),
            }),
          })
          .mockReturnValueOnce({
            select: () => ({
              lean: () => ({
                exec: async () =>
                  plan.catalogue.map((item) => ({
                    defect_code: item.defectCode,
                    import_identity: item.importIdentity,
                  })),
              }),
            }),
          }),
        bulkWrite: jest.fn().mockResolvedValue({}),
      };
      const occurrenceModel = {
        find: jest
          .fn()
          .mockReturnValueOnce({
            select: () => ({ lean: () => ({ exec: async () => [] }) }),
          })
          .mockReturnValueOnce({
            select: () => ({
              lean: () => ({
                exec: async () =>
                  plan.occurrences.map((item) => ({
                    import_identity: item.importIdentity,
                  })),
              }),
            }),
          }),
        bulkWrite: jest.fn().mockResolvedValue({}),
      };
      const importer = new QualityImportService(
        catalogueModel as never,
        occurrenceModel as never,
      );
      const report = await importer.apply(plan);
      expect(report.catalogueInserted).toBe(20);
      expect(report.occurrenceInserted).toBe(30);
      const writes = occurrenceModel.bulkWrite.mock.calls[0][0] as Array<{
        updateOne: {
          filter: { import_identity: string };
          update: { $setOnInsert: Record<string, unknown> };
          upsert: boolean;
        };
      }>;
      expect(writes).toHaveLength(30);
      const numeric201 = writes.find(
        (write) =>
          write.updateOne.update.$setOnInsert.source_defect_code === '201',
      );
      expect(numeric201?.updateOne.update.$setOnInsert.defect_code).toBe(
        'F201',
      );
      expect(numeric201?.updateOne.update.$setOnInsert.catalogue_id).toBe(
        'catalogue-F201',
      );
      expect(
        writes.every(
          (write) =>
            write.updateOne.upsert &&
            write.updateOne.filter.import_identity ===
              write.updateOne.update.$setOnInsert.import_identity,
        ),
      ).toBe(true);
      expect(
        writes.every(
          (write) =>
            !('resolved_at' in write.updateOne.update.$setOnInsert) &&
            !('resolved_by' in write.updateOne.update.$setOnInsert),
        ),
      ).toBe(true);
      expect(
        writes.every(
          (write) =>
            write.updateOne.update.$setOnInsert.date_precision === 'DATE',
        ),
      ).toBe(true);
      expect(
        writes.every(
          (write) =>
            write.updateOne.update.$setOnInsert.source_file ===
            plan.sourceWorkbook,
        ),
      ).toBe(true);
    },
  );

  sourceTest(
    'reports all definitions and occurrences as skipped on a repeated import',
    async () => {
      const plan = await prepareQualityImport(catalogueFile, workbookFile);
      const allCatalogue = plan.catalogue.map((item) => ({
        _id: `catalogue-${item.defectCode}`,
        defect_code: item.defectCode,
        import_identity: item.importIdentity,
      }));
      const allOccurrences = plan.occurrences.map((item) => ({
        import_identity: item.importIdentity,
        defect_code: item.canonicalDefectCode,
        source_defect_code: item.sourceDefectCode,
        process: item.process,
        occurrence_date: new Date(`${item.occurrenceDate}T00:00:00.000Z`),
        quantity_affected: item.quantityAffected,
        source_sheet: item.sourceSheet,
        source_row: item.sourceRow,
        source_cell: item.sourceCell,
      }));
      const catalogueModel = {
        find: jest.fn(() => ({
          select: () => ({ lean: () => ({ exec: async () => allCatalogue }) }),
        })),
        bulkWrite: jest.fn().mockResolvedValue({}),
      };
      const occurrenceModel = {
        find: jest.fn(() => ({
          select: () => ({
            lean: () => ({ exec: async () => allOccurrences }),
          }),
        })),
        bulkWrite: jest.fn().mockResolvedValue({}),
      };
      const report = await new QualityImportService(
        catalogueModel as never,
        occurrenceModel as never,
      ).apply(plan);
      expect(report).toEqual(
        expect.objectContaining({
          catalogueInserted: 0,
          catalogueSkipped: 20,
          occurrenceInserted: 0,
          occurrenceSkipped: 30,
        }),
      );
      expect(catalogueModel.bulkWrite).not.toHaveBeenCalled();
      expect(occurrenceModel.bulkWrite).not.toHaveBeenCalled();
    },
  );

  sourceTest(
    'rejects an existing historical identity whose quantity was changed before any write',
    async () => {
      const plan = await prepareQualityImport(catalogueFile, workbookFile);
      const item = plan.occurrences[0];
      const catalogueModel = {
        find: jest.fn(() => ({
          select: () => ({ lean: () => ({ exec: async () => [] }) }),
        })),
        bulkWrite: jest.fn(),
      };
      const occurrenceModel = {
        find: jest.fn(() => ({
          select: () => ({
            lean: () => ({
              exec: async () => [
                {
                  import_identity: item.importIdentity,
                  defect_code: item.canonicalDefectCode,
                  source_defect_code: item.sourceDefectCode,
                  process: item.process,
                  occurrence_date: new Date(
                    `${item.occurrenceDate}T00:00:00.000Z`,
                  ),
                  quantity_affected: item.quantityAffected + 1,
                  source_sheet: item.sourceSheet,
                  source_row: item.sourceRow,
                  source_cell: item.sourceCell,
                },
              ],
            }),
          }),
        })),
        bulkWrite: jest.fn(),
      };
      await expect(
        new QualityImportService(
          catalogueModel as never,
          occurrenceModel as never,
        ).apply(plan),
      ).rejects.toThrow('conflicts');
      expect(catalogueModel.bulkWrite).not.toHaveBeenCalled();
      expect(occurrenceModel.bulkWrite).not.toHaveBeenCalled();
    },
  );
  sourceTest(
    'rejects a conflicting catalogue code before any write',
    async () => {
      const plan = await prepareQualityImport(catalogueFile, workbookFile);
      const catalogueModel = {
        find: jest.fn(() => ({
          select: () => ({
            lean: () => ({
              exec: async () => [
                { defect_code: 'F201', import_identity: 'different-source' },
              ],
            }),
          }),
        })),
        bulkWrite: jest.fn(),
      };
      const occurrenceModel = {
        find: jest.fn(() => ({
          select: () => ({ lean: () => ({ exec: async () => [] }) }),
        })),
        bulkWrite: jest.fn(),
      };
      await expect(
        new QualityImportService(
          catalogueModel as never,
          occurrenceModel as never,
        ).apply(plan),
      ).rejects.toThrow('conflicts');
      expect(catalogueModel.bulkWrite).not.toHaveBeenCalled();
      expect(occurrenceModel.bulkWrite).not.toHaveBeenCalled();
    },
  );
});
