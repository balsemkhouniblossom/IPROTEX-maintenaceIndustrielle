import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrdersService } from './work-orders.service';
import { MaintenanceSchedulingService } from './maintenance-scheduling.service';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function chain<T>(value: T) {
  const result: {
    select: jest.Mock;
    populate: jest.Mock;
    sort: jest.Mock;
    exec: jest.Mock;
  } = {
    select: jest.fn(),
    populate: jest.fn(),
    sort: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  result.select.mockReturnValue(result);
  result.populate.mockReturnValue(result);
  result.sort.mockReturnValue(result);
  return result;
}

function findOneChain<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createSessionMock() {
  const session = {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  return session;
}

describe('WorkOrdersService.createCorrectiveReportForOperator', () => {
  const operatorId = new Types.ObjectId().toHexString();
  const machineId = new Types.ObjectId();

  let workOrderModel: {
    findById: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    db: { startSession: jest.Mock };
  };
  let interventionReportModel: { findOne: jest.Mock; create: jest.Mock };
  let machineModel: { findById: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let session: ReturnType<typeof createSessionMock>;
  let service: WorkOrdersService;

  beforeEach(() => {
    session = createSessionMock();
    workOrderModel = {
      findById: jest.fn().mockReturnValue(execResult(null)),
      findOne: jest.fn().mockReturnValue(findOneChain(null)),
      create: jest
        .fn()
        .mockResolvedValue([{ _id: new Types.ObjectId(), status: 'waiting_validation' }]),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    interventionReportModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
    };
    machineModel = {
      findById: jest.fn().mockReturnValue(execResult({ _id: machineId })),
    };
    counterService = {
      getNextSequence: jest.fn().mockResolvedValue(1),
    };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrdersService(
      workOrderModel as never,
      machineModel as never,
      {} as never,
      {} as never,
      interventionReportModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      counterService as never,
      {} as never,
      notificationCenterService as never,
      {} as never,
    );
  });

  it('creates the work order and its intervention report together, deriving identity from the operator id argument only', async () => {
    const result = await service.createCorrectiveReportForOperator({
      operatorId,
      machineId: machineId.toHexString(),
      codePanne: 'FAULT-1',
      faultDescription: 'Motor overheating',
      actions: ['Reset breaker', ' Inspect wiring '],
    });

    expect(workOrderModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          machine_id: machineId,
          technician_id: new Types.ObjectId(operatorId),
          type_maintenance: 'corrective',
          status: 'waiting_validation',
          code_panne: 'FAULT-1',
          description: 'FAULT-1 | Reset breaker | Inspect wiring',
        }),
      ],
      { session },
    );
    expect(interventionReportModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          technician_id: new Types.ObjectId(operatorId),
          cause_racine: 'Motor overheating',
          description_action: 'Reset breaker | Inspect wiring',
          validation_responsable: 'waiting_validation',
        }),
      ],
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
    expect(result.duplicate).toBe(false);
    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'corrective_awaiting_validation',
        recipientRole: 'admin',
        workOrderId: result.workOrder._id.toString(),
      }),
    );
  });

  it('returns the already-created pair instead of a second one when the same fault was just reported', async () => {
    const existingOrder = { _id: new Types.ObjectId(), status: 'waiting_validation' };
    const existingReport = { _id: new Types.ObjectId() };
    workOrderModel.findOne.mockReturnValue(findOneChain(existingOrder));
    interventionReportModel.findOne.mockReturnValue(execResult(existingReport));

    const result = await service.createCorrectiveReportForOperator({
      operatorId,
      machineId: machineId.toHexString(),
      codePanne: 'FAULT-1',
      actions: ['Reset breaker'],
    });

    expect(result).toEqual({
      workOrder: existingOrder,
      report: existingReport,
      duplicate: true,
    });
    expect(workOrderModel.create).not.toHaveBeenCalled();
    expect(interventionReportModel.create).not.toHaveBeenCalled();
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
  });

  it('rolls back and rejects when the intervention report write fails, leaving no partial record behind', async () => {
    interventionReportModel.create.mockRejectedValue(new Error('report insert failed'));

    await expect(
      service.createCorrectiveReportForOperator({
        operatorId,
        machineId: machineId.toHexString(),
        codePanne: 'FAULT-1',
        actions: ['Reset breaker'],
      }),
    ).rejects.toThrow('report insert failed');

    expect(session.endSession).toHaveBeenCalled();
  });

  it('rejects when the target machine does not exist', async () => {
    machineModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.createCorrectiveReportForOperator({
        operatorId,
        machineId: machineId.toHexString(),
        codePanne: 'FAULT-1',
        actions: ['Reset breaker'],
      }),
    ).rejects.toThrow(NotFoundException);
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects when no actions were performed', async () => {
    await expect(
      service.createCorrectiveReportForOperator({
        operatorId,
        machineId: machineId.toHexString(),
        codePanne: 'FAULT-1',
        actions: ['   ', ''],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects an invalid machine id before touching the database', async () => {
    await expect(
      service.createCorrectiveReportForOperator({
        operatorId,
        machineId: 'not-an-object-id',
        codePanne: 'FAULT-1',
        actions: ['Reset breaker'],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(machineModel.findById).not.toHaveBeenCalled();
  });
});

describe('WorkOrdersService.submitPreventiveMaintenanceForOperator', () => {
  const operatorId = new Types.ObjectId().toHexString();
  const otherOperatorId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId();
  const moduleId = new Types.ObjectId();
  const lubrifiantId = new Types.ObjectId().toHexString();

  function scheduledOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: workOrderId,
      module_id: moduleId,
      type_maintenance: 'preventive',
      technician_id: new Types.ObjectId(operatorId),
      status: 'scheduled',
      ...overrides,
    };
  }

  let workOrderModel: {
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    db: { startSession: jest.Mock };
  };
  let interventionReportModel: { create: jest.Mock };
  let lubrifiantModel: { findById: jest.Mock };
  let lubrificationLogModel: { create: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let session: ReturnType<typeof createSessionMock>;
  let service: WorkOrdersService;

  beforeEach(() => {
    session = createSessionMock();
    workOrderModel = {
      findById: jest.fn().mockReturnValue(execResult(scheduledOrder())),
      findOneAndUpdate: jest.fn().mockReturnValue(
        execResult(
          scheduledOrder({ status: 'waiting_validation' }),
        ),
      ),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    interventionReportModel = {
      create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
    };
    lubrifiantModel = {
      findById: jest.fn().mockReturnValue(execResult({ _id: lubrifiantId })),
    };
    lubrificationLogModel = {
      create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
    };
    counterService = {
      getNextSequence: jest.fn().mockResolvedValue(1),
    };

    service = new WorkOrdersService(
      workOrderModel as never,
      {} as never,
      {} as never,
      {} as never,
      interventionReportModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      lubrifiantModel as never,
      lubrificationLogModel as never,
      {} as never,
      counterService as never,
      {} as never,
      { createIfNotExists: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
    );
  });

  it('updates the assigned occurrence and creates its report atomically, with no lubrication log when none is supplied', async () => {
    const result = await service.submitPreventiveMaintenanceForOperator({
      operatorId,
      workOrderId: workOrderId.toHexString(),
      tasksCompleted: ['Check belt tension', ' Grease bearings '],
      condition: 'good',
      comments: 'All nominal',
    });

    expect(workOrderModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: workOrderId,
        technician_id: new Types.ObjectId(operatorId),
        status: { $in: ['scheduled', 'overdue'] },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'waiting_validation',
          description: 'Check belt tension | Grease bearings',
        }),
      }),
      { session, new: true },
    );
    expect(interventionReportModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          ot_id: workOrderId,
          technician_id: new Types.ObjectId(operatorId),
          cause_racine: 'All nominal',
          description_action: 'Check belt tension | Grease bearings',
          etat_final: 'good',
          validation_responsable: 'waiting_validation',
        }),
      ],
      { session },
    );
    expect(lubrificationLogModel.create).not.toHaveBeenCalled();
    expect(result.lubricationLog).toBeNull();
    expect(session.endSession).toHaveBeenCalled();
  });

  it('records a lubrication log tied to the occurrence module only when lubrication input is supplied', async () => {
    const result = await service.submitPreventiveMaintenanceForOperator({
      operatorId,
      workOrderId: workOrderId.toHexString(),
      tasksCompleted: ['Grease bearings'],
      condition: 'good',
      lubrication: { lubrifiantId, quantity: 3 },
    });

    expect(lubrifiantModel.findById).toHaveBeenCalledWith(lubrifiantId);
    expect(lubrificationLogModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          module_id: moduleId,
          lubrifiant_id: lubrifiantId,
          quantite: 3,
          technician_id: new Types.ObjectId(operatorId),
        }),
      ],
      { session },
    );
    expect(result.lubricationLog).not.toBeNull();
  });

  it('rejects when the work order does not exist', async () => {
    workOrderModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects a non-preventive work order', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(scheduledOrder({ type_maintenance: 'corrective' })),
    );

    await expect(
      service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects an occurrence not assigned to this operator', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(
        scheduledOrder({ technician_id: new Types.ObjectId(otherOperatorId) }),
      ),
    );

    await expect(
      service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects an occurrence that is not in a submittable status', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(scheduledOrder({ status: 'in_progress' })),
    );

    await expect(
      service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      }),
    ).rejects.toThrow(ConflictException);
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects a duplicate/concurrent submission caught by the atomic guard, without creating a report', async () => {
    workOrderModel.findOneAndUpdate.mockReturnValue(execResult(null));

    await expect(
      service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      }),
    ).rejects.toThrow(ConflictException);
    expect(interventionReportModel.create).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rolls back and rejects when the intervention report write fails, leaving the work order update undone', async () => {
    interventionReportModel.create.mockRejectedValue(new Error('report insert failed'));

    await expect(
      service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      }),
    ).rejects.toThrow('report insert failed');
    expect(session.endSession).toHaveBeenCalled();
  });

  it('rejects when no tasks were completed', async () => {
    await expect(
      service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['   ', ''],
        condition: 'good',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
  });

  it('rejects when the referenced lubrifiant does not exist', async () => {
    lubrifiantModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
        lubrication: { lubrifiantId, quantity: 1 },
      }),
    ).rejects.toThrow(NotFoundException);
    expect(workOrderModel.db.startSession).not.toHaveBeenCalled();
  });
});

describe('WorkOrdersService.requestPartsForOperator', () => {
  const operatorId = new Types.ObjectId().toHexString();
  const otherOperatorId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId();
  const partId = new Types.ObjectId().toHexString();

  function correctiveOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: workOrderId,
      type_maintenance: 'corrective',
      technician_id: new Types.ObjectId(operatorId),
      status: 'waiting_validation',
      ...overrides,
    };
  }

  let workOrderModel: { findById: jest.Mock };
  let catalogueModel: { findById: jest.Mock };
  let partRequestModel: { findOne: jest.Mock; create: jest.Mock };
  let stockModel: {
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
  };
  let counterService: { getNextSequence: jest.Mock };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let service: WorkOrdersService;

  beforeEach(() => {
    workOrderModel = {
      findById: jest.fn().mockReturnValue(execResult(correctiveOrder())),
    };
    catalogueModel = {
      findById: jest.fn().mockReturnValue(execResult({ _id: partId })),
    };
    partRequestModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(), status: 'pending' }]),
    };
    stockModel = {
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
    };
    counterService = {
      getNextSequence: jest.fn().mockResolvedValue(1),
    };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrdersService(
      workOrderModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      stockModel as never,
      catalogueModel as never,
      {} as never,
      {} as never,
      {} as never,
      partRequestModel as never,
      counterService as never,
      {} as never,
      notificationCenterService as never,
      {} as never,
    );
  });

  it('stores a pending request for the assigned corrective work order, deriving identity from the input only, and never touches Stock', async () => {
    const result = await service.requestPartsForOperator({
      operatorId,
      workOrderId: workOrderId.toHexString(),
      partId,
      quantity: 4,
    });

    expect(partRequestModel.create).toHaveBeenCalledWith([
      expect.objectContaining({
        ot_id: workOrderId,
        part_id: partId,
        quantity: 4,
        requested_by: new Types.ObjectId(operatorId),
        status: 'pending',
      }),
    ]);
    expect(result.status).toBe('pending');
    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'part_request_created',
        recipientRole: 'technician',
        workOrderId: workOrderId.toHexString(),
      }),
    );

    // Explicit proof of "without directly reducing stock": no Stock write
    // or read of any kind happens anywhere in this flow.
    expect(stockModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(stockModel.updateOne).not.toHaveBeenCalled();
    expect(stockModel.find).not.toHaveBeenCalled();
    expect(stockModel.findById).not.toHaveBeenCalled();
  });

  it('rejects when the work order does not exist', async () => {
    workOrderModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a non-corrective work order', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(correctiveOrder({ type_maintenance: 'preventive' })),
    );

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a work order not assigned to this operator', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(
        correctiveOrder({ technician_id: new Types.ObjectId(otherOperatorId) }),
      ),
    );

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a request for a work order in a non-eligible (closed) status', async () => {
    workOrderModel.findById.mockReturnValue(
      execResult(correctiveOrder({ status: 'completed' })),
    );

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects when the referenced part does not exist', async () => {
    catalogueModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid, non-positive, or non-integer quantity', async () => {
    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 0,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1.5,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate active request for the same work order and part (pre-check)', async () => {
    partRequestModel.findOne.mockReturnValue(
      execResult({ _id: new Types.ObjectId(), status: 'pending' }),
    );

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);
    expect(partRequestModel.create).not.toHaveBeenCalled();
  });

  it('rejects a concurrent duplicate caught by the unique-index race guard', async () => {
    const duplicateKeyError = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
    });
    partRequestModel.create.mockRejectedValue(duplicateKeyError);

    await expect(
      service.requestPartsForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        partId,
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('WorkOrdersService operator-scoped calendar actions', () => {
  const operatorId = new Types.ObjectId().toHexString();
  const otherOperatorId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId();

  function ownedOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: workOrderId,
      technician_id: new Types.ObjectId(operatorId),
      type_maintenance: 'corrective',
      status: 'scheduled',
      ...overrides,
    };
  }

  let workOrderModel: { findById: jest.Mock; findOneAndUpdate: jest.Mock; find: jest.Mock };
  let service: WorkOrdersService;

  beforeEach(() => {
    workOrderModel = {
      findById: jest.fn().mockReturnValue(chain(ownedOrder())),
      findOneAndUpdate: jest.fn().mockReturnValue(chain(null)),
      find: jest.fn().mockReturnValue(chain([])),
    };

    service = new WorkOrdersService(
      workOrderModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new MaintenanceSchedulingService() as never,
      { createIfNotExists: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
    );
  });

  describe('startWorkOrderForOperator', () => {
    it('rejects when the work order does not exist', async () => {
      workOrderModel.findById.mockReturnValue(chain(null));

      await expect(
        service.startWorkOrderForOperator({ operatorId, workOrderId: workOrderId.toHexString() }),
      ).rejects.toThrow(NotFoundException);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects when the work order is not assigned to this operator', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(ownedOrder({ technician_id: new Types.ObjectId(otherOperatorId) })),
      );

      await expect(
        service.startWorkOrderForOperator({ operatorId, workOrderId: workOrderId.toHexString() }),
      ).rejects.toThrow(ForbiddenException);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('transitions a startable occurrence to in_progress and records the start time', async () => {
      const updated = ownedOrder({ status: 'in_progress' });
      workOrderModel.findOneAndUpdate.mockReturnValue(chain(updated));

      const result = await service.startWorkOrderForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
      });

      expect(workOrderModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: workOrderId,
          technician_id: new Types.ObjectId(operatorId),
          status: { $in: ['scheduled', 'overdue', 'pending'] },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'in_progress' }),
        }),
        { new: true },
      );
      expect(result).toBe(updated);
    });

    it('rejects starting a work order that is not in a startable status', async () => {
      workOrderModel.findById.mockReturnValue(chain(ownedOrder({ status: 'in_progress' })));
      workOrderModel.findOneAndUpdate.mockReturnValue(chain(null));

      await expect(
        service.startWorkOrderForOperator({ operatorId, workOrderId: workOrderId.toHexString() }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('completeWorkOrderForOperator', () => {
    it('rejects a preventive occurrence, directing it to the dedicated submission endpoint', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(ownedOrder({ type_maintenance: 'preventive', status: 'in_progress' })),
      );

      await expect(
        service.completeWorkOrderForOperator({ operatorId, workOrderId: workOrderId.toHexString() }),
      ).rejects.toThrow(ConflictException);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects completing a work order that is not currently in progress', async () => {
      workOrderModel.findById.mockReturnValue(chain(ownedOrder({ status: 'scheduled' })));
      workOrderModel.findOneAndUpdate.mockReturnValue(chain(null));

      await expect(
        service.completeWorkOrderForOperator({ operatorId, workOrderId: workOrderId.toHexString() }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the work order is not assigned to this operator', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(ownedOrder({ technician_id: new Types.ObjectId(otherOperatorId), status: 'in_progress' })),
      );

      await expect(
        service.completeWorkOrderForOperator({ operatorId, workOrderId: workOrderId.toHexString() }),
      ).rejects.toThrow(ForbiddenException);
      expect(workOrderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('moves a corrective occurrence in progress to waiting_validation, never straight to completed', async () => {
      workOrderModel.findById.mockReturnValue(chain(ownedOrder({ status: 'in_progress' })));
      const updated = ownedOrder({ status: 'waiting_validation' });
      workOrderModel.findOneAndUpdate.mockReturnValue(chain(updated));

      const result = await service.completeWorkOrderForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
      });

      expect(workOrderModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: workOrderId,
          technician_id: new Types.ObjectId(operatorId),
          status: 'in_progress',
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: 'waiting_validation' }),
        }),
        { new: true },
      );
      expect(result).toBe(updated);
    });
  });

  describe('rescheduleWorkOrderForOperator', () => {
    it('rejects when the work order is not assigned to this operator, before touching the reschedule logic', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(ownedOrder({ technician_id: new Types.ObjectId(otherOperatorId) })),
      );
      const spy = jest.spyOn(service, 'reschedulePreventiveOccurrence');

      await expect(
        service.rescheduleWorkOrderForOperator({
          operatorId,
          workOrderId: workOrderId.toHexString(),
          newDueDate: '2026-08-01T08:00:00.000Z',
          reason: 'Machine unavailable',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(spy).not.toHaveBeenCalled();
    });

    it('delegates to the shared reschedule logic as the operator role once ownership is verified', async () => {
      const expected = { occurrence: ownedOrder(), schedulingState: 'scheduled' };
      const spy = jest
        .spyOn(service, 'reschedulePreventiveOccurrence')
        .mockResolvedValue(expected as never);

      const result = await service.rescheduleWorkOrderForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        newDueDate: '2026-08-01T08:00:00.000Z',
        reason: 'Machine unavailable',
      });

      expect(spy).toHaveBeenCalledWith({
        workOrderId: workOrderId.toHexString(),
        newDueDate: '2026-08-01T08:00:00.000Z',
        reason: 'Machine unavailable',
        userId: operatorId,
        role: 'operator',
      });
      expect(result).toBe(expected);
    });
  });

  describe('getCalendarEventDetailsForOperator', () => {
    it('rejects when the work order does not exist', async () => {
      workOrderModel.findById.mockReturnValue(chain(null));

      await expect(
        service.getCalendarEventDetailsForOperator(workOrderId.toHexString(), operatorId),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the work order is not assigned to this operator', async () => {
      workOrderModel.findById.mockReturnValue(
        chain(ownedOrder({ technician_id: new Types.ObjectId(otherOperatorId) })),
      );

      await expect(
        service.getCalendarEventDetailsForOperator(workOrderId.toHexString(), operatorId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('delegates to the shared event-details builder once ownership is verified', async () => {
      const expected = { id: workOrderId.toHexString() };
      const spy = jest
        .spyOn(service, 'getCalendarEventDetails')
        .mockResolvedValue(expected as never);

      const result = await service.getCalendarEventDetailsForOperator(
        workOrderId.toHexString(),
        operatorId,
      );

      expect(spy).toHaveBeenCalledWith(workOrderId.toHexString());
      expect(result).toBe(expected);
    });
  });

  describe('personal widget/notifications/timeline delegation', () => {
    it('scopes the dashboard widget to this operator only', async () => {
      const expected = { today: [] };
      const spy = jest
        .spyOn(service, 'getDashboardCalendarWidget')
        .mockResolvedValue(expected as never);

      const result = await service.getCalendarWidgetForOperator(operatorId);

      expect(spy).toHaveBeenCalledWith({ technicianId: operatorId });
      expect(result).toBe(expected);
    });

    it('scopes notification cards to this operator only', async () => {
      const expected = [{ key: 'upcoming_maintenance', count: 0 }];
      const spy = jest
        .spyOn(service, 'getNotificationCards')
        .mockResolvedValue(expected as never);

      const result = await service.getNotificationCardsForOperator(operatorId);

      expect(spy).toHaveBeenCalledWith({ technicianId: operatorId });
      expect(result).toBe(expected);
    });

    it('scopes the timeline to this operator only', async () => {
      const expected = { today: [] };
      const spy = jest.spyOn(service, 'getTimeline').mockResolvedValue(expected as never);
      const date = new Date('2026-07-20T00:00:00.000Z');

      const result = await service.getTimelineForOperator(date, operatorId, 'machine-1');

      expect(spy).toHaveBeenCalledWith(date, 'machine-1', operatorId);
      expect(result).toBe(expected);
    });
  });

  describe('getCalendarEventsForOperator', () => {
    it('hard-scopes the query to this operator, never trusting a client-supplied operator filter', async () => {
      const date = new Date('2026-07-16T12:00:00.000Z');

      const response = await service.getCalendarEventsForOperator('month', date, operatorId, {});

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          technician_id: new Types.ObjectId(operatorId),
        }),
      );
      expect(response.items).toEqual([]);
      expect(response.view).toBe('month');
      expect(new Date(response.rangeStart).getTime()).toBeLessThanOrEqual(date.getTime());
      expect(new Date(response.rangeEnd).getTime()).toBeGreaterThanOrEqual(date.getTime());
    });

    it('applies machine/status/priority/maintenance-type filters on top of the operator scope', async () => {
      const date = new Date('2026-07-16T12:00:00.000Z');
      const machineId = new Types.ObjectId().toHexString();

      await service.getCalendarEventsForOperator('day', date, operatorId, {
        machineId,
        maintenanceType: 'preventive',
        status: 'scheduled',
        priority: 'high',
      });

      expect(workOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          technician_id: new Types.ObjectId(operatorId),
          machine_id: new Types.ObjectId(machineId),
          type_maintenance: 'preventive',
          status: 'scheduled',
          priorite: 'high',
        }),
      );
    });
  });
});

describe('WorkOrdersService.applyValidationAction notifications', () => {
  const workOrderId = new Types.ObjectId().toHexString();
  const technicianId = new Types.ObjectId();

  let workOrderModel: { findById: jest.Mock; findByIdAndUpdate: jest.Mock };
  let interventionReportModel: { findOne: jest.Mock; findByIdAndUpdate: jest.Mock };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let service: WorkOrdersService;

  beforeEach(() => {
    workOrderModel = {
      findById: jest.fn().mockReturnValue(
        execResult({ _id: workOrderId, technician_id: technicianId }),
      ),
      findByIdAndUpdate: jest.fn().mockReturnValue(
        execResult({
          _id: workOrderId,
          ot_id: 'WO-COR-000001',
          status: 'validated',
          technician_id: technicianId,
          type_maintenance: 'corrective',
          machine_id: undefined,
        }),
      ),
    };
    interventionReportModel = {
      findOne: jest.fn().mockReturnValue(findOneChain(null)),
      findByIdAndUpdate: jest.fn().mockReturnValue(execResult(null)),
    };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrdersService(
      workOrderModel as never,
      {} as never,
      {} as never,
      {} as never,
      interventionReportModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      notificationCenterService as never,
      {} as never,
    );
  });

  it('notifies the assigned technician that their report was approved', async () => {
    await service.applyValidationAction(workOrderId, 'approve');

    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'validation_approved',
        recipientUserId: technicianId.toString(),
        workOrderId,
      }),
    );
  });

  it('notifies the assigned technician that their report was rejected', async () => {
    workOrderModel.findByIdAndUpdate.mockReturnValue(
      execResult({
        _id: workOrderId,
        ot_id: 'WO-COR-000001',
        status: 'rejected',
        technician_id: technicianId,
        type_maintenance: 'corrective',
        machine_id: undefined,
      }),
    );

    await service.applyValidationAction(workOrderId, 'reject');

    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'validation_rejected',
        recipientUserId: technicianId.toString(),
        workOrderId,
      }),
    );
  });

  it('does not notify for a request_correction action', async () => {
    workOrderModel.findByIdAndUpdate.mockReturnValue(
      execResult({
        _id: workOrderId,
        ot_id: 'WO-COR-000001',
        status: 'returned',
        technician_id: technicianId,
        type_maintenance: 'corrective',
        machine_id: undefined,
      }),
    );

    await service.applyValidationAction(workOrderId, 'request_correction');

    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
  });
});

describe('WorkOrdersService.decidePartRequest', () => {
  const requestId = new Types.ObjectId();
  const operatorId = new Types.ObjectId();
  const workOrderId = new Types.ObjectId();
  const partId = new Types.ObjectId();
  const stockId = new Types.ObjectId();

  function pendingRequest(overrides: Record<string, unknown> = {}) {
    return {
      _id: requestId,
      ot_id: workOrderId,
      part_id: partId,
      quantity: 3,
      requested_by: operatorId,
      status: 'pending',
      ...overrides,
    };
  }

  let partRequestModel: {
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    db: { startSession: jest.Mock };
  };
  let stockModel: { findOne: jest.Mock };
  let stockMovementsService: {
    reserve: jest.Mock;
    cancelReservation: jest.Mock;
  };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let session: ReturnType<typeof createSessionMock>;
  let service: WorkOrdersService;

  beforeEach(() => {
    session = createSessionMock();
    partRequestModel = {
      findById: jest.fn().mockReturnValue(execResult(pendingRequest())),
      findOneAndUpdate: jest.fn().mockReturnValue(
        execResult(pendingRequest({ status: 'reserved' })),
      ),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    stockModel = {
      findOne: jest.fn().mockReturnValue(execResult({ _id: stockId })),
    };
    stockMovementsService = {
      reserve: jest.fn().mockResolvedValue({}),
      cancelReservation: jest.fn().mockResolvedValue({}),
    };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrdersService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      stockModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      partRequestModel as never,
      {} as never,
      {} as never,
      notificationCenterService as never,
      stockMovementsService as never,
    );
  });

  it('rejects when the part request does not exist', async () => {
    partRequestModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'approve',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
  });

  it('rejects a part request that has already been decided', async () => {
    partRequestModel.findById.mockReturnValue(
      execResult(pendingRequest({ status: 'reserved' })),
    );

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'approve',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(ConflictException);
    expect(partRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects when approving would require a stock record that does not exist', async () => {
    stockModel.findOne.mockReturnValue(execResult(null));

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'approve',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(NotFoundException);
    expect(partRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('approves a pending request, reserves stock transactionally, and notifies the requesting operator', async () => {
    const deciderId = new Types.ObjectId().toHexString();

    const result = await service.decidePartRequest({
      requestId: requestId.toHexString(),
      decision: 'approve',
      deciderId,
    });

    expect(partRequestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: requestId, status: 'pending' },
      { $set: { status: 'reserved' } },
      { new: true, session },
    );
    expect(stockMovementsService.reserve).toHaveBeenCalledWith(session, {
      stockId: stockId.toString(),
      partId: partId.toString(),
      quantity: 3,
      workOrderId: workOrderId.toString(),
      partRequestId: requestId.toString(),
      actorId: deciderId,
    });
    expect(result.status).toBe('reserved');
    expect(session.endSession).toHaveBeenCalled();
    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'part_request_decision',
        recipientUserId: operatorId.toString(),
        workOrderId: workOrderId.toString(),
      }),
    );
  });

  it('rejects a pending request, sets it to cancelled, never touches Stock, and notifies the requesting operator', async () => {
    partRequestModel.findOneAndUpdate.mockReturnValue(
      execResult(pendingRequest({ status: 'cancelled' })),
    );

    const result = await service.decidePartRequest({
      requestId: requestId.toHexString(),
      decision: 'reject',
      deciderId: new Types.ObjectId().toHexString(),
    });

    expect(partRequestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: requestId, status: 'pending' },
      { $set: { status: 'cancelled' } },
      { new: true, session },
    );
    expect(stockMovementsService.reserve).not.toHaveBeenCalled();
    expect(stockMovementsService.cancelReservation).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'part_request_decision' }),
    );
  });

  it('cancels a reserved request, releases the stock reservation transactionally, and notifies the requesting operator', async () => {
    partRequestModel.findById.mockReturnValue(
      execResult(pendingRequest({ status: 'reserved' })),
    );
    partRequestModel.findOneAndUpdate.mockReturnValue(
      execResult(pendingRequest({ status: 'cancelled' })),
    );
    const deciderId = new Types.ObjectId().toHexString();

    const result = await service.decidePartRequest({
      requestId: requestId.toHexString(),
      decision: 'cancel',
      deciderId,
      reason: 'No longer needed',
    });

    expect(partRequestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: requestId, status: 'reserved' },
      { $set: { status: 'cancelled' } },
      { new: true, session },
    );
    expect(stockMovementsService.cancelReservation).toHaveBeenCalledWith(session, {
      stockId: stockId.toString(),
      partId: partId.toString(),
      quantity: 3,
      workOrderId: workOrderId.toString(),
      partRequestId: requestId.toString(),
      actorId: deciderId,
      reason: 'No longer needed',
    });
    expect(result.status).toBe('cancelled');
  });

  it('rejects cancelling a request that is not currently reserved', async () => {
    partRequestModel.findById.mockReturnValue(execResult(pendingRequest()));

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'cancel',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(ConflictException);
    expect(partRequestModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('fails safe (conflict) when a concurrent decision wins the atomic status-guarded update race', async () => {
    partRequestModel.findOneAndUpdate.mockReturnValue(execResult(null));

    await expect(
      service.decidePartRequest({
        requestId: requestId.toHexString(),
        decision: 'approve',
        deciderId: new Types.ObjectId().toHexString(),
      }),
    ).rejects.toThrow(ConflictException);
    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
  });
});

describe('WorkOrdersService.create notifications', () => {
  const machineId = new Types.ObjectId();
  const technicianId = new Types.ObjectId();

  let workOrderModel: jest.Mock & { db?: unknown };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let service: WorkOrdersService;
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
    (workOrderModel as unknown as { findOne: jest.Mock }).findOne = jest
      .fn()
      .mockReturnValue(findOneChain(null));
    (workOrderModel as unknown as { find: jest.Mock }).find = jest
      .fn()
      .mockReturnValue(findOneChain([]));

    const interventionReportModel = {
      findOne: jest.fn().mockReturnValue(execResult({ _id: new Types.ObjectId() })),
    };

    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrdersService(
      workOrderModel as never,
      {} as never,
      {} as never,
      {} as never,
      interventionReportModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      notificationCenterService as never,
      {} as never,
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

    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_order_created',
        recipientUserId: technicianId.toString(),
        workOrderId: (result as unknown as { _id: Types.ObjectId })._id.toString(),
      }),
    );
  });

  it('does not send a work-order-created notification when the work order is created already completed', async () => {
    savedWorkOrder.status = 'completed';

    await service.create({
      ot_id: 'WO-PREV-000001',
      machine_id: machineId.toString(),
      technician_id: technicianId.toString(),
      type_maintenance: 'preventive',
      status: 'completed',
    } as never);

    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
  });
});

describe('WorkOrdersService maintenance-plan scheduling gate', () => {
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

  let workOrderModel: { findOne: jest.Mock; create: jest.Mock };
  let maintenancePlanModel: { findById: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let service: WorkOrdersService;

  beforeEach(() => {
    workOrderModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      create: jest
        .fn()
        .mockResolvedValue({ _id: new Types.ObjectId(), status: 'pending' }),
    };
    maintenancePlanModel = {
      findById: jest.fn().mockReturnValue(
        execResult({ frequence: 1, unite_frequence: 'month' }),
      ),
    };
    counterService = { getNextSequence: jest.fn().mockResolvedValue(1) };

    service = new WorkOrdersService(
      workOrderModel as never,
      {} as never,
      {} as never,
      maintenancePlanModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      counterService as never,
      new MaintenanceSchedulingService() as never,
      { createIfNotExists: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
    );
  });

  function callEnsureNext(workOrder: Record<string, unknown>) {
    return (
      service as unknown as {
        ensureNextPreventiveWorkOrder(wo: unknown): Promise<boolean>;
      }
    ).ensureNextPreventiveWorkOrder(workOrder);
  }

  it('creates the next occurrence when the plan is Active', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({ status: 'active', frequence: 1, unite_frequence: 'month' }),
    );

    const created = await callEnsureNext(schedulableWorkOrder());

    expect(created).toBe(true);
    expect(workOrderModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: planId, machine_id: machineId }),
    );
  });

  it('creates the next occurrence when the plan has no status at all (legacy/imported data)', async () => {
    maintenancePlanModel.findById.mockReturnValue(
      execResult({ frequence: 1, unite_frequence: 'month' }), // no `status` field
    );

    const created = await callEnsureNext(schedulableWorkOrder());

    expect(created).toBe(true);
    expect(workOrderModel.create).toHaveBeenCalled();
  });

  it.each(['paused', 'archived', 'draft', 'completed'])(
    'does not create the next occurrence when the plan is %s',
    async (status) => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult({ status, frequence: 1, unite_frequence: 'month' }),
      );

      const created = await callEnsureNext(schedulableWorkOrder());

      expect(created).toBe(false);
      expect(workOrderModel.create).not.toHaveBeenCalled();
    },
  );

  describe('scheduleFirstPreventiveOccurrence plan status guard', () => {
    let machineModel: { findById: jest.Mock };
    let moduleModel: { findOne: jest.Mock };

    beforeEach(() => {
      machineModel = { findById: jest.fn().mockReturnValue(execResult({ _id: machineId })) };
      moduleModel = {
        findOne: jest.fn().mockReturnValue(
          execResult({ _id: moduleId, machine_id: machineId }),
        ),
      };
      maintenancePlanModel.findById.mockReturnValue(
        execResult({
          _id: planId,
          type_maintenance: 'preventive',
          module_id: moduleId,
          status: 'paused',
        }),
      );

      service = new WorkOrdersService(
        workOrderModel as never,
        machineModel as never,
        moduleModel as never,
        maintenancePlanModel as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        counterService as never,
        new MaintenanceSchedulingService() as never,
        { createIfNotExists: jest.fn().mockResolvedValue(null) } as never,
        {} as never,
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
  });

  describe('createInitialOccurrenceForPlan', () => {
    let moduleModel: { findById: jest.Mock };

    beforeEach(() => {
      moduleModel = {
        findById: jest.fn().mockReturnValue(
          execResult({ _id: moduleId, machine_id: machineId }),
        ),
      };
      service = new WorkOrdersService(
        workOrderModel as never,
        {} as never,
        moduleModel as never,
        maintenancePlanModel as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        counterService as never,
        new MaintenanceSchedulingService() as never,
        { createIfNotExists: jest.fn().mockResolvedValue(null) } as never,
        {} as never,
      );
      maintenancePlanModel.findById.mockReturnValue(
        execResult({
          _id: planId,
          type_maintenance: 'preventive',
          module_id: moduleId,
          instruction: 'Grease bearings',
        }),
      );
    });

    it('creates a due-now first occurrence for a schedulable preventive plan with no prior occurrence', async () => {
      (workOrderModel as unknown as { exists: jest.Mock }).exists = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

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
      (workOrderModel as unknown as { exists: jest.Mock }).exists = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) });

      const created = await service.createInitialOccurrenceForPlan(
        planId.toHexString(),
      );

      expect(created).toBeNull();
      expect(workOrderModel.create).not.toHaveBeenCalled();
    });

    it('skips (returns null) for a non-preventive plan', async () => {
      maintenancePlanModel.findById.mockReturnValue(
        execResult({ _id: planId, type_maintenance: 'corrective', module_id: moduleId }),
      );
      (workOrderModel as unknown as { exists: jest.Mock }).exists = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const created = await service.createInitialOccurrenceForPlan(
        planId.toHexString(),
      );

      expect(created).toBeNull();
      expect(workOrderModel.create).not.toHaveBeenCalled();
    });
  });
});
