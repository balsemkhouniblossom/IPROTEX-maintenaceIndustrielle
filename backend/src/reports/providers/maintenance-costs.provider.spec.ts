import { Types } from 'mongoose';
import { MaintenanceCostsReportProvider } from './maintenance-costs.provider';
import { StockMovementType } from '../../schemas/stock-movement.schema';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('MaintenanceCostsReportProvider', () => {
  function buildProvider(opts: {
    movements?: unknown[];
    parts?: unknown[];
    workOrders?: unknown[];
    machines?: unknown[];
  }) {
    const stockMovementModel = {
      find: jest.fn().mockReturnValue(execResolves(opts.movements ?? [])),
    };
    const catalogueModel = {
      find: jest.fn().mockReturnValue(execResolves(opts.parts ?? [])),
    };
    const workOrderModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(execResolves(opts.workOrders ?? [])),
      }),
    };
    const machineModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(execResolves(opts.machines ?? [])),
      }),
    };

    const provider = new MaintenanceCostsReportProvider(
      stockMovementModel as never,
      catalogueModel as never,
      workOrderModel as never,
      machineModel as never,
    );
    return { provider, stockMovementModel, workOrderModel };
  }

  it('returns an empty, zero-cost dataset when there is no consumption in range', async () => {
    const { provider } = buildProvider({ movements: [] });
    const dataset = await provider.buildDataset({});
    expect(dataset.rows).toEqual([]);
    expect(dataset.summary).toEqual([{ label: 'Total cost', value: 0 }]);
  });

  it('multiplies consumed quantity by Catalogue.unit_cost and attributes it to the work order machine', async () => {
    const partId = new Types.ObjectId();
    const workOrderId = new Types.ObjectId();
    const machineId = new Types.ObjectId();

    const { provider } = buildProvider({
      movements: [
        {
          type: StockMovementType.CONSUMPTION,
          part_id: partId,
          work_order_id: workOrderId,
          quantity_delta: -3,
        },
      ],
      parts: [{ _id: partId, unit_cost: 10 }],
      workOrders: [{ _id: workOrderId, machine_id: machineId }],
      machines: [{ _id: machineId, machine_id: 'M-1', reference: 'Press' }],
    });

    const dataset = await provider.buildDataset({});

    expect(dataset.rows).toEqual([
      expect.objectContaining({
        machine: 'M-1 (Press)',
        parts_consumed: 3,
        total_cost: 30,
      }),
    ]);
    expect(dataset.summary?.[0]).toEqual({ label: 'Total cost', value: 30 });
  });

  it('contributes 0 cost for parts with no unit_cost set and surfaces the gap in the summary', async () => {
    const partId = new Types.ObjectId();
    const workOrderId = new Types.ObjectId();
    const machineId = new Types.ObjectId();

    const { provider } = buildProvider({
      movements: [
        {
          type: StockMovementType.CONSUMPTION,
          part_id: partId,
          work_order_id: workOrderId,
          quantity_delta: -2,
        },
      ],
      parts: [{ _id: partId }], // no unit_cost
      workOrders: [{ _id: workOrderId, machine_id: machineId }],
      machines: [{ _id: machineId, machine_id: 'M-1' }],
    });

    const dataset = await provider.buildDataset({});

    expect(dataset.rows[0].total_cost).toBe(0);
    expect(dataset.summary).toEqual(
      expect.arrayContaining([
        { label: 'Parts consumed with no unit_cost set', value: 1 },
      ]),
    );
  });

  it('only queries consumption-type movements with a work order attached', async () => {
    const { provider, stockMovementModel } = buildProvider({ movements: [] });
    await provider.buildDataset({});
    const [filter] = stockMovementModel.find.mock.calls[0];
    expect(filter.type).toBe(StockMovementType.CONSUMPTION);
    expect(filter.work_order_id).toEqual({ $exists: true, $ne: null });
  });

  it('scopes the work order lookup to a single machine id when machineId is provided', async () => {
    const partId = new Types.ObjectId();
    const workOrderId = new Types.ObjectId();
    const machineId = new Types.ObjectId();

    const { provider, workOrderModel } = buildProvider({
      movements: [
        {
          type: StockMovementType.CONSUMPTION,
          part_id: partId,
          work_order_id: workOrderId,
          quantity_delta: -1,
        },
      ],
      parts: [{ _id: partId, unit_cost: 5 }],
      workOrders: [],
      machines: [],
    });

    await provider.buildDataset({ machineId: machineId.toString() });

    const [filter] = workOrderModel.find.mock.calls[0];
    expect(filter.machine_id).toEqual(machineId);
  });
});
