import { MttrCalculationService, RepairRecord } from './mttr-calculation.service';

describe('MttrCalculationService', () => {
  const service = new MttrCalculationService();

  function repair(
    id: string,
    workOrderId: string,
    start: Date,
    end: Date,
    overrides: Partial<RepairRecord> = {},
  ): RepairRecord {
    return {
      interventionReportId: id,
      workOrderId,
      dateDebut: start,
      dateFin: end,
      typeMaintenance: 'corrective',
      workOrderStatus: 'completed',
      ...overrides,
    };
  }

  it('calculates 90 + 120 + 60 minutes / 3 repairs = 90 minutes', () => {
    const repairs = [
      repair(
        'r1',
        'w1',
        new Date('2026-09-01T08:00:00Z'),
        new Date('2026-09-01T09:30:00Z'),
      ),
      repair(
        'r2',
        'w2',
        new Date('2026-09-02T08:00:00Z'),
        new Date('2026-09-02T10:00:00Z'),
      ),
      repair(
        'r3',
        'w3',
        new Date('2026-09-03T08:00:00Z'),
        new Date('2026-09-03T09:00:00Z'),
      ),
    ];

    expect(service.calculateMttrMinutes(repairs)).toBe(90);
  });

  it('includes completed corrective repairs and excludes every invalid class', () => {
    const preventive = repair(
      'preventive',
      'wp',
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-01T01:00:00Z'),
      { typeMaintenance: 'preventive' },
    );
    const cancelled = repair(
      'cancelled',
      'wc',
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-01T01:00:00Z'),
      { workOrderStatus: 'cancelled' },
    );
    const incomplete = repair(
      'incomplete',
      'wi',
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-01T01:00:00Z'),
      { workOrderStatus: 'in_progress' },
    );
    const missingEnd = repair(
      'missing-end',
      'wm',
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-01T01:00:00Z'),
      { dateFin: null },
    );
    const negative = repair(
      'negative',
      'wn',
      new Date('2026-09-01T01:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
    );
    const orphan = repair(
      'orphan',
      'missing-work-order',
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-01T01:00:00Z'),
      { workOrderMissing: true },
    );
    const valid = repair(
      'valid',
      'wv',
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-01T02:00:00Z'),
    );

    expect(
      [
        preventive,
        cancelled,
        incomplete,
        missingEnd,
        negative,
        orphan,
        valid,
      ]
        .map((item) => service.classifyExclusion(item))
        .filter(Boolean),
    ).toEqual([
      'nonCorrective',
      'cancelledIncomplete',
      'cancelledIncomplete',
      'missingStartEnd',
      'endBeforeStart',
      'missingUnresolvableWorkOrder',
    ]);
    expect(service.calculateMttrMinutes([valid])).toBe(120);
  });

  it('groups valid repairs by date_fin calendar month and leaves empty months undefined', () => {
    const repairs = [
      repair(
        'r1',
        'w1',
        new Date('2026-09-01T08:00:00Z'),
        new Date('2026-09-01T09:30:00Z'),
      ),
      repair(
        'r2',
        'w2',
        new Date('2026-09-02T08:00:00Z'),
        new Date('2026-09-02T10:00:00Z'),
      ),
      repair(
        'r3',
        'w3',
        new Date('2026-09-03T08:00:00Z'),
        new Date('2026-09-03T09:00:00Z'),
      ),
      repair(
        'r4',
        'w4',
        new Date('2026-10-01T08:00:00Z'),
        new Date('2026-10-01T10:00:00Z'),
      ),
    ];
    const exclusions = {
      missingStartEnd: 0,
      endBeforeStart: 0,
      nonCorrective: 0,
      cancelledIncomplete: 0,
      missingUnresolvableWorkOrder: 0,
    };

    const result = service.buildYearlyResult(2026, repairs, exclusions);

    expect(result.months).toHaveLength(12);
    expect(result.months[8]).toMatchObject({
      month: 9,
      sampleSize: 3,
      mttr: 90,
    });
    expect(
      result.months[8].detailRows.reduce(
        (sum, row) => sum + row.repairDurationMin,
        0,
      ),
    ).toBe(270);
    expect(result.months[1].sampleSize).toBe(0);
    expect(result.months[1].mttr).toBeNull();
    expect(result.summary).toEqual({
      totalRepairs: 4,
      overallMttr: 97.5,
      totalRepairMinutes: 390,
      totalExcluded: 0,
    });
  });
});
