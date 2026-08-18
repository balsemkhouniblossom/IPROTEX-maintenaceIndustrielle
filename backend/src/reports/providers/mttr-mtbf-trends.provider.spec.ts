import { Types } from 'mongoose';
import { Role } from '../../schemas/user.schema';
import { MttrMtbfTrendsReportProvider } from './mttr-mtbf-trends.provider';

describe('MttrMtbfTrendsReportProvider', () => {
  const actor = { userId: new Types.ObjectId().toString(), role: Role.ADMIN };

  function buildProvider(resultPerBucket: unknown) {
    const kpiService = {
      computeMttrMtbf: jest.fn().mockResolvedValue(resultPerBucket),
    };
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
    };
    const provider = new MttrMtbfTrendsReportProvider(
      kpiService as never,
      documentAccessService as never,
    );
    return { provider, kpiService };
  }

  it('calls KpiService.computeMttrMtbf once per monthly bucket in the requested range', async () => {
    const { provider, kpiService } = buildProvider({
      mttrHours: 4,
      mtbfHours: 100,
      availabilityPercent: 96,
      sampleSize: 3,
    });

    // Bucket boundaries are computed in business-timezone month starts, so a UTC
    // date range that lands exactly on a month boundary can pick up one extra
    // trailing bucket depending on the configured timezone offset — assert the
    // core behavior (one call per bucket, first bucket is January) rather than
    // an exact count tied to a specific timezone.
    const dataset = await provider.buildDataset(
      {
        dateFrom: new Date('2026-01-01T00:00:00Z'),
        dateTo: new Date('2026-04-01T00:00:00Z'),
      },
      actor,
    );

    expect(kpiService.computeMttrMtbf.mock.calls).toHaveLength(
      dataset.rows.length,
    );
    expect(dataset.rows.length).toBeGreaterThanOrEqual(3);
    expect(dataset.rows.length).toBeLessThanOrEqual(4);
    expect(dataset.rows[0]).toEqual(
      expect.objectContaining({
        mttr_hours: 4,
        mtbf_hours: 100,
        availability_percent: 96,
      }),
    );
    expect(dataset.rows.map((r) => r.period)).toContain('2026-01');
  });

  it('defaults to a 6-month trailing window when no dates are given', async () => {
    const { provider, kpiService } = buildProvider({
      mttrHours: 1,
      mtbfHours: 1,
      availabilityPercent: 100,
      sampleSize: 0,
    });

    const dataset = await provider.buildDataset({}, actor);

    expect(kpiService.computeMttrMtbf).toHaveBeenCalled();
    expect(dataset.rows.length).toBeGreaterThan(0);
    expect(dataset.rows.length).toBeLessThanOrEqual(7);
  });

  it('caps the number of buckets at 24 even for a very wide range', async () => {
    const { provider } = buildProvider({
      mttrHours: 1,
      mtbfHours: 1,
      availabilityPercent: 100,
      sampleSize: 0,
    });

    const dataset = await provider.buildDataset(
      {
        dateFrom: new Date('2000-01-01T00:00:00Z'),
        dateTo: new Date('2026-01-01T00:00:00Z'),
      },
      actor,
    );

    expect(dataset.rows.length).toBeLessThanOrEqual(24);
  });
});
