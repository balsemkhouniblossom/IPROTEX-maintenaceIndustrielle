import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderPreventiveSchedulingService } from './work-order-preventive-scheduling.service';
import { MaintenanceSchedulingService } from '../maintenance-scheduling.service';

function execResult<T>(value: T) {
  const chain = {
    session: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.session.mockReturnValue(chain);
  return chain;
}

describe('WorkOrderPreventiveSchedulingService.ensureNextPreventiveWorkOrder', () => {
  const planId = new Types.ObjectId();
  const machineId = new Types.ObjectId();
  const moduleId = new Types.ObjectId();
  const occurrenceId = new Types.ObjectId();

  function schedulableWorkOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: occurrenceId,
      type_maintenance: 'preventive',
      plan_id: planId,
      machine_id: machineId,
      module_id: moduleId,
      technician_id: new Types.ObjectId(),
      description: 'Preventive round',
      priorite: 'medium',
      execution_date: new Date('2026-06-01T08:00:00.000Z'),
      status: 'validated',
      ...overrides,
    };
  }

  let workOrderModel: {
    findOne: jest.Mock;
    create: jest.Mock;
    updateOne: jest.Mock;
  };
  let maintenancePlanModel: { findById: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let service: WorkOrderPreventiveSchedulingService;

  beforeEach(() => {
    workOrderModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      updateOne: jest.fn().mockReturnValue(
        execResult({
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 1,
        }),
      ),
      create: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), status: 'pending' }),
    };
    maintenancePlanModel = {
      findById: jest
        .fn()
        .mockReturnValue(
          execResult({ frequence: 1, unite_frequence: 'month' }),
        ),
    };
    counterService = { getNextSequence: jest.fn().mockResolvedValue(1) };

    service = new WorkOrderPreventiveSchedulingService(
      workOrderModel as never,
      {} as never,
      {} as never,
      maintenancePlanModel as never,
      counterService as never,
      new MaintenanceSchedulingService(),
    );
  });

  it('creates the next occurrence when the plan is Active', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({ status: 'active', frequence: 1, unite_frequence: 'month' }),
    );

    const created = await service.ensureNextPreventiveWorkOrder(
      schedulableWorkOrder(),
    );

    expect(created).toBe(true);
    expect(workOrderModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        preventive_occurrence_key: expect.stringContaining(
          `preventive:v1:preventive:${machineId.toHexString()}:${moduleId.toHexString()}:${planId.toHexString()}:`,
        ),
      }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          plan_id: planId,
          machine_id: machineId,
          preventive_occurrence_key: expect.any(String),
        }),
      }),
      { upsert: true },
    );
  });

  it('creates the next occurrence when the plan has no status at all (legacy/imported data)', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({ frequence: 1, unite_frequence: 'month' }), // no `status` field
    );

    const created = await service.ensureNextPreventiveWorkOrder(
      schedulableWorkOrder(),
    );

    expect(created).toBe(true);
    expect(workOrderModel.updateOne).toHaveBeenCalled();
  });

  it('rethrows unrelated duplicate-key errors instead of treating them as an existing occurrence', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({ status: 'active', frequence: 1, unite_frequence: 'month' }),
    );
    workOrderModel.updateOne.mockReturnValue({
      exec: jest
        .fn()
        .mockRejectedValue({ code: 11000, keyPattern: { ot_id: 1 } }),
    });

    await expect(
      service.ensureNextPreventiveWorkOrder(schedulableWorkOrder()),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it.each(['paused', 'archived', 'draft', 'completed'])(
    'does not create the next occurrence when the plan is %s',
    async (status) => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult({ status, frequence: 1, unite_frequence: 'month' }),
      );

      const created = await service.ensureNextPreventiveWorkOrder(
        schedulableWorkOrder(),
      );

      expect(created).toBe(false);
      expect(workOrderModel.updateOne).not.toHaveBeenCalled();
    },
  );

  it.each(['lubrication', 'inspection', 'annual-calibration'])(
    'creates the next occurrence for a %s occurrence, same as preventive',
    async (type) => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult({
          status: 'active',
          frequence: 1,
          unite_frequence: 'month',
        }),
      );

      const created = await service.ensureNextPreventiveWorkOrder(
        schedulableWorkOrder({ type_maintenance: type }),
      );

      expect(created).toBe(true);
      expect(workOrderModel.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({ type_maintenance: type }),
        }),
        { upsert: true },
      );
    },
  );

  it('does not create a next occurrence for a corrective occurrence', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({ status: 'active', frequence: 1, unite_frequence: 'month' }),
    );

    const created = await service.ensureNextPreventiveWorkOrder(
      schedulableWorkOrder({ type_maintenance: 'corrective' }),
    );

    expect(created).toBe(false);
    expect(workOrderModel.updateOne).not.toHaveBeenCalled();
  });
});

describe('WorkOrderPreventiveSchedulingService.scheduleFirstPreventiveOccurrence plan status guard', () => {
  const planId = new Types.ObjectId();
  const machineId = new Types.ObjectId();
  const moduleId = new Types.ObjectId();

  let workOrderModel: { findOne: jest.Mock; create: jest.Mock };
  let machineModel: { findById: jest.Mock };
  let moduleModel: { findOne: jest.Mock };
  let maintenancePlanModel: { findById: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let service: WorkOrderPreventiveSchedulingService;

  beforeEach(() => {
    workOrderModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      create: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), status: 'pending' }),
    };
    machineModel = {
      findById: jest.fn().mockReturnValue(execResult({ _id: machineId })),
    };
    moduleModel = {
      findOne: jest
        .fn()
        .mockReturnValue(execResult({ _id: moduleId, machine_id: machineId })),
    };
    maintenancePlanModel = {
      findById: jest.fn().mockReturnValue(
        execResult({
          _id: planId,
          type_maintenance: 'preventive',
          module_id: moduleId,
          status: 'paused',
        }),
      ),
    };
    counterService = { getNextSequence: jest.fn().mockResolvedValue(1) };

    service = new WorkOrderPreventiveSchedulingService(
      workOrderModel as never,
      machineModel as never,
      moduleModel as never,
      maintenancePlanModel as never,
      counterService as never,
      new MaintenanceSchedulingService(),
    );
  });

  it('rejects manual scheduling against a Paused plan', async () => {
    await expect(
      service.scheduleFirstPreventiveOccurrence({
        machineId: machineId.toHexString(),
        planId: planId.toHexString(),
        scheduledDate: '2026-08-01T08:00:00.000Z',
        operatorId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(ConflictException);
    expect(workOrderModel.create).not.toHaveBeenCalled();
  });

  it('allows manual scheduling against an Active plan', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({
        _id: planId,
        type_maintenance: 'preventive',
        module_id: moduleId,
        status: 'active',
      }),
    );

    await service.scheduleFirstPreventiveOccurrence({
      machineId: machineId.toHexString(),
      planId: planId.toHexString(),
      scheduledDate: '2026-08-01T08:00:00.000Z',
      operatorId: new Types.ObjectId().toHexString(),
    });

    expect(workOrderModel.create).toHaveBeenCalled();
  });

  it.each(['lubrication', 'inspection', 'annual-calibration'])(
    'allows manual scheduling against an Active %s plan, preserving its type',
    async (type) => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult({
          _id: planId,
          type_maintenance: type,
          module_id: moduleId,
          status: 'active',
        }),
      );

      await service.scheduleFirstPreventiveOccurrence({
        machineId: machineId.toHexString(),
        planId: planId.toHexString(),
        scheduledDate: '2026-08-01T08:00:00.000Z',
        operatorId: new Types.ObjectId().toHexString(),
      });

      expect(workOrderModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type_maintenance: type }),
      );
    },
  );

  it('rejects manual scheduling against a corrective plan', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({
        _id: planId,
        type_maintenance: 'corrective',
        module_id: moduleId,
        status: 'active',
      }),
    );

    await expect(
      service.scheduleFirstPreventiveOccurrence({
        machineId: machineId.toHexString(),
        planId: planId.toHexString(),
        scheduledDate: '2026-08-01T08:00:00.000Z',
        operatorId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(workOrderModel.create).not.toHaveBeenCalled();
  });
});

describe('WorkOrderPreventiveSchedulingService.createInitialOccurrenceForPlan', () => {
  const planId = new Types.ObjectId();
  const machineId = new Types.ObjectId();
  const moduleId = new Types.ObjectId();

  let workOrderModel: {
    create: jest.Mock;
    exists: jest.Mock;
  };
  let moduleModel: { findById: jest.Mock };
  let maintenancePlanModel: { findById: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let service: WorkOrderPreventiveSchedulingService;

  beforeEach(() => {
    workOrderModel = {
      create: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), status: 'pending' }),
      exists: jest.fn().mockReturnValue(execResult(null)),
    };
    moduleModel = {
      findById: jest
        .fn()
        .mockReturnValue(execResult({ _id: moduleId, machine_id: machineId })),
    };
    maintenancePlanModel = {
      findById: jest.fn().mockReturnValue(
        execResult({
          _id: planId,
          type_maintenance: 'preventive',
          module_id: moduleId,
          instruction: 'Grease bearings',
        }),
      ),
    };
    counterService = { getNextSequence: jest.fn().mockResolvedValue(1) };

    service = new WorkOrderPreventiveSchedulingService(
      workOrderModel as never,
      {} as never,
      moduleModel as never,
      maintenancePlanModel as never,
      counterService as never,
      new MaintenanceSchedulingService(),
    );
  });

  it('creates a due-now first occurrence for a schedulable preventive plan with no prior occurrence', async () => {
    const created = await service.createInitialOccurrenceForPlan(
      planId.toHexString(),
    );

    expect(created).not.toBeNull();
    expect(workOrderModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: planId,
        machine_id: machineId,
        module_id: moduleId,
        type_maintenance: 'preventive',
        status: 'scheduled',
      }),
    );
  });

  it('skips (returns null) when the plan already has an occurrence, without creating a second', async () => {
    workOrderModel.exists.mockReturnValue(
      execResult({ _id: new Types.ObjectId() }),
    );

    const created = await service.createInitialOccurrenceForPlan(
      planId.toHexString(),
    );

    expect(created).toBeNull();
    expect(workOrderModel.create).not.toHaveBeenCalled();
  });

  it('skips (returns null) for a corrective plan', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({
        _id: planId,
        type_maintenance: 'corrective',
        module_id: moduleId,
      }),
    );

    const created = await service.createInitialOccurrenceForPlan(
      planId.toHexString(),
    );

    expect(created).toBeNull();
    expect(workOrderModel.create).not.toHaveBeenCalled();
  });

  it.each(['lubrication', 'inspection', 'annual-calibration'])(
    'creates a due-now first occurrence for a schedulable %s plan, preserving its type',
    async (type) => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult({
          _id: planId,
          type_maintenance: type,
          module_id: moduleId,
          instruction: 'Check and record readings',
        }),
      );

      const created = await service.createInitialOccurrenceForPlan(
        planId.toHexString(),
      );

      expect(created).not.toBeNull();
      expect(workOrderModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_id: planId,
          machine_id: machineId,
          module_id: moduleId,
          type_maintenance: type,
          status: 'scheduled',
        }),
      );
    },
  );
});

describe('WorkOrderPreventiveSchedulingService.reschedulePreventiveOccurrence', () => {
  const workOrderId = new Types.ObjectId();

  function reschedulableOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: workOrderId,
      type_maintenance: 'preventive',
      status: 'scheduled',
      ...overrides,
    };
  }

  let workOrderModel: {
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
  };
  let service: WorkOrderPreventiveSchedulingService;

  beforeEach(() => {
    workOrderModel = {
      findById: jest.fn().mockReturnValue(execResult(reschedulableOrder())),
      findByIdAndUpdate: jest
        .fn()
        .mockReturnValue(
          execResult(reschedulableOrder({ status: 'scheduled' })),
        ),
    };

    service = new WorkOrderPreventiveSchedulingService(
      workOrderModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new MaintenanceSchedulingService(),
    );
  });

  it.each(['preventive', 'lubrication', 'inspection', 'annual-calibration'])(
    'allows rescheduling a %s occurrence',
    async (type) => {
      workOrderModel.findById.mockReturnValue(
        execResult(reschedulableOrder({ type_maintenance: type })),
      );

      const result = await service.reschedulePreventiveOccurrence({
        workOrderId: workOrderId.toHexString(),
        newDueDate: '2026-08-01T08:00:00.000Z',
        reason: 'Machine unavailable',
        userId: new Types.ObjectId().toHexString(),
        role: 'operator',
      });

      expect(result.occurrence).toBeDefined();
      expect(workOrderModel.findByIdAndUpdate).toHaveBeenCalled();
    },
  );

  it('rejects rescheduling a corrective occurrence', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(reschedulableOrder({ type_maintenance: 'corrective' })),
    );

    await expect(
      service.reschedulePreventiveOccurrence({
        workOrderId: workOrderId.toHexString(),
        newDueDate: '2026-08-01T08:00:00.000Z',
        reason: 'Machine unavailable',
        userId: new Types.ObjectId().toHexString(),
        role: 'operator',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(workOrderModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
