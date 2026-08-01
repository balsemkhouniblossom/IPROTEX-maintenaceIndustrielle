import { StockMovementsReportProvider } from './stock-movements.provider';

describe('StockMovementsReportProvider', () => {
  function buildProvider(movements: unknown[]) {
    const stockMovementModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(movements),
      }),
    };
    const provider = new StockMovementsReportProvider(
      stockMovementModel as never,
    );
    return { provider, stockMovementModel };
  }

  it('joins each movement with its stock, part, actor, and work order', async () => {
    const { provider } = buildProvider([
      {
        createdAt: new Date('2026-01-01T00:00:00Z'),
        movement_id: 'MV-1',
        type: 'consumption',
        stock_id: { stock_id: 'ST-1' },
        part_id: { nom_piece: 'Filter', ref_constructeur: 'F-100' },
        actor_user_id: { nom_complet: 'Jane Tech' },
        work_order_id: { ot_id: 'OT-1' },
        quantity_delta: -2,
        reserved_delta: 0,
        quantite_en_stock_after: 8,
        reason: 'consumption for repair',
      },
    ]);

    const dataset = await provider.buildDataset({});

    expect(dataset.rows).toEqual([
      expect.objectContaining({
        movement: 'MV-1',
        type: 'consumption',
        stock: 'ST-1',
        part: 'Filter',
        actor: 'Jane Tech',
        work_order: 'OT-1',
        quantity_delta: -2,
        quantity_after: 8,
      }),
    ]);
    expect(dataset.summary).toEqual([{ label: 'Total movements', value: 1 }]);
  });

  it('applies a createdAt date-range filter when dateFrom/dateTo are given', async () => {
    const { provider, stockMovementModel } = buildProvider([]);
    const dateFrom = new Date('2026-01-01');
    const dateTo = new Date('2026-02-01');

    await provider.buildDataset({ dateFrom, dateTo });

    expect(stockMovementModel.find).toHaveBeenCalledWith({
      createdAt: { $gte: dateFrom, $lt: dateTo },
    });
  });

  it('falls back to a part reference when the part has no name', async () => {
    const { provider } = buildProvider([
      {
        createdAt: new Date(),
        movement_id: 'MV-2',
        type: 'reception',
        part_id: { ref_constructeur: 'F-200' },
        quantity_delta: 5,
        reserved_delta: 0,
        quantite_en_stock_after: 5,
      },
    ]);

    const dataset = await provider.buildDataset({});
    expect(dataset.rows[0].part).toBe('F-200');
  });
});
