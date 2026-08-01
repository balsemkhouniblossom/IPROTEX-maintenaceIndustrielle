import { Types } from 'mongoose';
import { FeatureExtractionService } from './feature-extraction.service';
import { FaultEventSeverity } from '../schemas/fault-event.schema';
import { FEATURE_NAMES } from './prediction-model.interface';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

function findStub(result: unknown) {
  return jest.fn().mockReturnValue(execResolves(result));
}

function findSortStub(result: unknown) {
  return jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  });
}

describe('FeatureExtractionService', () => {
  const machineId = new Types.ObjectId().toString();
  const asOfDate = new Date('2026-07-01T00:00:00.000Z');

  function buildService(
    overrides: {
      telemetry?: unknown[];
      activeAlarms?: unknown[];
      recentFaultCount?: number;
      correctiveCount?: number;
      preventiveCount?: number;
      overdueCount?: number;
      moduleIds?: unknown[];
      activePlanCount?: number;
      workOrderIds?: unknown[];
      interventionReports?: unknown[];
    } = {},
  ) {
    const telemetryModel = { find: findStub(overrides.telemetry ?? []) };

    const faultEventModel = {
      find: findStub(overrides.activeAlarms ?? []),
      countDocuments: jest
        .fn()
        .mockReturnValue(execResolves(overrides.recentFaultCount ?? 0)),
    };

    const workOrderModel = {
      countDocuments: jest
        .fn()
        .mockImplementation((filter: Record<string, unknown>) => {
          if (filter.status === 'overdue')
            return execResolves(overrides.overdueCount ?? 0);
          if (filter.type_maintenance === 'corrective')
            return execResolves(overrides.correctiveCount ?? 0);
          if (filter.type_maintenance === 'preventive')
            return execResolves(overrides.preventiveCount ?? 0);
          return execResolves(0);
        }),
      distinct: jest
        .fn()
        .mockReturnValue(execResolves(overrides.workOrderIds ?? [])),
    };

    const interventionReportModel = {
      find: findSortStub(overrides.interventionReports ?? []),
    };
    const moduleModel = {
      distinct: jest
        .fn()
        .mockReturnValue(execResolves(overrides.moduleIds ?? [])),
    };
    const maintenancePlanModel = {
      countDocuments: jest
        .fn()
        .mockReturnValue(execResolves(overrides.activePlanCount ?? 0)),
    };

    return new FeatureExtractionService(
      telemetryModel as never,
      faultEventModel as never,
      workOrderModel as never,
      interventionReportModel as never,
      moduleModel as never,
      maintenancePlanModel as never,
    );
  }

  it('returns a feature vector matching FEATURE_NAMES length, all zero except the "no recent intervention" sentinel when there is no data', async () => {
    const service = buildService();
    const result = await service.buildFeatureVector(machineId, asOfDate);

    expect(result.features).toHaveLength(FEATURE_NAMES.length);
    const daysSinceIndex = FEATURE_NAMES.indexOf(
      'days_since_last_intervention',
    );
    result.features.forEach((value, index) => {
      if (index === daysSinceIndex) {
        // 365 is the deliberate "no completed intervention on record" sentinel — distinct
        // from 0, which would wrongly claim an intervention happened today.
        expect(value).toBe(365);
      } else {
        expect(value).toBe(0);
      }
    });
  });

  it('marks isEmpty true when literally no data exists for the machine', async () => {
    const service = buildService();
    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(result.isEmpty).toBe(true);
  });

  it('marks isEmpty false as soon as any one data source has activity, even if every other source is empty', async () => {
    const service = buildService({
      telemetry: [{ metrics: { temperature: 70 } }],
    });
    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(result.isEmpty).toBe(false);
  });

  it('counts telemetry samples and distinct metric keys within the telemetry window', async () => {
    const service = buildService({
      telemetry: [
        { metrics: { temperature: 70, vibration: 0.1 } },
        { metrics: { temperature: 72, vibration: 0.2 } },
        { metrics: { temperature: 100 } },
      ],
    });

    const result = await service.buildFeatureVector(machineId, asOfDate);
    const sampleCount =
      result.features[FEATURE_NAMES.indexOf('telemetry_sample_count')];
    const keyCount =
      result.features[FEATURE_NAMES.indexOf('telemetry_metric_key_count')];

    expect(sampleCount).toBe(3);
    expect(keyCount).toBe(2);
  });

  it('computes a high max z-score when one telemetry reading is a wild outlier within its own metric key', async () => {
    const service = buildService({
      telemetry: [
        { metrics: { temperature: 70 } },
        { metrics: { temperature: 71 } },
        { metrics: { temperature: 72 } },
        { metrics: { temperature: 5000 } },
      ],
    });

    const result = await service.buildFeatureVector(machineId, asOfDate);
    const maxZScore =
      result.features[FEATURE_NAMES.indexOf('telemetry_max_zscore')];
    expect(maxZScore).toBeGreaterThan(1);
  });

  it('counts active alarms and separates critical ones', async () => {
    const service = buildService({
      activeAlarms: [
        { severity: FaultEventSeverity.WARNING },
        { severity: FaultEventSeverity.CRITICAL },
        { severity: FaultEventSeverity.CRITICAL },
      ],
      recentFaultCount: 5,
    });

    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(result.features[FEATURE_NAMES.indexOf('active_alarm_count')]).toBe(
      3,
    );
    expect(result.features[FEATURE_NAMES.indexOf('critical_alarm_count')]).toBe(
      2,
    );
    expect(
      result.features[FEATURE_NAMES.indexOf('recent_fault_event_count')],
    ).toBe(5);
  });

  it('reports corrective/preventive/overdue work order counts independently', async () => {
    const service = buildService({
      correctiveCount: 4,
      preventiveCount: 2,
      overdueCount: 1,
    });

    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(
      result.features[FEATURE_NAMES.indexOf('corrective_work_order_count')],
    ).toBe(4);
    expect(
      result.features[FEATURE_NAMES.indexOf('preventive_work_order_count')],
    ).toBe(2);
    expect(
      result.features[FEATURE_NAMES.indexOf('overdue_work_order_count')],
    ).toBe(1);
  });

  it('reports zero active maintenance plans when the machine has no modules', async () => {
    const service = buildService({ moduleIds: [] });
    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(
      result.features[FEATURE_NAMES.indexOf('active_maintenance_plan_count')],
    ).toBe(0);
  });

  it('reports the configured active maintenance plan count when the machine has modules', async () => {
    const service = buildService({
      moduleIds: [new Types.ObjectId()],
      activePlanCount: 3,
    });
    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(
      result.features[FEATURE_NAMES.indexOf('active_maintenance_plan_count')],
    ).toBe(3);
  });

  it('uses the sentinel "no recent intervention" value when there are no completed reports', async () => {
    const service = buildService({
      workOrderIds: [new Types.ObjectId()],
      interventionReports: [],
    });
    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(
      result.features[FEATURE_NAMES.indexOf('days_since_last_intervention')],
    ).toBe(365);
    expect(
      result.measuredFacts.some((f) => f.includes('No completed intervention')),
    ).toBe(true);
  });

  it('computes average resolution days and days since last intervention from reports', async () => {
    const service = buildService({
      workOrderIds: [new Types.ObjectId()],
      interventionReports: [
        {
          date_debut: new Date('2026-06-29T00:00:00.000Z'),
          date_fin: new Date('2026-06-30T00:00:00.000Z'),
        },
      ],
    });

    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(
      result.features[FEATURE_NAMES.indexOf('avg_resolution_days')],
    ).toBeCloseTo(1, 5);
    expect(
      result.features[FEATURE_NAMES.indexOf('days_since_last_intervention')],
    ).toBeCloseTo(1, 5);
  });

  it('always returns exactly seven measured-fact sentences', async () => {
    const service = buildService();
    const result = await service.buildFeatureVector(machineId, asOfDate);
    expect(result.measuredFacts).toHaveLength(7);
  });
});
