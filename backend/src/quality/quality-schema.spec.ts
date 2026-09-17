import { ProductDefectCatalogueSchema } from '../schemas/product-defect-catalogue.schema';
import {
  QualityDefectOccurrenceSchema,
  QualityDefectSource,
} from '../schemas/quality-defect-occurrence.schema';

describe('quality domain schema constraints', () => {
  it('uniquely identifies catalogue definitions by business code and import identity', () => {
    const indexes = ProductDefectCatalogueSchema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [{ defect_code: 1 }, expect.objectContaining({ unique: true })],
        [{ import_identity: 1 }, expect.objectContaining({ unique: true })],
      ]),
    );
    expect(ProductDefectCatalogueSchema.path('defect_name')).toBeDefined();
    expect(ProductDefectCatalogueSchema.path('resolved_at')).toBeUndefined();
  });

  it('makes historical identities unique without making them mandatory for future application events', () => {
    const index = QualityDefectOccurrenceSchema.indexes().find(
      ([keys]) => keys.import_identity === 1,
    );
    expect(index?.[1]).toEqual(
      expect.objectContaining({
        unique: true,
        partialFilterExpression: {
          source: QualityDefectSource.HISTORICAL_IMPORT,
        },
      }),
    );
    expect(QualityDefectOccurrenceSchema.path('date_precision')).toBeDefined();
    expect(
      QualityDefectOccurrenceSchema.path('quantity_affected'),
    ).toBeDefined();
    expect(
      QualityDefectOccurrenceSchema.path('resolution_duration'),
    ).toBeUndefined();
  });
});
