import { Types } from 'mongoose';
import { WorkOrderKpiService } from './work-order-kpi.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function findChain<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('WorkOrderKpiService.updateKpiForMachine', () => {
  const machineId = new Types.ObjectId();

  let workOrderModel: { find: jest.Mock };
  let kpiModel: {
    findOne: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    create: jest.Mock;
  };
  let counterService: { getNextSequence: jest.Mock };
  let service: WorkOrderKpiService;

  function order(overrides: Record<string, unknown> = {}) {
    return {
      machine_id: machineId,
      status: 'completed',
      type_maintenance: 'corrective',
      date_created: new Date('2026-01-01T00:00:00.000Z'),
      date_start: new Date('2026-01-01T00:00:00.000Z'),
      date_end: new Date('2026-01-01T02:00:00.000Z'),
      date_closed: new Date('2026-01-01T02:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    workOrderModel = { find: jest.fn().mockReturnValue(findChain([])) };
    kpiModel = {
      findOne: jest.fn().mockReturnValue(findChain(null)),
      findByIdAndUpdate: jest.fn().mockReturnValue(execResult(null)),
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };
    counterService = { getNextSequence: jest.fn().mockResolvedValue(7) };

    service = new WorkOrderKpiService(
      workOrderModel as never,
      kpiModel as never,
      counterService as never,
    );
  });

  it('is a no-op when no machineId is supplied', async () => {
    await service.updateKpiForMachine(undefined);

    expect(workOrderModel.find).not.toHaveBeenCalled();
  });

  it('is a no-op when the machine has no work order history at all', async () => {
    workOrderModel.find.mockReturnValue(findChain([]));

    await service.updateKpiForMachine(machineId.toHexString());

    expect(kpiModel.create).not.toHaveBeenCalled();
    expect(kpiModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('creates a new KPI record with a generated kpi_id when none exists yet', async () => {
    workOrderModel.find.mockReturnValue(findChain([order()]));

    await service.updateKpiForMachine(machineId.toHexString());

    expect(counterService.getNextSequence).toHaveBeenCalledWith('kpi');
    expect(kpiModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kpi_id: 'KPI-000007',
        machine_id: machineId,
      }),
    );
    expect(kpiModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('reuses the existing kpi_id and updates in place instead of creating a duplicate record', async () => {
    const existing = {
      _id: new Types.ObjectId(),
      kpi_id: 'KPI-000001',
    };
    kpiModel.findOne.mockReturnValue(findChain(existing));
    workOrderModel.find.mockReturnValue(findChain([order()]));

    await service.updateKpiForMachine(machineId.toHexString());

    expect(counterService.getNextSequence).not.toHaveBeenCalled();
    expect(kpiModel.create).not.toHaveBeenCalled();
    expect(kpiModel.findByIdAndUpdate).toHaveBeenCalledWith(
      existing._id,
      expect.objectContaining({ kpi_id: 'KPI-000001' }),
    );
  });

  it('computes MTTR as the average repair duration in hours across completed orders', async () => {
    workOrderModel.find.mockReturnValue(
      findChain([
        order({
          date_start: new Date('2026-01-01T00:00:00.000Z'),
          date_end: new Date('2026-01-01T02:00:00.000Z'),
        }),
        order({
          date_start: new Date('2026-01-02T00:00:00.000Z'),
          date_end: new Date('2026-01-02T04:00:00.000Z'),
        }),
      ]),
    );

    await service.updateKpiForMachine(machineId.toHexString());

    expect(kpiModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ mttr_value: 3 }),
    );
  });

  it('computes MTBF from the gaps between corrective closure dates, requiring at least two closures', async () => {
    workOrderModel.find.mockReturnValue(
      findChain([
        order({
          type_maintenance: 'corrective',
          date_closed: new Date('2026-01-01T00:00:00.000Z'),
        }),
        order({
          type_maintenance: 'corrective',
          date_closed: new Date('2026-01-03T00:00:00.000Z'),
        }),
      ]),
    );

    await service.updateKpiForMachine(machineId.toHexString());

    expect(kpiModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ mtbf_value: 48 }),
    );
  });

  it('defaults MTBF to 0 with a single corrective closure (no gap to measure)', async () => {
    workOrderModel.find.mockReturnValue(
      findChain([order({ type_maintenance: 'corrective' })]),
    );

    await service.updateKpiForMachine(machineId.toHexString());

    expect(kpiModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ mtbf_value: 0 }),
    );
  });

  it('counts completed preventive and corrective orders separately', async () => {
    workOrderModel.find.mockReturnValue(
      findChain([
        order({ type_maintenance: 'corrective' }),
        order({ type_maintenance: 'preventive' }),
        order({ type_maintenance: 'preventive' }),
      ]),
    );

    await service.updateKpiForMachine(machineId.toHexString());

    expect(kpiModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        completed_corrective: 1,
        completed_preventive: 2,
      }),
    );
  });

  it('counts an order overdue only when not completed, not waiting_validation, and past its due date', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 86400000);
    workOrderModel.find.mockReturnValue(
      findChain([
        order({
          status: 'in_progress',
          due_date: past,
          date_end: undefined,
          date_closed: undefined,
        }),
        order({
          status: 'waiting_validation',
          due_date: past,
          date_end: undefined,
          date_closed: undefined,
        }),
      ]),
    );

    await service.updateKpiForMachine(machineId.toHexString());

    expect(kpiModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ overdue_rate: 50 }),
    );
  });

  it('produces identical figures on a repeated invocation against the same unchanged history (deterministic)', async () => {
    const orders = [order()];
    workOrderModel.find.mockReturnValue(findChain(orders));

    await service.updateKpiForMachine(machineId.toHexString());
    const firstPayload = kpiModel.create.mock.calls[0][0];

    kpiModel.create.mockClear();
    await service.updateKpiForMachine(machineId.toHexString());
    const secondPayload = kpiModel.create.mock.calls[0][0];

    expect(secondPayload.mtbf_value).toBe(firstPayload.mtbf_value);
    expect(secondPayload.mttr_value).toBe(firstPayload.mttr_value);
    expect(secondPayload.availability_rate).toBe(
      firstPayload.availability_rate,
    );
  });
});
