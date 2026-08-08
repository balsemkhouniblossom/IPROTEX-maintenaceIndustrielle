import { Types } from 'mongoose';
import { Role } from '../../schemas/user.schema';
import { FaultFrequencyReportProvider } from './fault-frequency.provider';

describe('FaultFrequencyReportProvider', () => {
  const actor = { userId: new Types.ObjectId().toString(), role: Role.ADMIN };

  function buildProvider(aggregateRows: unknown[]) {
    const faultEventModel = {
      aggregate: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(aggregateRows) }),
    };
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };
    const provider = new FaultFrequencyReportProvider(
      faultEventModel as never,
      documentAccessService as never,
    );
    return { provider, faultEventModel };
  }

  it('ranks fault codes by occurrence count, exposing critical occurrences and last-raised', async () => {
    const { provider } = buildProvider([
      {
        _id: 'E-1',
        count: 12,
        criticalCount: 3,
        lastRaisedAt: new Date('2026-06-01T00:00:00Z'),
      },
      {
        _id: 'E-2',
        count: 5,
        criticalCount: 0,
        lastRaisedAt: new Date('2026-05-01T00:00:00Z'),
      },
    ]);

    const dataset = await provider.buildDataset({}, actor);

    expect(dataset.rows).toEqual([
      expect.objectContaining({
        fault_code: 'E-1',
        occurrences: 12,
        critical_occurrences: 3,
      }),
      expect.objectContaining({
        fault_code: 'E-2',
        occurrences: 5,
        critical_occurrences: 0,
      }),
    ]);
    expect(dataset.summary).toEqual([
      { label: 'Distinct fault codes', value: 2 },
      { label: 'Total events', value: 17 },
    ]);
  });

  it('scopes the aggregation match stage by machine and date range', async () => {
    const { provider, faultEventModel } = buildProvider([]);
    const dateFrom = new Date('2026-01-01');
    const dateTo = new Date('2026-02-01');

    await provider.buildDataset(
      { machineId: new Types.ObjectId().toString(), dateFrom, dateTo },
      actor,
    );

    const [pipeline] = faultEventModel.aggregate.mock.calls[0];
    expect(pipeline[0].$match.machine_id).toBeDefined();
    expect(pipeline[0].$match.raised_at).toEqual({
      $gte: dateFrom,
      $lt: dateTo,
    });
  });

  it('returns an empty dataset when there are no fault events in scope', async () => {
    const { provider } = buildProvider([]);
    const dataset = await provider.buildDataset({}, actor);
    expect(dataset.rows).toEqual([]);
    expect(dataset.summary).toEqual([
      { label: 'Distinct fault codes', value: 0 },
      { label: 'Total events', value: 0 },
    ]);
  });
});
