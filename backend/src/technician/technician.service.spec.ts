import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { TechnicianService } from './technician.service';
import { Role } from '../schemas/user.schema';

function execResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function sessionChain<T>(value: T) {
  return { session: jest.fn().mockReturnValue(execResult(value)) };
}

function createSessionMock() {
  return {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

function createTechnicianService(deps: {
  workOrdersModel?: unknown;
  reportsModel?: unknown;
  machinesModel?: unknown;
  modulesModel?: unknown;
  maintenancePlansModel?: unknown;
  documentsModel?: unknown;
  partsModel?: unknown;
  catalogueModel?: unknown;
  stockModel?: unknown;
  capteursModel?: unknown;
  mesuresModel?: unknown;
  workOrdersService?: unknown;
  workOrderAssignmentService?: unknown;
  workOrderLifecycleService?: unknown;
  documentAccessService?: unknown;
  notificationCenterService?: unknown;
  stockMovementsService?: unknown;
  kpiService?: unknown;
}) {
  return new TechnicianService(
    (deps.workOrdersModel ?? {}) as never,
    (deps.reportsModel ?? {}) as never,
    (deps.machinesModel ?? {}) as never,
    (deps.modulesModel ?? {}) as never,
    (deps.maintenancePlansModel ?? {}) as never,
    (deps.documentsModel ?? {}) as never,
    (deps.partsModel ?? {}) as never,
    (deps.catalogueModel ?? {}) as never,
    (deps.stockModel ?? {}) as never,
    (deps.capteursModel ?? {}) as never,
    (deps.mesuresModel ?? {}) as never,
    (deps.workOrdersService ?? {}) as never,
    (deps.workOrderAssignmentService ?? {}) as never,
    (deps.workOrderLifecycleService ?? {}) as never,
    (deps.documentAccessService ?? {}) as never,
    (deps.notificationCenterService ?? {}) as never,
    (deps.stockMovementsService ?? {}) as never,
    (deps.kpiService ?? {}) as never,
  );
}

describe('TechnicianService authorization policy', () => {
  const technicianId = new Types.ObjectId().toHexString();
  const machineId = new Types.ObjectId();
  let workOrdersModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let documentsModel: {
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let documentAccessService: {
    listAccessibleMachineIds: jest.Mock;
    assertCanAccessMachine: jest.Mock;
  };
  let workOrderAssignmentService: { claimForTechnician: jest.Mock };
  let service: TechnicianService;

  beforeEach(() => {
    workOrdersModel = {
      findOne: jest.fn().mockReturnValue(execResult(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(execResult(null)),
    };
    documentsModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      countDocuments: jest.fn().mockReturnValue(execResult(0)),
    };
    documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue([machineId]),
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };
    workOrderAssignmentService = {
      claimForTechnician: jest
        .fn()
        .mockRejectedValue(
          new Error('Work order is closed or already assigned'),
        ),
    };
    service = createTechnicianService({
      workOrdersModel,
      documentsModel,
      workOrderAssignmentService,
      documentAccessService,
      notificationCenterService: {
        createIfNotExists: jest.fn().mockResolvedValue(null),
      },
    });
  });

  it('limits visible work orders to own records and explicitly claimable assigned-machine records', async () => {
    const scope = await (
      service as unknown as {
        visibleScope(id: string): Promise<Record<string, unknown>>;
      }
    ).visibleScope(technicianId);

    expect(documentAccessService.listAccessibleMachineIds).toHaveBeenCalledWith(
      {
        userId: technicianId,
        role: Role.TECHNICIAN,
      },
    );
    expect(scope).toEqual({
      $or: [
        {
          technician_id: {
            $in: [new Types.ObjectId(technicianId), technicianId],
          },
        },
        {
          machine_id: { $in: [machineId] },
          status: {
            $nin: [
              'completed',
              'validated',
              'cancelled',
              'canceled',
              'CLOTURE',
              'ANNULE',
            ],
          },
          $or: [{ technician_id: { $exists: false } }, { technician_id: null }],
        },
      ],
    });
  });

  it('blocks unassigned claims when no assigned-machine claimable scope exists', async () => {
    documentAccessService.listAccessibleMachineIds.mockResolvedValue([]);

    await expect(
      service.claim(technicianId, new Types.ObjectId().toHexString()),
    ).rejects.toThrow('Work order is closed or already assigned');

    expect(workOrderAssignmentService.claimForTechnician).toHaveBeenCalledWith({
      technicianId,
      workOrderId: expect.any(String),
      accessibleMachineIds: [],
    });
  });

  it('requires document machine authorization before returning technician manuals for a requested machine', async () => {
    const forbidden = new ForbiddenException(
      'Technician is not authorized for this machine',
    );
    documentAccessService.assertCanAccessMachine.mockRejectedValue(forbidden);

    await expect(
      service.manuals(
        technicianId,
        { page: 1, limit: 20, skip: 0 },
        machineId.toHexString(),
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      { userId: technicianId, role: Role.TECHNICIAN },
      machineId.toHexString(),
    );
    expect(documentsModel.find).not.toHaveBeenCalled();
  });
});

describe('TechnicianService.details', () => {
  const technicianId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId();
  const machineId = new Types.ObjectId();

  function populateChain(value: unknown) {
    const chain: { populate: jest.Mock; exec: jest.Mock } = {
      populate: jest.fn(),
      exec: jest.fn().mockResolvedValue(value),
    };
    chain.populate.mockReturnValue(chain);
    return chain;
  }

  let workOrdersModel: { findOne: jest.Mock };
  let reportsModel: { findOne: jest.Mock };
  let partsModel: { find: jest.Mock };
  let documentsModel: { find: jest.Mock };
  let stockModel: { find: jest.Mock };
  let documentAccessService: {
    listAccessibleMachineIds: jest.Mock;
    assertCanAccessMachine: jest.Mock;
  };
  let service: TechnicianService;

  function buildService() {
    return createTechnicianService({
      workOrdersModel,
      reportsModel,
      documentsModel,
      partsModel,
      stockModel,
      documentAccessService,
      notificationCenterService: {
        createIfNotExists: jest.fn().mockResolvedValue(null),
      },
    });
  }

  beforeEach(() => {
    workOrdersModel = {
      findOne: jest.fn().mockReturnValue(populateChain(null)),
    };
    reportsModel = { findOne: jest.fn().mockReturnValue(populateChain(null)) };
    partsModel = { find: jest.fn().mockReturnValue(populateChain([])) };
    documentsModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };
    stockModel = { find: jest.fn().mockReturnValue(populateChain([])) };
    documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue([machineId]),
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };
    service = buildService();
  });

  it('throws NotFoundException when the work order is outside the visible scope', async () => {
    workOrdersModel.findOne.mockReturnValue(populateChain(null));

    await expect(
      service.details(technicianId, workOrderId.toHexString()),
    ).rejects.toThrow(NotFoundException);

    expect(documentAccessService.assertCanAccessMachine).not.toHaveBeenCalled();
  });

  it('authorizes the work order machine once it is found in the visible scope, using the work order own machine_id', async () => {
    workOrdersModel.findOne.mockReturnValue(
      populateChain({
        _id: workOrderId,
        machine_id: machineId,
        technician_id: technicianId,
      }),
    );

    const result = await service.details(
      technicianId,
      workOrderId.toHexString(),
    );

    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      { userId: technicianId, role: Role.TECHNICIAN },
      machineId.toHexString(),
    );
    expect(result.workOrder).toEqual(
      expect.objectContaining({ _id: workOrderId.toHexString() }),
    );
  });

  it('propagates a machine-authorization rejection as a 403 even though the work order itself was already found', async () => {
    workOrdersModel.findOne.mockReturnValue(
      populateChain({
        _id: workOrderId,
        machine_id: machineId,
        technician_id: null,
      }),
    );
    documentAccessService.assertCanAccessMachine.mockRejectedValue(
      new ForbiddenException('Technician is not authorized for this machine'),
    );

    await expect(
      service.details(technicianId, workOrderId.toHexString()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('skips machine authorization when the work order has no resolvable machine_id', async () => {
    workOrdersModel.findOne.mockReturnValue(
      populateChain({
        _id: workOrderId,
        machine_id: null,
        technician_id: technicianId,
      }),
    );

    await service.details(technicianId, workOrderId.toHexString());

    expect(documentAccessService.assertCanAccessMachine).not.toHaveBeenCalled();
  });

  it('never fetches the full technician User document — populate is restricted to a safe projection', async () => {
    const workOrderChain = populateChain({
      _id: workOrderId,
      machine_id: null,
      technician_id: technicianId,
    });
    workOrdersModel.findOne.mockReturnValue(workOrderChain);

    await service.details(technicianId, workOrderId.toHexString());

    expect(workOrderChain.populate).toHaveBeenCalledWith(
      'technician_id',
      'nom_complet user_id role',
    );
    expect(workOrderChain.populate).not.toHaveBeenCalledWith('technician_id');
  });
});

describe('TechnicianService.workOrders — technician projection', () => {
  const technicianId = new Types.ObjectId().toHexString();

  function populateChain(value: unknown) {
    const chain: { populate: jest.Mock; exec: jest.Mock } = {
      populate: jest.fn(),
      exec: jest.fn().mockResolvedValue(value),
    };
    chain.populate.mockReturnValue(chain);
    return chain;
  }

  let workOrdersModel: {
    aggregate: jest.Mock;
    countDocuments: jest.Mock;
    find: jest.Mock;
  };
  let reportsModel: { find: jest.Mock };
  let documentAccessService: { listAccessibleMachineIds: jest.Mock };
  let findChain: { populate: jest.Mock; exec: jest.Mock };
  let service: TechnicianService;

  beforeEach(() => {
    findChain = populateChain([]);
    workOrdersModel = {
      aggregate: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      countDocuments: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
      find: jest.fn().mockReturnValue(findChain),
    };
    reportsModel = { find: jest.fn().mockReturnValue(populateChain([])) };
    documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue([]),
    };
    service = new TechnicianService(
      workOrdersModel as never,
      reportsModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      documentAccessService as never,
      { createIfNotExists: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
    );
  });

  it('never fetches the full technician User document on the list endpoint either', async () => {
    await service.workOrders(technicianId, { page: 1, limit: 10, skip: 0 }, {});

    expect(findChain.populate).toHaveBeenCalledWith(
      'technician_id',
      'nom_complet user_id role',
    );
    expect(findChain.populate).not.toHaveBeenCalledWith('technician_id');
  });
});

describe('TechnicianService.close notifications', () => {
  const technicianId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId().toHexString();
  const reportId = new Types.ObjectId();
  const machineId = new Types.ObjectId();

  let workOrdersModel: { findOneAndUpdate: jest.Mock };
  let reportsModel: { findOne: jest.Mock; updateOne: jest.Mock };
  let workOrderLifecycleService: {
    requireInterventionReport: jest.Mock;
    closeForTechnician: jest.Mock;
  };
  let notificationCenterService: { createIfNotExists: jest.Mock };
  let service: TechnicianService;

  beforeEach(() => {
    workOrdersModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(
        execResult({
          _id: workOrderId,
          ot_id: 'WO-COR-000001',
          machine_id: machineId,
        }),
      ),
    };
    reportsModel = {
      findOne: jest.fn().mockReturnValue(
        execResult({
          _id: reportId,
          description_action: 'Replaced belt',
          etat_final: 'resolved',
        }),
      ),
      updateOne: jest.fn().mockReturnValue(execResult({})),
    };
    notificationCenterService = {
      createIfNotExists: jest.fn().mockResolvedValue(null),
    };
    workOrderLifecycleService = {
      requireInterventionReport: jest.fn().mockResolvedValue({
        _id: reportId,
        description_action: 'Replaced belt',
        etat_final: 'resolved',
      }),
      closeForTechnician: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(workOrderId),
        ot_id: 'WO-COR-000001',
        machine_id: machineId,
      }),
    };

    service = new TechnicianService(
      workOrdersModel as never,
      reportsModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      workOrderLifecycleService as never,
      {} as never,
      notificationCenterService as never,
      {} as never,
      {} as never,
    );
  });

  it('notifies Admins that an intervention was completed', async () => {
    await service.close(technicianId, workOrderId);

    expect(notificationCenterService.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'intervention_completed',
        recipientRole: 'admin',
        workOrderId,
        referenceId: reportId.toString(),
      }),
    );
  });

  it('submits the closed work for independent validation instead of self-completing', async () => {
    await service.close(technicianId, workOrderId);

    expect(workOrderLifecycleService.closeForTechnician).toHaveBeenCalledWith({
      technicianId,
      workOrderId,
      report: expect.objectContaining({ _id: reportId }),
    });
  });

  it('does not notify when the work order cannot be closed (not in progress)', async () => {
    workOrderLifecycleService.closeForTechnician.mockRejectedValue(
      new ConflictException('Work order must be in progress before closing'),
    );

    await expect(service.close(technicianId, workOrderId)).rejects.toThrow(
      'Work order must be in progress before closing',
    );
    expect(notificationCenterService.createIfNotExists).not.toHaveBeenCalled();
  });
});

describe('TechnicianService.review', () => {
  const technicianId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId().toHexString();

  let workOrdersModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock };
  let reportsModel: { updateOne: jest.Mock };
  let documentAccessService: { listAccessibleMachineIds: jest.Mock };
  let workOrdersService: { applyValidationAction: jest.Mock };
  let workOrderLifecycleService: { startForTechnician: jest.Mock };
  let service: TechnicianService;

  beforeEach(() => {
    workOrdersModel = {
      findOne: jest
        .fn()
        .mockReturnValue(
          execResult({ _id: workOrderId, status: 'waiting_validation' }),
        ),
      findOneAndUpdate: jest.fn().mockReturnValue(execResult(null)),
    };
    reportsModel = {
      updateOne: jest.fn().mockReturnValue(execResult({})),
    };
    documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue([]),
    };
    workOrdersService = {
      applyValidationAction: jest
        .fn()
        .mockResolvedValue({ status: 'returned' }),
    };
    workOrderLifecycleService = {
      startForTechnician: jest
        .fn()
        .mockResolvedValue({ _id: workOrderId, status: 'in_progress' }),
    };
    service = new TechnicianService(
      workOrdersModel as never,
      reportsModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      workOrdersService as never,
      {} as never,
      workOrderLifecycleService as never,
      documentAccessService as never,
      { createIfNotExists: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
    );
  });

  it('rejects an "approve" action outright — a technician can never validate their own actionable work', async () => {
    await expect(
      service.review(technicianId, workOrderId, 'approve' as never),
    ).rejects.toThrow(BadRequestException);
    expect(workOrdersService.applyValidationAction).not.toHaveBeenCalled();
  });

  it('sends a "return" action to applyValidationAction as request_correction, scoped to the caller', async () => {
    await service.review(technicianId, workOrderId, 'return');

    expect(workOrdersService.applyValidationAction).toHaveBeenCalledWith(
      workOrderId,
      'request_correction',
      technicianId,
    );
  });

  it('delegates an "intervene" action to start()', async () => {
    const result = await service.review(technicianId, workOrderId, 'intervene');

    expect(result).toEqual(expect.objectContaining({ status: 'in_progress' }));
    expect(workOrderLifecycleService.startForTechnician).toHaveBeenCalledWith({
      technicianId,
      workOrderId,
      accessibleMachineIds: [],
    });
    expect(workOrdersService.applyValidationAction).not.toHaveBeenCalled();
  });
});

describe('TechnicianService.setPartQuantity', () => {
  const technicianId = new Types.ObjectId().toHexString();
  const workOrderId = new Types.ObjectId();
  const partId = new Types.ObjectId();
  const stockId = new Types.ObjectId();

  let workOrdersModel: {
    findOne: jest.Mock;
    db: { startSession: jest.Mock };
  };
  let catalogueModel: { findById: jest.Mock };
  let partsModel: { findOne: jest.Mock; create: jest.Mock };
  let stockModel: { findOne: jest.Mock };
  let stockMovementsService: { recordUsageChange: jest.Mock };
  let session: ReturnType<typeof createSessionMock>;
  let service: TechnicianService;

  beforeEach(() => {
    session = createSessionMock();
    workOrdersModel = {
      findOne: jest
        .fn()
        .mockReturnValue(
          sessionChain({ _id: workOrderId, status: 'in_progress' }),
        ),
      db: { startSession: jest.fn().mockResolvedValue(session) },
    };
    catalogueModel = {
      findById: jest.fn().mockReturnValue(sessionChain({ _id: partId })),
    };
    partsModel = {
      findOne: jest.fn().mockReturnValue(sessionChain(null)),
      create: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          ot_id: workOrderId,
          part_id: partId,
          quantite: 4,
        },
      ]),
    };
    stockModel = {
      findOne: jest.fn().mockReturnValue(sessionChain({ _id: stockId })),
    };
    stockMovementsService = {
      recordUsageChange: jest.fn().mockResolvedValue({}),
    };

    service = new TechnicianService(
      workOrdersModel as never,
      {} as never,
      {} as never,
      {} as never,
      partsModel as never,
      catalogueModel as never,
      stockModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      stockMovementsService as never,
      {} as never,
    );
  });

  it('rejects a missing part id', async () => {
    await expect(
      service.setPartQuantity(
        technicianId,
        workOrderId.toHexString(),
        undefined,
        4,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-positive or non-integer quantity', async () => {
    await expect(
      service.setPartQuantity(
        technicianId,
        workOrderId.toHexString(),
        partId.toHexString(),
        0,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.setPartQuantity(
        technicianId,
        workOrderId.toHexString(),
        partId.toHexString(),
        1.5,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when the work order is not available for parts', async () => {
    workOrdersModel.findOne.mockReturnValue(sessionChain(null));

    await expect(
      service.setPartQuantity(
        technicianId,
        workOrderId.toHexString(),
        partId.toHexString(),
        4,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(stockMovementsService.recordUsageChange).not.toHaveBeenCalled();
  });

  it('rejects an unknown catalogue part', async () => {
    catalogueModel.findById.mockReturnValue(sessionChain(null));

    await expect(
      service.setPartQuantity(
        technicianId,
        workOrderId.toHexString(),
        partId.toHexString(),
        4,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('creates a new part usage row and records a Consumption movement for the first-time quantity', async () => {
    const result = await service.setPartQuantity(
      technicianId,
      workOrderId.toHexString(),
      partId.toHexString(),
      4,
    );

    expect(stockModel.findOne).toHaveBeenCalledWith({ part_id: partId });
    expect(stockMovementsService.recordUsageChange).toHaveBeenCalledWith(
      session,
      {
        stockId: stockId.toString(),
        partId: partId.toString(),
        delta: 4,
        workOrderId: workOrderId.toString(),
        actorId: technicianId,
      },
    );
    expect(partsModel.create).toHaveBeenCalledWith(
      [{ ot_id: workOrderId, part_id: partId, quantite: 4 }],
      { session },
    );
    expect(session.endSession).toHaveBeenCalled();
    expect(result).toMatchObject({
      ot_id: workOrderId.toString(),
      part_id: partId.toString(),
      quantite: 4,
    });
  });

  it('records only the incremental delta as Consumption when quantity increases on an existing row', async () => {
    const existing = {
      quantite: 3,
      save: jest.fn().mockResolvedValue({ quantite: 7 }),
    };
    partsModel.findOne.mockReturnValue(sessionChain(existing));

    await service.setPartQuantity(
      technicianId,
      workOrderId.toHexString(),
      partId.toHexString(),
      7,
    );

    expect(stockMovementsService.recordUsageChange).toHaveBeenCalledWith(
      session,
      {
        stockId: stockId.toString(),
        partId: partId.toString(),
        delta: 4,
        workOrderId: workOrderId.toString(),
        actorId: technicianId,
      },
    );
    expect(existing.quantite).toBe(7);
    expect(existing.save).toHaveBeenCalledWith({ session });
  });

  it('records a negative delta as a Return when the corrected quantity is lower than before', async () => {
    const existing = {
      quantite: 10,
      save: jest.fn().mockResolvedValue({ quantite: 6 }),
    };
    partsModel.findOne.mockReturnValue(sessionChain(existing));

    await service.setPartQuantity(
      technicianId,
      workOrderId.toHexString(),
      partId.toHexString(),
      6,
    );

    expect(stockMovementsService.recordUsageChange).toHaveBeenCalledWith(
      session,
      {
        stockId: stockId.toString(),
        partId: partId.toString(),
        delta: -4,
        workOrderId: workOrderId.toString(),
        actorId: technicianId,
      },
    );
  });

  it('skips Stock entirely when the corrected quantity matches what was already recorded', async () => {
    const existing = {
      quantite: 5,
      save: jest.fn().mockResolvedValue({ quantite: 5 }),
    };
    partsModel.findOne.mockReturnValue(sessionChain(existing));

    await service.setPartQuantity(
      technicianId,
      workOrderId.toHexString(),
      partId.toHexString(),
      5,
    );

    expect(stockModel.findOne).not.toHaveBeenCalled();
    expect(stockMovementsService.recordUsageChange).not.toHaveBeenCalled();
    expect(existing.save).toHaveBeenCalledWith({ session });
  });

  it('throws when no stock record exists for the part being consumed or returned', async () => {
    stockModel.findOne.mockReturnValue(sessionChain(null));

    await expect(
      service.setPartQuantity(
        technicianId,
        workOrderId.toHexString(),
        partId.toHexString(),
        4,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(stockMovementsService.recordUsageChange).not.toHaveBeenCalled();
  });
});
