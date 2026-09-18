import { QualityController } from './quality.controller';
import { QualityProductMttrService } from './quality-product-mttr.service';
import { QualityQueryService } from './quality-query.service';
import { QualityManualProductMttrService } from './quality-manual-product-mttr.service';

describe('QualityController', () => {
  let controller: QualityController;
  let query: {
    catalogue: jest.Mock;
    catalogueCode: jest.Mock;
    defects: jest.Mock;
    defect: jest.Mock;
  };
  let productMttr: {
    getYear: jest.Mock;
    upsertMonth: jest.Mock;
  };
  let manualProductMttr: {
    getYear: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(() => {
    query = {
      catalogue: jest.fn().mockResolvedValue([]),
      catalogueCode: jest.fn().mockResolvedValue(null),
      defects: jest.fn().mockResolvedValue([]),
      defect: jest.fn().mockResolvedValue(null),
    };
    productMttr = {
      getYear: jest.fn().mockResolvedValue({}),
      upsertMonth: jest.fn().mockResolvedValue({}),
    };
    manualProductMttr = {
      getYear: jest.fn().mockResolvedValue({}),
      save: jest.fn().mockResolvedValue({}),
    };
    controller = new QualityController(
      query as any,
      productMttr as any,
      manualProductMttr as any,
    );
  });

  it('returns manual product mttr summary', async () => {
    const result = await controller.manualProductMttrSummary('2026');
    expect(manualProductMttr.getYear).toHaveBeenCalledWith('2026');
    expect(result).toBeDefined();
  });

  it('saves manual product mttr', async () => {
    const body = { year: 2026, month: 1, entries: [] };
    const result = await controller.saveManualProductMttr(body, {
      user: { userId: 'user-1' },
    } as any);
    expect(manualProductMttr.save).toHaveBeenCalledWith(body, 'user-1');
    expect(result).toBeDefined();
  });

  it('returns product mttr summary', async () => {
    const result = await controller.productMttrSummary('2026');
    expect(productMttr.getYear).toHaveBeenCalledWith('2026');
    expect(result).toBeDefined();
  });

  it('upserts product mttr month', async () => {
    const body = { resolvedDefects: 0, totalResolutionMinutes: 0 };
    const result = await controller.upsertProductMttrMonth('2026', '1', body, {
      user: { userId: 'user-1' },
    } as any);
    expect(productMttr.upsertMonth).toHaveBeenCalledWith(
      '2026',
      '1',
      body,
      'user-1',
    );
    expect(result).toBeDefined();
  });

  it('returns defect catalogue', async () => {
    const result = await controller.catalogue('1', '10', 'process-1');
    expect(query.catalogue).toHaveBeenCalledWith('1', '10', 'process-1');
    expect(result).toBeDefined();
  });

  it('returns defect catalogue by code', async () => {
    const result = await controller.catalogueCode('DEF-001');
    expect(query.catalogueCode).toHaveBeenCalledWith('DEF-001');
    expect(result).toBeDefined();
  });

  it('returns defects list', async () => {
    const result = await controller.defects(
      '1',
      '10',
      '2026',
      '1',
      'process-1',
      'DEF-001',
      'manual',
    );
    expect(query.defects).toHaveBeenCalledWith({
      page: '1',
      limit: '10',
      year: '2026',
      month: '1',
      process: 'process-1',
      defectCode: 'DEF-001',
      source: 'manual',
    });
    expect(result).toBeDefined();
  });

  it('returns single defect', async () => {
    const result = await controller.defect('defect-1');
    expect(query.defect).toHaveBeenCalledWith('defect-1');
    expect(result).toBeDefined();
  });
});
