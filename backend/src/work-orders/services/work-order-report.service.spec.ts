import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkOrderReportService } from './work-order-report.service';

function execResult<T>(value: T) {
  const chain = {
    session: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.session.mockReturnValue(chain);
  return chain;
}

function findOneChain<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createSessionMock() {
  return {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

describe('WorkOrderReportService.createCorrectiveReportForOperator', () => {
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
  let notificationService: {
    notifyCorrectiveAwaitingValidation: jest.Mock;
    notifyValidationDecision: jest.Mock;
  };
  let session: ReturnType<typeof createSessionMock>;
  let service: WorkOrderReportService;

  beforeEach(() => {
    session = createSessionMock();
    workOrderModel = {
      findById: jest.fn().mockReturnValue(execResult(null)),
      findOne: jest.fn().mockReturnValue(findOneChain(null)),
      create: jest
        .fn()
        .mockResolvedValue([
          { _id: new Types.ObjectId(), status: 'waiting_validation' },
        ]),
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
    notificationService = {
      notifyCorrectiveAwaitingValidation: jest.fn().mockResolvedValue(null),
      notifyValidationDecision: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrderReportService(
      workOrderModel as never,
      interventionReportModel as never,
      machineModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      counterService as never,
      notificationService as never,
      {} as never,
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
    expect(
      notificationService.notifyCorrectiveAwaitingValidation,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId: result.workOrder._id.toString(),
      }),
    );
  });

  it('returns the already-created pair instead of a second one when the same fault was just reported', async () => {
    const existingOrder = {
      _id: new Types.ObjectId(),
      status: 'waiting_validation',
    };
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
    expect(
      notificationService.notifyCorrectiveAwaitingValidation,
    ).not.toHaveBeenCalled();
  });

  it('rolls back and rejects when the intervention report write fails, leaving no partial record behind', async () => {
    interventionReportModel.create.mockRejectedValue(
      new Error('report insert failed'),
    );

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

  it('rejects a blank fault code before creating a report', async () => {
    await expect(
      service.createCorrectiveReportForOperator({
        operatorId,
        machineId: machineId.toHexString(),
        codePanne: '   ',
        actions: ['Reset breaker'],
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

describe('WorkOrderReportService.submitPreventiveMaintenanceForOperator', () => {
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
  let service: WorkOrderReportService;

  beforeEach(() => {
    session = createSessionMock();
    workOrderModel = {
      findById: jest.fn().mockReturnValue(execResult(scheduledOrder())),
      findOneAndUpdate: jest
        .fn()
        .mockReturnValue(
          execResult(scheduledOrder({ status: 'waiting_validation' })),
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

    service = new WorkOrderReportService(
      workOrderModel as never,
      interventionReportModel as never,
      {} as never,
      lubrifiantModel as never,
      lubrificationLogModel as never,
      {} as never,
      {} as never,
      counterService as never,
      {
        notifyCorrectiveAwaitingValidation: jest.fn().mockResolvedValue(null),
        notifyValidationDecision: jest.fn().mockResolvedValue(null),
      } as never,
      {} as never,
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

  it('rejects a corrective work order', async () => {
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

  it.each(['lubrication', 'inspection', 'annual-calibration'])(
    'accepts a %s work order the same as preventive',
    async (type) => {
      workOrderModel.findById.mockReturnValue(
        execResult(scheduledOrder({ type_maintenance: type })),
      );

      const result = await service.submitPreventiveMaintenanceForOperator({
        operatorId,
        workOrderId: workOrderId.toHexString(),
        tasksCompleted: ['Check belt tension'],
        condition: 'good',
      });

      expect(result.workOrder).toBeDefined();
      expect(workOrderModel.db.startSession).toHaveBeenCalled();
    },
  );

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
    interventionReportModel.create.mockRejectedValue(
      new Error('report insert failed'),
    );

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

describe('WorkOrderReportService.applyValidationDecision', () => {
  const workOrderId = new Types.ObjectId().toHexString();
  const technicianId = new Types.ObjectId();

  function approvedWorkOrder(overrides: Record<string, unknown> = {}) {
    return {
      _id: workOrderId,
      ot_id: 'WO-COR-000001',
      status: 'validated',
      technician_id: technicianId,
      machine_id: new Types.ObjectId(),
      ...overrides,
    };
  }

  let lifecycleService: { applyValidationAction: jest.Mock };
  let preventiveSchedulingService: { ensureNextPreventiveWorkOrder: jest.Mock };
  let notificationService: {
    notifyCorrectiveAwaitingValidation: jest.Mock;
    notifyValidationDecision: jest.Mock;
  };
  let service: WorkOrderReportService;

  beforeEach(() => {
    lifecycleService = {
      applyValidationAction: jest.fn().mockResolvedValue(approvedWorkOrder()),
    };
    preventiveSchedulingService = {
      ensureNextPreventiveWorkOrder: jest.fn().mockResolvedValue(true),
    };
    notificationService = {
      notifyCorrectiveAwaitingValidation: jest.fn().mockResolvedValue(null),
      notifyValidationDecision: jest.fn().mockResolvedValue(null),
    };

    service = new WorkOrderReportService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      notificationService as never,
      lifecycleService as never,
      preventiveSchedulingService as never,
    );
  });

  it('delegates the transition to the lifecycle service unchanged', async () => {
    const validatorId = new Types.ObjectId().toHexString();

    await service.applyValidationDecision({
      workOrderId,
      action: 'approve',
      validatorId,
    });

    expect(lifecycleService.applyValidationAction).toHaveBeenCalledWith({
      workOrderId,
      action: 'approve',
      validatorId,
    });
  });

  it('triggers the next preventive occurrence and notifies on a fresh approval', async () => {
    const updated = approvedWorkOrder();
    lifecycleService.applyValidationAction.mockResolvedValue(updated);

    const result = await service.applyValidationDecision({
      workOrderId,
      action: 'approve',
    });

    expect(
      preventiveSchedulingService.ensureNextPreventiveWorkOrder,
    ).toHaveBeenCalledWith(updated);
    expect(notificationService.notifyValidationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        workOrderId,
        action: 'approve',
        technicianId: technicianId.toString(),
      }),
    );
    expect(result).toBe(updated);
  });

  it('notifies on rejection but never triggers preventive recurrence', async () => {
    lifecycleService.applyValidationAction.mockResolvedValue(
      approvedWorkOrder({ status: 'rejected' }),
    );

    await service.applyValidationDecision({ workOrderId, action: 'reject' });

    expect(
      preventiveSchedulingService.ensureNextPreventiveWorkOrder,
    ).not.toHaveBeenCalled();
    expect(notificationService.notifyValidationDecision).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reject' }),
    );
  });

  it('neither notifies nor triggers recurrence for a request_correction decision', async () => {
    lifecycleService.applyValidationAction.mockResolvedValue(
      approvedWorkOrder({ status: 'returned' }),
    );

    await service.applyValidationDecision({
      workOrderId,
      action: 'request_correction',
    });

    expect(
      preventiveSchedulingService.ensureNextPreventiveWorkOrder,
    ).not.toHaveBeenCalled();
    expect(notificationService.notifyValidationDecision).not.toHaveBeenCalled();
  });

  it('skips recurrence and notification entirely when the decision was already applied (idempotent retry)', async () => {
    const alreadyApplied = approvedWorkOrder();
    Object.defineProperty(alreadyApplied, '__validationAlreadyApplied', {
      value: true,
      enumerable: false,
    });
    lifecycleService.applyValidationAction.mockResolvedValue(alreadyApplied);

    const result = await service.applyValidationDecision({
      workOrderId,
      action: 'approve',
    });

    expect(
      preventiveSchedulingService.ensureNextPreventiveWorkOrder,
    ).not.toHaveBeenCalled();
    expect(notificationService.notifyValidationDecision).not.toHaveBeenCalled();
    expect(result).toBe(alreadyApplied);
  });

  it('skips notification but still triggers recurrence when the work order has no assigned technician', async () => {
    lifecycleService.applyValidationAction.mockResolvedValue(
      approvedWorkOrder({ technician_id: undefined }),
    );

    await service.applyValidationDecision({ workOrderId, action: 'approve' });

    expect(
      preventiveSchedulingService.ensureNextPreventiveWorkOrder,
    ).toHaveBeenCalled();
    expect(notificationService.notifyValidationDecision).not.toHaveBeenCalled();
  });

  it('returns null and performs no side effects when the work order does not exist', async () => {
    lifecycleService.applyValidationAction.mockResolvedValue(null);

    const result = await service.applyValidationDecision({
      workOrderId,
      action: 'approve',
    });

    expect(result).toBeNull();
    expect(
      preventiveSchedulingService.ensureNextPreventiveWorkOrder,
    ).not.toHaveBeenCalled();
    expect(notificationService.notifyValidationDecision).not.toHaveBeenCalled();
  });
});

describe('WorkOrderReportService.ensureAutoInterventionReport', () => {
  let interventionReportModel: { findOne: jest.Mock; create: jest.Mock };
  let panneModel: { findOne: jest.Mock };
  let panneSolutionModel: { findOne: jest.Mock };
  let counterService: { getNextSequence: jest.Mock };
  let service: WorkOrderReportService;

  beforeEach(() => {
    interventionReportModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };
    panneModel = { findOne: jest.fn().mockReturnValue(execResult(null)) };
    panneSolutionModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
    };
    counterService = { getNextSequence: jest.fn().mockResolvedValue(1) };

    service = new WorkOrderReportService(
      {} as never,
      interventionReportModel as never,
      {} as never,
      {} as never,
      {} as never,
      panneModel as never,
      panneSolutionModel as never,
      counterService as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('is a no-op when a report already exists for this work order', async () => {
    interventionReportModel.findOne.mockReturnValue(
      execResult({ _id: new Types.ObjectId() }),
    );

    await service.ensureAutoInterventionReport({
      _id: new Types.ObjectId(),
      status: 'completed',
    });

    expect(interventionReportModel.create).not.toHaveBeenCalled();
  });

  it('backfills a completed report with corrective fault data when code_panne resolves to a known fault', async () => {
    panneModel.findOne.mockReturnValue(
      execResult({ code_panne: 'F1', description: 'Overheating' }),
    );
    panneSolutionModel.findOne.mockReturnValue(
      execResult({ solution_recommandee: 'Replace fan' }),
    );
    const workOrderId = new Types.ObjectId();

    await service.ensureAutoInterventionReport({
      _id: workOrderId,
      status: 'completed',
      code_panne: 'F1',
      technician_id: new Types.ObjectId(),
    });

    expect(interventionReportModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          ot_id: workOrderId.toHexString(),
          cause_racine: 'Overheating',
          description_action: 'Replace fan',
          etat_final: 'completed',
          validation_responsable: 'waiting_validation',
        }),
      ],
      expect.anything(),
    );
  });

  it('marks validation_responsable as validated only when the work order status is already validated', async () => {
    const workOrderId = new Types.ObjectId();

    await service.ensureAutoInterventionReport({
      _id: workOrderId,
      status: 'validated',
    });

    expect(interventionReportModel.create).toHaveBeenCalledWith(
      [expect.objectContaining({ validation_responsable: 'validated' })],
      expect.anything(),
    );
  });
});

describe('WorkOrderReportService.resolveCorrectiveData', () => {
  let panneModel: { findOne: jest.Mock };
  let panneSolutionModel: { findOne: jest.Mock };
  let service: WorkOrderReportService;

  beforeEach(() => {
    panneModel = { findOne: jest.fn().mockReturnValue(execResult(null)) };
    panneSolutionModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
    };

    service = new WorkOrderReportService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      panneModel as never,
      panneSolutionModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('returns null for a blank code_panne without querying', async () => {
    await expect(service.resolveCorrectiveData(undefined)).resolves.toBeNull();
    expect(panneModel.findOne).not.toHaveBeenCalled();
  });

  it('returns null when no matching fault exists', async () => {
    await expect(service.resolveCorrectiveData('UNKNOWN')).resolves.toBeNull();
  });

  it('returns fault and solution details when both exist', async () => {
    panneModel.findOne.mockReturnValue(
      execResult({ code_panne: 'F1', description: 'Overheating' }),
    );
    panneSolutionModel.findOne.mockReturnValue(
      execResult({
        cause_probable: 'Blocked airflow',
        solution_recommandee: 'Clean vents',
      }),
    );

    await expect(service.resolveCorrectiveData('F1')).resolves.toEqual({
      faultCode: 'F1',
      faultDescription: 'Overheating',
      probableCause: 'Blocked airflow',
      recommendedSolution: 'Clean vents',
    });
  });
});
