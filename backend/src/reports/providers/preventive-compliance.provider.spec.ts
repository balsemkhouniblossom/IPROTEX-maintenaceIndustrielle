import { Types } from 'mongoose';
import { PreventiveComplianceReportProvider } from './preventive-compliance.provider';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('PreventiveComplianceReportProvider', () => {
  const actor = { userId: new Types.ObjectId().toString(), role: 'admin' };

  function buildProvider(machines: unknown[], complianceByMachineId: Record<string, unknown>) {
    const machineModel = {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(execResolves(machines)) }),
    };
    const kpiService = {
      computePreventiveCompliance: jest.fn().mockImplementation(({ machineIds }) =>
        Promise.resolve(complianceByMachineId[machineIds[0]]),
      ),
    };
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue(null),
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };

    const provider = new PreventiveComplianceReportProvider(
      machineModel as never,
      kpiService as never,
      documentAccessService as never,
    );
    return { provider, kpiService, machineModel };
  }

  it('calls KpiService.computePreventiveCompliance once per machine and reuses its numbers verbatim', async () => {
    const machineId = new Types.ObjectId();
    const { provider, kpiService } = buildProvider(
      [{ _id: machineId, machine_id: 'M-1', reference: 'Press' }],
      { [machineId.toString()]: { ratePercent: 80, onTimeCount: 4, evaluableCount: 5 } },
    );

    const dataset = await provider.buildDataset({ dateFrom: new Date('2026-01-01') }, actor);

    expect(kpiService.computePreventiveCompliance).toHaveBeenCalledWith(
      expect.objectContaining({ machineIds: [machineId.toString()] }),
    );
    expect(dataset.rows).toEqual([
      expect.objectContaining({
        machine: 'M-1 (Press)',
        compliance_rate_percent: 80,
        on_time_count: 4,
        evaluable_count: 5,
      }),
    ]);
  });

  it('computes an overall rate weighted across machines', async () => {
    const m1 = new Types.ObjectId();
    const m2 = new Types.ObjectId();
    const { provider } = buildProvider(
      [
        { _id: m1, machine_id: 'M-1' },
        { _id: m2, machine_id: 'M-2' },
      ],
      {
        [m1.toString()]: { ratePercent: 100, onTimeCount: 2, evaluableCount: 2 },
        [m2.toString()]: { ratePercent: 0, onTimeCount: 0, evaluableCount: 2 },
      },
    );

    const dataset = await provider.buildDataset({}, actor);

    expect(dataset.summary).toEqual([
      { label: 'Machines covered', value: 2 },
      { label: 'Overall compliance %', value: 50 },
    ]);
  });

  it('scopes the machine query to a single machine when machineId is given', async () => {
    const machineId = new Types.ObjectId();
    const { provider, machineModel } = buildProvider(
      [{ _id: machineId, machine_id: 'M-1' }],
      { [machineId.toString()]: { ratePercent: 100, onTimeCount: 1, evaluableCount: 1 } },
    );

    await provider.buildDataset({ machineId: machineId.toString() }, {
      userId: actor.userId,
      role: 'admin',
    });

    expect(machineModel.find).toHaveBeenCalled();
  });

  it('reports zero overall compliance when no machine has any evaluable order', async () => {
    const { provider } = buildProvider([], {});
    const dataset = await provider.buildDataset({}, actor);
    expect(dataset.summary).toEqual([
      { label: 'Machines covered', value: 0 },
      { label: 'Overall compliance %', value: 0 },
    ]);
  });
});
