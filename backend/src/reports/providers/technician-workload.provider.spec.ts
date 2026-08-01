import { Types } from 'mongoose';
import { TechnicianWorkloadReportProvider } from './technician-workload.provider';

describe('TechnicianWorkloadReportProvider', () => {
  function buildProvider(currentWorkload: unknown[], closedRows: unknown[]) {
    const workOrderModel = {
      aggregate: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(closedRows) }),
    };
    const kpiService = {
      computeWorkload: jest.fn().mockResolvedValue(currentWorkload),
    };
    const provider = new TechnicianWorkloadReportProvider(
      workOrderModel as never,
      kpiService as never,
    );
    return { provider, kpiService, workOrderModel };
  }

  it('combines the current open-order snapshot from KpiService.computeWorkload with closed-in-period counts', async () => {
    const techId = new Types.ObjectId();
    const { provider, kpiService } = buildProvider(
      [{ technicianId: techId.toString(), name: 'Jane Tech', openCount: 4 }],
      [{ _id: techId, closedCount: 7 }],
    );

    const dataset = await provider.buildDataset({});

    expect(kpiService.computeWorkload).toHaveBeenCalled();
    expect(dataset.rows).toEqual([
      expect.objectContaining({
        technician: 'Jane Tech',
        open_work_orders: 4,
        closed_in_period: 7,
      }),
    ]);
  });

  it('includes technicians who only appear in the closed-in-period aggregate (no current open orders)', async () => {
    const techId = new Types.ObjectId();
    const { provider } = buildProvider([], [{ _id: techId, closedCount: 3 }]);

    const dataset = await provider.buildDataset({});

    expect(dataset.rows).toEqual([
      expect.objectContaining({
        technician: techId.toString(),
        open_work_orders: 0,
        closed_in_period: 3,
      }),
    ]);
  });

  it('sorts rows by currently-open descending', async () => {
    const t1 = new Types.ObjectId();
    const t2 = new Types.ObjectId();
    const { provider } = buildProvider(
      [
        { technicianId: t1.toString(), name: 'Low', openCount: 1 },
        { technicianId: t2.toString(), name: 'High', openCount: 9 },
      ],
      [],
    );

    const dataset = await provider.buildDataset({});
    expect(dataset.rows.map((r) => r.technician)).toEqual(['High', 'Low']);
  });

  it('scopes closed-order aggregation to a date range when given', async () => {
    const { provider, workOrderModel } = buildProvider([], []);
    const dateFrom = new Date('2026-01-01');
    const dateTo = new Date('2026-02-01');

    await provider.buildDataset({ dateFrom, dateTo });

    const [pipeline] = workOrderModel.aggregate.mock.calls[0];
    expect(pipeline[0].$match.date_created).toEqual({
      $gte: dateFrom,
      $lt: dateTo,
    });
  });
});
