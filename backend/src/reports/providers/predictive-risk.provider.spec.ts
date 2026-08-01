import { Types } from 'mongoose';
import { PredictiveRiskReportProvider } from './predictive-risk.provider';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('PredictiveRiskReportProvider', () => {
  const actor = { userId: new Types.ObjectId().toString(), role: 'admin' };

  function buildProvider(summaries: unknown[], machines: unknown[]) {
    const machineModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue(execResolves(machines)),
      }),
    };
    const predictiveMaintenanceService = {
      getFleetSummary: jest.fn().mockResolvedValue(summaries),
    };
    const provider = new PredictiveRiskReportProvider(
      machineModel as never,
      predictiveMaintenanceService as never,
    );
    return { provider, predictiveMaintenanceService };
  }

  it('reuses PredictiveMaintenanceService.getFleetSummary verbatim and joins machine labels', async () => {
    const machineId = new Types.ObjectId().toString();
    const { provider, predictiveMaintenanceService } = buildProvider(
      [
        {
          machineId,
          healthScore: 42.34,
          riskLevel: 'high',
          confidence: 0.876,
          modelCount: 2,
          generatedAt: new Date('2026-06-01T00:00:00Z'),
        },
      ],
      [{ _id: machineId, machine_id: 'M-1', reference: 'Press' }],
    );

    const dataset = await provider.buildDataset({}, actor);

    expect(predictiveMaintenanceService.getFleetSummary).toHaveBeenCalledWith(
      actor,
    );
    expect(dataset.rows).toEqual([
      expect.objectContaining({
        machine: 'M-1 (Press)',
        health_score: 42.3,
        risk_level: 'high',
        confidence_percent: 88,
        model_count: 2,
      }),
    ]);
  });

  it('filters to a single machine when machineId is given', async () => {
    const keepId = new Types.ObjectId().toString();
    const dropId = new Types.ObjectId().toString();
    const { provider } = buildProvider(
      [
        {
          machineId: keepId,
          healthScore: 90,
          riskLevel: 'low',
          confidence: 1,
          modelCount: 1,
          generatedAt: null,
        },
        {
          machineId: dropId,
          healthScore: 10,
          riskLevel: 'critical',
          confidence: 1,
          modelCount: 1,
          generatedAt: null,
        },
      ],
      [{ _id: keepId, machine_id: 'M-1' }],
    );

    const dataset = await provider.buildDataset({ machineId: keepId }, actor);

    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0].machine).toBe('M-1');
  });

  it('sorts rows by ascending health score (worst-first) and counts critical/high risk machines', async () => {
    const id1 = new Types.ObjectId().toString();
    const id2 = new Types.ObjectId().toString();
    const { provider } = buildProvider(
      [
        {
          machineId: id1,
          healthScore: 95,
          riskLevel: 'low',
          confidence: 1,
          modelCount: 1,
          generatedAt: null,
        },
        {
          machineId: id2,
          healthScore: 15,
          riskLevel: 'critical',
          confidence: 1,
          modelCount: 1,
          generatedAt: null,
        },
      ],
      [
        { _id: id1, machine_id: 'M-1' },
        { _id: id2, machine_id: 'M-2' },
      ],
    );

    const dataset = await provider.buildDataset({}, actor);

    expect(dataset.rows.map((r) => r.machine)).toEqual(['M-2', 'M-1']);
    expect(dataset.summary).toEqual([
      { label: 'Machines covered', value: 2 },
      { label: 'Critical/High risk machines', value: 1 },
    ]);
  });
});
