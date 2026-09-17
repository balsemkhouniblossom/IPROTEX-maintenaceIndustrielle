import mongoose from 'mongoose';
import {
  prepareQualityImport,
  QualityImportService,
} from '../src/quality/quality-import.service';
import {
  ProductDefectCatalogue,
  ProductDefectCatalogueSchema,
} from '../src/schemas/product-defect-catalogue.schema';
import {
  QualityDefectOccurrence,
  QualityDefectOccurrenceSchema,
} from '../src/schemas/quality-defect-occurrence.schema';

const catalogueFile =
  process.env.IPROFLEX_CATALOGUE_FILE ??
  'C:/Users/Balsem/Downloads/FM_7_5-19_iproFlex_Defect_Catalogue_EN.docx';
const workbookFile =
  process.env.IPROFLEX_DEFECT_WORKBOOK ??
  'C:/Users/Balsem/Downloads/Reporting de Défauts internes  iproflex 2025.xlsx';

function safeTarget(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    const isolatedTarget =
      process.env.NODE_ENV === 'test' &&
      parsed.protocol === 'mongodb:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) &&
      parsed.pathname === '/iproflex_quality_point3_test';
    const explicitlyApprovedAtlasTarget =
      process.env.ALLOW_ATLAS_QUALITY_IMPORT === 'true' &&
      parsed.hostname.endsWith('mongodb.net') &&
      parsed.pathname.replace(/\/$/, '') === '/GMAO_IPROTEX';
    return isolatedTarget || explicitlyApprovedAtlasTarget;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const plan = await prepareQualityImport(catalogueFile, workbookFile);
  console.log('IPROTEX quality source preflight');
  console.log(
    `Catalogue: ${catalogueFile} (${plan.catalogueCount} definitions)`,
  );
  console.log(
    `Workbook: ${workbookFile} (${plan.occurrenceRecordCount} source cells; affected quantity ${plan.affectedQuantity})`,
  );
  console.log(`Unmapped codes: ${plan.unmatchedCodes.join(', ') || 'none'}`);
  console.log(`Warnings: ${JSON.stringify(plan.warnings)}`);
  console.log(`Errors: ${JSON.stringify(plan.errors)}`);
  if (plan.errors.length) {
    process.exitCode = 2;
    return;
  }
  if (!process.argv.includes('--apply')) {
    console.log('DRY RUN: no database connection or writes');
    return;
  }
  const uri = process.env.IPROFLEX_QUALITY_TEST_MONGO_URI ?? '';
  console.log(
    `Target database: ${uri ? new URL(uri).pathname.slice(1) : '(not configured)'}`,
  );
  if (!safeTarget(uri))
    throw new Error(
      'Apply requires the isolated test URI or explicit Atlas approval (ALLOW_ATLAS_QUALITY_IMPORT=true)',
    );
  const connection = await mongoose
    .createConnection(uri, { autoIndex: true })
    .asPromise();
  try {
    const catalogueModel = connection.model(
      ProductDefectCatalogue.name,
      ProductDefectCatalogueSchema,
    );
    const occurrenceModel = connection.model(
      QualityDefectOccurrence.name,
      QualityDefectOccurrenceSchema,
    );
    await Promise.all([catalogueModel.init(), occurrenceModel.init()]);
    const importer = new QualityImportService(catalogueModel, occurrenceModel);
    const before = await importer.previewExisting(plan);
    console.log(
      `Before apply: catalogue existing=${before.catalogueExisting}; occurrence existing=${before.occurrenceExisting}; conflicts=${before.conflicts.join(', ') || 'none'}`,
    );
    console.log(
      `Planned operations: catalogue insert=${plan.catalogueCount - before.catalogueExisting}, update=0, skip=${before.catalogueExisting}; historical insert=${plan.occurrenceRecordCount - before.occurrenceExisting}, skip=${before.occurrenceExisting}`,
    );
    if (before.conflicts.length)
      throw new Error('Catalogue conflict; no writes performed');
    console.log('Apply result:', await importer.apply(plan));
  } finally {
    await connection.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
