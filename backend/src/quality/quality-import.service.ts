import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductDefectCatalogue } from '../schemas/product-defect-catalogue.schema';
import {
  QualityDefectOccurrence,
  QualityDatePrecision,
  QualityDefectSource,
  QualityDefectStatus,
} from '../schemas/quality-defect-occurrence.schema';
import { basename } from 'node:path';
import { parseHistoricalWorkbook } from './historical-defect-import.parser';
import { parseProductDefectCatalogue } from './product-defect-catalogue.parser';

export interface QualityImportPlan {
  catalogueCount: number;
  occurrenceRecordCount: number;
  affectedQuantity: number;
  sourceWorkbook: string;
  unmatchedCodes: string[];
  warnings: string[];
  errors: string[];
  catalogue: Awaited<
    ReturnType<typeof parseProductDefectCatalogue>
  >['validEntries'];
  occurrences: Awaited<
    ReturnType<typeof parseHistoricalWorkbook>
  >['occurrences'];
}

export async function prepareQualityImport(
  catalogueFile: string,
  workbookFile: string,
): Promise<QualityImportPlan> {
  const [catalogue, historical] = await Promise.all([
    parseProductDefectCatalogue(catalogueFile),
    parseHistoricalWorkbook(workbookFile),
  ]);
  const codes = new Set(
    catalogue.validEntries.map((entry) => entry.defectCode),
  );
  const unmatchedCodes = [
    ...new Set(
      historical.occurrences
        .map((item) => item.canonicalDefectCode)
        .filter((code) => !codes.has(code)),
    ),
  ];
  const errors = [...catalogue.errors, ...historical.errors];
  if (catalogue.validEntries.length !== 20)
    errors.push(
      `Expected 20 official catalogue definitions; parsed ${catalogue.validEntries.length}`,
    );
  if (
    historical.validOccurrenceCells !== 30 ||
    historical.totalOccurrenceQuantity !== 30
  )
    errors.push(
      `Official workbook checkpoint differs: ${historical.validOccurrenceCells} records, ${historical.totalOccurrenceQuantity} affected`,
    );
  if (unmatchedCodes.length)
    errors.push(`Unmapped historical codes: ${unmatchedCodes.join(', ')}`);
  return {
    catalogueCount: catalogue.validEntries.length,
    occurrenceRecordCount: historical.occurrences.length,
    affectedQuantity: historical.totalOccurrenceQuantity,
    sourceWorkbook: basename(workbookFile),
    unmatchedCodes,
    warnings: [...catalogue.warnings, ...historical.warnings],
    errors,
    catalogue: catalogue.validEntries,
    occurrences: historical.occurrences,
  };
}

@Injectable()
export class QualityImportService {
  constructor(
    @InjectModel(ProductDefectCatalogue.name)
    private readonly catalogueModel: Model<ProductDefectCatalogue>,
    @InjectModel(QualityDefectOccurrence.name)
    private readonly occurrenceModel: Model<QualityDefectOccurrence>,
  ) {}

  async previewExisting(plan: QualityImportPlan) {
    const [catalogue, occurrences] = await Promise.all([
      this.catalogueModel
        .find({
          defect_code: { $in: plan.catalogue.map((item) => item.defectCode) },
        })
        .select('_id defect_code import_identity')
        .lean()
        .exec(),
      this.occurrenceModel
        .find({
          import_identity: {
            $in: plan.occurrences.map((item) => item.importIdentity),
          },
        })
        .select(
          'import_identity defect_code source_defect_code process occurrence_date quantity_affected source_sheet source_row source_cell',
        )
        .lean()
        .exec(),
    ]);
    const catalogueByCode = new Map(
      catalogue.map((entry) => [entry.defect_code, entry]),
    );
    const conflicts = plan.catalogue
      .filter((entry) => {
        const existing = catalogueByCode.get(entry.defectCode);
        return existing && existing.import_identity !== entry.importIdentity;
      })
      .map((entry) => entry.defectCode);
    const occurrenceByIdentity = new Map(
      occurrences.map((entry) => [entry.import_identity, entry]),
    );
    for (const item of plan.occurrences) {
      const current = occurrenceByIdentity.get(item.importIdentity);
      if (!current) continue;
      const actualDate =
        current.occurrence_date instanceof Date
          ? current.occurrence_date.toISOString().slice(0, 10)
          : '';
      if (
        current.defect_code !== item.canonicalDefectCode ||
        current.source_defect_code !== item.sourceDefectCode ||
        current.process !== item.process ||
        actualDate !== item.occurrenceDate ||
        current.quantity_affected !== item.quantityAffected ||
        current.source_sheet !== item.sourceSheet ||
        current.source_row !== item.sourceRow ||
        current.source_cell !== item.sourceCell
      ) {
        conflicts.push(`historical:${item.importIdentity.slice(0, 12)}`);
      }
    }
    return {
      catalogueExisting: catalogue.length,
      occurrenceExisting: occurrences.length,
      catalogueExistingCodes: new Set(
        catalogue.map((entry) => entry.defect_code),
      ),
      occurrenceExistingIdentities: new Set(
        occurrences.map((entry) => entry.import_identity),
      ),
      conflicts,
    };
  }

  async apply(plan: QualityImportPlan) {
    if (plan.errors.length)
      throw new BadRequestException(plan.errors.join('; '));
    const existing = await this.previewExisting(plan);
    if (existing.conflicts.length)
      throw new ConflictException(
        `Existing quality import data conflicts with the official source: ${existing.conflicts.join(', ')}`,
      );
    const catalogueWrites = plan.catalogue
      .filter((entry) => !existing.catalogueExistingCodes.has(entry.defectCode))
      .map((entry) => ({
        updateOne: {
          filter: { defect_code: entry.defectCode },
          update: {
            $setOnInsert: {
              defect_code: entry.defectCode,
              defect_name: entry.defectName,
              normalized_process: entry.normalizedProcess,
              description: entry.description,
              cause: entry.cause,
              prevention: entry.prevention,
              evaluation: entry.evaluation,
              test_samples: entry.testSamples,
              test_procedure: entry.testProcedure,
              test_regulation: entry.testRegulation,
              source: entry.source,
              source_file: entry.sourceFile,
              source_section: entry.sourceSection,
              source_paragraph: entry.sourceParagraph,
              import_identity: entry.importIdentity,
              is_active: true,
            },
          },
          upsert: true,
        },
      }));
    if (catalogueWrites.length)
      await this.catalogueModel.bulkWrite(catalogueWrites);
    const linked = await this.catalogueModel
      .find({
        defect_code: {
          $in: [
            ...new Set(
              plan.occurrences.map((item) => item.canonicalDefectCode),
            ),
          ],
        },
      })
      .select('_id defect_code')
      .lean()
      .exec();
    const ids = new Map(linked.map((entry) => [entry.defect_code, entry._id]));
    const missing = [
      ...new Set(
        plan.occurrences
          .map((item) => item.canonicalDefectCode)
          .filter((code) => !ids.has(code)),
      ),
    ];
    if (missing.length)
      throw new ConflictException(
        `Catalogue link missing after import: ${missing.join(', ')}`,
      );
    const occurrenceWrites = plan.occurrences
      .filter(
        (item) =>
          !existing.occurrenceExistingIdentities.has(item.importIdentity),
      )
      .map((item) => ({
        updateOne: {
          filter: { import_identity: item.importIdentity },
          update: {
            $setOnInsert: {
              occurrence_id: `QH-${item.importIdentity.slice(0, 20)}`,
              defect_code: item.canonicalDefectCode,
              catalogue_id: ids.get(item.canonicalDefectCode) as Types.ObjectId,
              process: item.process,
              occurrence_date: new Date(`${item.occurrenceDate}T00:00:00.000Z`),
              date_precision: QualityDatePrecision.DATE,
              quantity_affected: item.quantityAffected,
              source: QualityDefectSource.HISTORICAL_IMPORT,
              status: QualityDefectStatus.HISTORICAL,
              source_file: plan.sourceWorkbook,
              source_sheet: item.sourceSheet,
              source_row: item.sourceRow,
              source_cell: item.sourceCell,
              source_defect_code: item.sourceDefectCode,
              source_year: item.sourceYear,
              import_identity: item.importIdentity,
            },
          },
          upsert: true,
        },
      }));
    if (occurrenceWrites.length)
      await this.occurrenceModel.bulkWrite(occurrenceWrites);
    const after = await this.previewExisting(plan);
    return {
      catalogueInserted: after.catalogueExisting - existing.catalogueExisting,
      catalogueSkipped: existing.catalogueExisting,
      occurrenceInserted:
        after.occurrenceExisting - existing.occurrenceExisting,
      occurrenceSkipped: existing.occurrenceExisting,
      affectedQuantity: plan.affectedQuantity,
    };
  }
}
