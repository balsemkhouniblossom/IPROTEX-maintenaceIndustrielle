import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderCommandService } from './work-order-command.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('WorkOrderCommandService.create', () => {
  const machineId = new Types.ObjectId();
  const technicianId = new Types.ObjectId();

  let workOrderModel: jest.Mock & { findOne?: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let notificationService: { notifyCreated: jest.Mock };
  let reportService: { ensureAutoInterventionReport: jest.Mock };
  let preventiveSchedulingService: {
    assertNoDuplicatePreventiveOccurrence: jest.Mock;
    ensureNextPreventiveWorkOrder: jest.Mock;
  };
  let kpiService: { updateKpiForMachine: jest.Mock };
  let service: WorkOrderCommandService;
  let savedWorkOrder: Record<string, unknown>;

  beforeEach(() => {
    savedWorkOrder = {
      _id: new Types.ObjectId(),
      ot_id: 'WO-PREV-000001',
      status: 'scheduled',
      machine_id: machineId,
      technician_id: technicianId,
    };

    workOrderModel = jest.fn().mockImplementation(() => ({
      save: jest.fn().mockResolvedValue(savedWorkOrder),
    })) as never;

    counterService = { getNextSequence: jest.fn().mockResolvedValue(1) };
    notificationService = { notifyCreated: jest.fn().mockResolvedValue(null) };
    reportService = {
      ensureAutoInterventionReport: jest.fn().mockResolvedValue(undefined),
    };
    preventiveSchedulingService = {
      assertNoDuplicatePreventiveOccurrence: jest
        .fn()
        .mockResolvedValue(undefined),
      ensureNextPreventiveWorkOrder: jest.fn().mockResolvedValue(true),
    };
    kpiService = {
      updateKpiForMachine: jest.fn().mockResolvedValue(undefined),
    };

    service = new WorkOrderCommandService(
      workOrderModel as never,
      counterService as never,
      notificationService as never,
      reportService as never,
      preventiveSchedulingService as never,
      kpiService as never,
    );
  });

  it('notifies the assigned technician when a new, not-yet-completed work order is created', async () => {
    const result = await service.create({
      ot_id: 'WO-PREV-000001',
      machine_id: machineId.toString(),
      technician_id: technicianId.toString(),
      type_maintenance: 'preventive',
      status: 'scheduled',
    } as never);

    expect(notificationService.notifyCreated).toHaveBeenCalledWith(result);
    expect(reportService.ensureAutoInterventionReport).not.toHaveBeenCalled();
    expect(kpiService.updateKpiForMachine).not.toHaveBeenCalled();
  });

  it('backfills a report, triggers next-occurrence scheduling, and recomputes KPI instead of notifying when created already completed', async () => {
    savedWorkOrder.status = 'completed';

    await service.create({
      ot_id: 'WO-PREV-000001',
      machine_id: machineId.toString(),
      technician_id: technicianId.toString(),
      type_maintenance: 'preventive',
      status: 'completed',
    } as never);

    expect(reportService.ensureAutoInterventionReport).toHaveBeenCalledWith(
      savedWorkOrder,
    );
    expect(
      preventiveSchedulingService.ensureNextPreventiveWorkOrder,
    ).toHaveBeenCalledWith(savedWorkOrder);
    expect(kpiService.updateKpiForMachine).toHaveBeenCalledWith(
      machineId.toString(),
    );
    expect(notificationService.notifyCreated).not.toHaveBeenCalled();
  });

  it('generates an ot_id via the counter service when none is supplied', async () => {
    await service.create({
      machine_id: machineId.toString(),
      technician_id: technicianId.toString(),
      type_maintenance: 'corrective',
      status: 'scheduled',
    } as never);

    expect(counterService.getNextSequence).toHaveBeenCalledWith('work_order');
  });

  it('checks for a duplicate preventive occurrence before saving, and propagates rejection', async () => {
    preventiveSchedulingService.assertNoDuplicatePreventiveOccurrence.mockRejectedValue(
      new ConflictException('duplicate occurrence'),
    );

    await expect(
      service.create({
        machine_id: machineId.toString(),
        plan_id: new Types.ObjectId().toString(),
        type_maintenance: 'preventive',
        status: 'scheduled',
      } as never),
    ).rejects.toThrow(ConflictException);
    expect(workOrderModel).not.toHaveBeenCalled();
  });
});

describe('WorkOrderCommandService.update', () => {
  const machineId = new Types.ObjectId();

  let workOrderModel: { findByIdAndUpdate: jest.Mock };
  let reportService: { ensureAutoInterventionReport: jest.Mock };
  let preventiveSchedulingService: {
    assertNoDuplicatePreventiveOccurrence: jest.Mock;
    ensureNextPreventiveWorkOrder: jest.Mock;
  };
  let kpiService: { updateKpiForMachine: jest.Mock };
  let service: WorkOrderCommandService;

  beforeEach(() => {
    workOrderModel = {
      findByIdAndUpdate: jest.fn().mockReturnValue(execResult(null)),
    };
    reportService = {
      ensureAutoInterventionReport: jest.fn().mockResolvedValue(undefined),
    };
    preventiveSchedulingService = {
      assertNoDuplicatePreventiveOccurrence: jest
        .fn()
        .mockResolvedValue(undefined),
      ensureNextPreventiveWorkOrder: jest.fn().mockResolvedValue(true),
    };
    kpiService = {
      updateKpiForMachine: jest.fn().mockResolvedValue(undefined),
    };

    service = new WorkOrderCommandService(
      workOrderModel as never,
      {} as never,
      {} as never,
      reportService as never,
      preventiveSchedulingService as never,
      kpiService as never,
    );
  });

  it('returns the not-found result without any side effects', async () => {
    const result = await service.update(new Types.ObjectId().toHexString(), {
      description: 'edit',
    });

    expect(result).toBeNull();
    expect(reportService.ensureAutoInterventionReport).not.toHaveBeenCalled();
    expect(kpiService.updateKpiForMachine).not.toHaveBeenCalled();
  });

  it('backfills a report and recomputes KPI when the update lands the work order in a completed status', async () => {
    const updated = {
      _id: new Types.ObjectId(),
      status: 'validated',
      machine_id: machineId,
    };
    workOrderModel.findByIdAndUpdate.mockReturnValue(execResult(updated));

    const result = await service.update(updated._id.toHexString(), {
      status: 'validated',
    });

    expect(reportService.ensureAutoInterventionReport).toHaveBeenCalledWith(
      updated,
    );
    expect(
      preventiveSchedulingService.ensureNextPreventiveWorkOrder,
    ).toHaveBeenCalledWith(updated);
    expect(kpiService.updateKpiForMachine).toHaveBeenCalledWith(
      machineId.toString(),
    );
    expect(result).toBe(updated);
  });

  it('does not trigger report/preventive/KPI side effects for a non-completed update', async () => {
    const updated = {
      _id: new Types.ObjectId(),
      status: 'in_progress',
      machine_id: machineId,
    };
    workOrderModel.findByIdAndUpdate.mockReturnValue(execResult(updated));

    await service.update(updated._id.toHexString(), {
      status: 'in_progress',
    });

    expect(reportService.ensureAutoInterventionReport).not.toHaveBeenCalled();
    expect(kpiService.updateKpiForMachine).not.toHaveBeenCalled();
  });
});

describe('WorkOrderCommandService.remove', () => {
  it('delegates to a direct physical delete', async () => {
    const deleted = { _id: new Types.ObjectId() };
    const workOrderModel = {
      findByIdAndDelete: jest.fn().mockReturnValue(execResult(deleted)),
    };
    const service = new WorkOrderCommandService(
      workOrderModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.remove(deleted._id.toHexString());

    expect(workOrderModel.findByIdAndDelete).toHaveBeenCalledWith(
      deleted._id.toHexString(),
    );
    expect(result).toBe(deleted);
  });
});
