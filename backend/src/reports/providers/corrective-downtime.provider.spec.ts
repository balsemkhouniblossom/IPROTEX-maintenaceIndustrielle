import { Types } from 'mongoose';
import { CorrectiveDowntimeReportProvider } from './corrective-downtime.provider';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('CorrectiveDowntimeReportProvider', () => {
  const actor = { userId: new Types.ObjectId().toString(), role: 'admin' };

  function buildProvider(workOrders: unknown[]) {
    const workOrderModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(workOrders),
      }),
    };
    const machineModel = { find: jest.fn() };
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
    };

    const provider = new CorrectiveDowntimeReportProvider(
      workOrderModel as never,
      machineModel as never,
      documentAccessService as never,
    );
    return { provider, workOrderModel };
  }

  it('computes downtime in hours between start and end/closed dates', async () => {
    const { provider } = buildProvider([
      {
        ot_id: 'OT-1',
        code_panne: 'E-1',
        date_start: new Date('2026-01-01T00:00:00Z'),
        date_created: new Date('2026-01-01T00:00:00Z'),
        date_end: new Date('2026-01-01T05:00:00Z'),
        date_closed: null,
        machine_id: { machine_id: 'M-1', reference: 'Press' },
      },
    ]);

    const dataset = await provider.buildDataset({}, actor);

    expect(dataset.rows).toEqual([
      expect.objectContaining({
        work_order: 'OT-1',
        machine: 'M-1 (Press)',
        downtime_hours: 5,
      }),
    ]);
    expect(dataset.summary).toEqual([
      { label: 'Corrective events', value: 1 },
      { label: 'Total downtime (hours)', value: 5 },
      { label: 'Average downtime (hours)', value: 5 },
    ]);
  });

  it('falls back to date_created/date_closed when date_start/date_end are absent', async () => {
    const { provider } = buildProvider([
      {
        ot_id: 'OT-2',
        date_created: new Date('2026-01-01T00:00:00Z'),
        date_start: null,
        date_end: null,
        date_closed: new Date('2026-01-01T02:00:00Z'),
        machine_id: { machine_id: 'M-2' },
      },
    ]);

    const dataset = await provider.buildDataset({}, actor);
    expect(dataset.rows[0].downtime_hours).toBe(2);
  });

  it('skips work orders missing both start and end dates', async () => {
    const { provider } = buildProvider([
      {
        ot_id: 'OT-3',
        date_created: null,
        date_start: null,
        date_end: null,
        date_closed: null,
        machine_id: {},
      },
    ]);
    const dataset = await provider.buildDataset({}, actor);
    expect(dataset.rows).toEqual([]);
  });

  it('filters by corrective type and completed status via the Mongo query', async () => {
    const { provider, workOrderModel } = buildProvider([]);
    await provider.buildDataset({}, actor);
    const [filter] = workOrderModel.find.mock.calls[0];
    expect(filter.type_maintenance).toEqual({ $regex: /correct/i });
    expect(filter.status.$in).toBeDefined();
  });
});
