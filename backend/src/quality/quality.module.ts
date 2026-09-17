import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductDefectCatalogue,
  ProductDefectCatalogueSchema,
} from '../schemas/product-defect-catalogue.schema';
import {
  QualityDefectOccurrence,
  QualityDefectOccurrenceSchema,
} from '../schemas/quality-defect-occurrence.schema';
import { QualityController } from './quality.controller';
import { QualityQueryService } from './quality-query.service';
import { QualityImportService } from './quality-import.service';
import { QualityProductMttrService } from './quality-product-mttr.service';
import {
  ProductQualityMonthlyMttr,
  ProductQualityMonthlyMttrSchema,
} from '../schemas/product-quality-monthly-mttr.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import {
  ProductQualityMttrEntry,
  ProductQualityMttrEntrySchema,
} from '../schemas/product-quality-mttr-entry.schema';
import { QualityManualProductMttrService } from './quality-manual-product-mttr.service';
import {
  ProductQualityMonthlyDefects,
  ProductQualityMonthlyDefectsSchema,
} from '../schemas/product-quality-monthly-defects.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ProductDefectCatalogue.name,
        schema: ProductDefectCatalogueSchema,
      },
      {
        name: QualityDefectOccurrence.name,
        schema: QualityDefectOccurrenceSchema,
      },
      {
        name: ProductQualityMonthlyMttr.name,
        schema: ProductQualityMonthlyMttrSchema,
      },
      {
        name: ProductQualityMttrEntry.name,
        schema: ProductQualityMttrEntrySchema,
      },
      {
        name: ProductQualityMonthlyDefects.name,
        schema: ProductQualityMonthlyDefectsSchema,
      },
      { name: MachineType.name, schema: MachineTypeSchema },
    ]),
  ],
  controllers: [QualityController],
  providers: [
    QualityQueryService,
    QualityImportService,
    QualityProductMttrService,
    QualityManualProductMttrService,
  ],
})
export class QualityModule {}
