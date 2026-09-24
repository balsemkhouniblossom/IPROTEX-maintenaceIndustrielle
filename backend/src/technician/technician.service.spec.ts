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

  it('shows technician own records and all claimable unassigned orders', async () => {
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

  it('allows an unassigned order to be claimed even without a prior machine assignment', async () => {
    documentAccessService.listAccessibleMachineIds.mockResolvedValue([]);
    workOrderAssignmentService.claimForTechnician.mockResolvedValue({
      _id: new Types.ObjectId(),
    });

    await expect(
      service.claim(technicianId, new Types.ObjectId().toHexString()),
    ).resolves.toEqual(expect.objectContaining({ _id: expect.any(String) }));

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

describe('TechnicianService dashboard and machine context', () => {
  const technicianId = new Types.ObjectId().toHexString();
  const machineId = new Types.ObjectId();

  function query<T>(value: T) {
    const result = {
      find: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      sort: jest.fn(),
      skip: jest.fn(),
      limit: jest.fn(),
      select: jest.fn(),
      populate: jest.fn(),
      aggregate: jest.fn(),
      exec: jest.fn().mockResolvedValue(value),
    };
    for (const method of [
      'find',
      'findOne',
      'findById',
      'sort',
      'skip',
      'limit',
      'select',
      'populate',
      'aggregate',
    ] as const) {
      result[method].mockReturnValue(result);
    }
    return result;
  }

  it('builds an empty dashboard with shared KPI counts and authorized manual scope', async () => {
    const workOrderQuery = query([]);
    const documentsQuery = query([]);
    const workOrdersModel = {
      countDocuments: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockReturnValue(workOrderQuery),
    };
    const documentsModel = {
      aggregate: jest.fn().mockReturnValue(documentsQuery),
      populate: jest.fn().mockResolvedValue([]),
    };
    const documentAccessService = {
      listAccessibleMachineIds: jest.fn().mockResolvedValue([machineId]),
    };
    const kpiService = {
      getTechnicianDashboardCounts: jest.fn().mockResolvedValue({
        completedTodayCount: 1,
        overdueCount: 2,
        dueTodayCount: 3,
        waitingValidationCount: 4,
      }),
    };
    const service = createTechnicianService({
      workOrdersModel,
      reportsModel: { find: jest.fn().mockReturnValue(query([])) },
      machinesModel: { collection: { name: 'machines' } },
      documentsModel,
      documentAccessService,
      kpiService,
    });

    await expect(service.dashboard(technicianId)).resolves.toEqual({
      counters: {
        assigned: 0,
        inProgress: 0,
        waitingParts: 0,
        waitingReview: 0,
        completedToday: 1,
        urgent: 0,
        overdue: 2,
        dueToday: 3,
        waitingValidation: 4,
      },
      urgentTasks: [],
      current: [],
      waitingPartsTasks: [],
      upcoming: [],
      recent: [],
      manuals: [],
    });
    expect(kpiService.getTechnicianDashboardCounts).toHaveBeenCalledWith(
      technicianId,
    );
    expect(documentsModel.populate).toHaveBeenCalledWith([], {
      path: 'machine_id',
      populate: { path: 'type_id' },
    });
  });

  it('returns a machine context with safe empty optional collections', async () => {
    const machine = {
      _id: machineId,
      machine_id: 'M-100',
      reference: 'PRESS-100',
      status: 'active',
    };
    const emptyQuery = () => query([]);
    const workOrdersModel = {
      find: jest.fn().mockImplementation(emptyQuery),
    };
    const service = createTechnicianService({
      workOrdersModel,
      reportsModel: { find: jest.fn().mockImplementation(emptyQuery) },
      machinesModel: {
        findById: jest.fn().mockReturnValue(query(machine)),
      },
      modulesModel: { find: jest.fn().mockImplementation(emptyQuery) },
      maintenancePlansModel: {
        find: jest.fn().mockImplementation(emptyQuery),
      },
      documentsModel: { find: jest.fn().mockImplementation(emptyQuery) },
      partsModel: { aggregate: jest.fn().mockImplementation(emptyQuery) },
      capteursModel: { find: jest.fn().mockImplementation(emptyQuery) },
      mesuresModel: { findOne: jest.fn().mockReturnValue(query(null)) },
      documentAccessService: {
        assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
        listAccessibleMachineIds: jest.fn().mockResolvedValue([machineId]),
      },
    });

    const result = await service.machineContext(
      technicianId,
      machineId.toHexString(),
    );

    expect(result.machine).toMatchObject({ machine_id: 'M-100' });
    expect(result.components).toEqual([]);
    expect(result.openWork).toEqual([]);
    expect(result.upcomingPreventive).toEqual([]);
    expect(result.recentMaintenance).toEqual([]);
    expect(result.documents).toEqual([]);
    expect(result.summary.stats).toMatchObject({
      totalInterventions: 0,
      openWorkOrders: 0,
      closedWorkOrders: 0,
      averageRepairTimeHours: null,
      partsConsumed: 0,
    });
  });

  it('adds scoped maintenance statistics to each authorized machine', async () => {
    const machine = {
      _id: machineId,
      machine_id: 'M-100',
      reference: 'PRESS-100',
      status: 'active',
    };
    const machinesModel = {
      find: jest.fn().mockReturnValue(query([machine])),
      countDocuments: jest.fn().mockReturnValue(query(1)),
    };
    const workOrdersModel = {
      countDocuments: jest.fn().mockReturnValue(query(2)),
      findOne: jest
        .fn()
        .mockReturnValueOnce(
          query({ date_closed: new Date('2026-09-10T08:00:00.000Z') }),
        )
        .mockReturnValueOnce(
          query({ due_date: new Date('2026-09-25T08:00:00.000Z') }),
        ),
    };
    const service = createTechnicianService({
      machinesModel,
      workOrdersModel,
      documentAccessService: {
        listAccessibleMachineIds: jest.fn().mockResolvedValue([machineId]),
      },
    });

    const result = await service.machines(technicianId, {
      page: 1,
      limit: 20,
      skip: 0,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      machine_id: 'M-100',
      technicianSummary: {
        stats: {
          openWorkOrders: 2,
          lastMaintenanceAt: '2026-09-10T08:00:00.000Z',
          nextMaintenanceAt: '2026-09-25T08:00:00.000Z',
        },
      },
    });
  });

  it('calculates preventive/corrective counts, downtime, and date boundaries', async () => {
    const workOrders = [
      {
        status: 'completed',
        type_maintenance: 'preventive',
        date_start: new Date('2026-09-01T08:00:00.000Z'),
        date_end: new Date('2026-09-01T10:00:00.000Z'),
        date_closed: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        status: 'validated',
        type_maintenance: 'corrective',
        date_start: new Date('2026-09-02T08:00:00.000Z'),
        date_closed: new Date('2026-09-02T11:00:00.000Z'),
      },
      {
        status: 'scheduled',
        type_maintenance: 'preventive',
        due_date: new Date('2026-09-25T08:00:00.000Z'),
      },
    ];
    const service = createTechnicianService({
      workOrdersModel: { find: jest.fn().mockReturnValue(query(workOrders)) },
      partsModel: {
        aggregate: jest.fn().mockReturnValue(query([{ total: 7 }])),
      },
    });

    const stats = await (
      service as unknown as {
        getTechnicianMachineStats(
          id: Types.ObjectId,
          scope: Record<string, unknown>,
        ): Promise<Record<string, unknown>>;
      }
    ).getTechnicianMachineStats(machineId, {});

    expect(stats).toMatchObject({
      totalInterventions: 3,
      preventiveCompleted: 1,
      correctiveCompleted: 1,
      openWorkOrders: 1,
      closedWorkOrders: 2,
      downtimeHours: 5,
      averageRepairTimeHours: 2.5,
      partsConsumed: 7,
      lastMaintenanceAt: '2026-09-02T11:00:00.000Z',
      nextMaintenanceAt: '2026-09-25T08:00:00.000Z',
    });
  });

  it('delegates technician lifecycle, part-request, report, manual, and stock workflows', async () => {
    const workOrderId = new Types.ObjectId();
    const partId = new Types.ObjectId();
    const workOrder = {
      _id: workOrderId,
      ot_id: 'OT-100',
      status: 'in_progress',
      type_maintenance: 'corrective',
    };
    const report = {
      _id: new Types.ObjectId(),
      report_id: 'RPT-100',
      ot_id: workOrderId,
      technician_id: new Types.ObjectId(technicianId),
      cause_racine: 'Bearing wear',
    };
    const stock = {
      _id: new Types.ObjectId(),
      stock_id: 'STK-1',
      part_id: partId,
      quantite_en_stock: 5,
    };
    const document = {
      _id: new Types.ObjectId(),
      document_id: 'DOC-1',
      file_name: 'manual.pdf',
      type_document: 'manual',
    };
    const workOrdersModel = {
      findOne: jest.fn().mockReturnValue(query(workOrder)),
    };
    const reportsModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(query(report)),
    };
    const workOrderLifecycleService = {
      startForTechnician: jest.fn().mockResolvedValue(workOrder),
      transitionForTechnician: jest.fn().mockResolvedValue(workOrder),
    };
    const workOrdersService = {
      requestPartsForOperator: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        request_id: 'REQ-1',
        ot_id: workOrderId,
        part_id: partId,
        status: 'pending',
        quantity: 2,
      }),
    };
    const service = createTechnicianService({
      workOrdersModel,
      reportsModel,
      stockModel: {
        find: jest.fn().mockReturnValue(query([stock])),
        countDocuments: jest.fn().mockReturnValue(query(1)),
      },
      documentsModel: {
        find: jest.fn().mockReturnValue(query([document])),
        countDocuments: jest.fn().mockReturnValue(query(1)),
      },
      documentAccessService: {
        listAccessibleMachineIds: jest.fn().mockResolvedValue([machineId]),
        assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
      },
      workOrderLifecycleService,
      workOrdersService,
    });

    await expect(
      service.manuals(
        technicianId,
        { page: 1, limit: 20, skip: 0 },
        machineId.toHexString(),
      ),
    ).resolves.toMatchObject({ totalItems: 1 });
    await expect(
      service.availableParts(technicianId, { page: 1, limit: 20, skip: 0 }),
    ).resolves.toMatchObject({ totalItems: 1 });
    await expect(
      service.start(technicianId, workOrderId.toHexString()),
    ).resolves.toMatchObject({ ot_id: 'OT-100' });
    await expect(
      service.waitingParts(technicianId, workOrderId.toHexString()),
    ).resolves.toMatchObject({ ot_id: 'OT-100' });
    await expect(
      service.resume(technicianId, workOrderId.toHexString()),
    ).resolves.toMatchObject({ ot_id: 'OT-100' });
    await expect(
      service.updateReport(technicianId, workOrderId.toHexString(), {
        cause_racine: 'Bearing wear',
        description_action: 'Replaced bearing',
      }),
    ).resolves.toMatchObject({ report_id: 'RPT-100' });
    await expect(
      service.requestPart(
        technicianId,
        workOrderId.toHexString(),
        partId.toHexString(),
        2,
      ),
    ).resolves.toMatchObject({ status: 'pending' });

    expect(
      workOrderLifecycleService.transitionForTechnician,
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ from: ['in_progress'], to: 'waiting_parts' }),
    );
    expect(
      workOrderLifecycleService.transitionForTechnician,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ from: ['waiting_parts'], to: 'in_progress' }),
    );
    expect(workOrdersService.requestPartsForOperator).toHaveBeenCalledWith({
      operatorId: technicianId,
      workOrderId: workOrderId.toHexString(),
      partId: partId.toHexString(),
      quantity: 2,
    });
  });

  it('rejects a missing machine after authorization and data loading', async () => {
    const emptyQuery = () => query([]);
    const service = createTechnicianService({
      workOrdersModel: { find: jest.fn().mockImplementation(emptyQuery) },
      reportsModel: { find: jest.fn().mockImplementation(emptyQuery) },
      machinesModel: { findById: jest.fn().mockReturnValue(query(null)) },
      modulesModel: { find: jest.fn().mockImplementation(emptyQuery) },
      maintenancePlansModel: {
        find: jest.fn().mockImplementation(emptyQuery),
      },
      documentsModel: { find: jest.fn().mockImplementation(emptyQuery) },
      partsModel: { aggregate: jest.fn().mockImplementation(emptyQuery) },
      documentAccessService: {
        assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
        listAccessibleMachineIds: jest.fn().mockResolvedValue([machineId]),
      },
    });

    await expect(
      service.machineContext(technicianId, machineId.toHexString()),
    ).rejects.toThrow('Machine not found');
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

  it('allows the assigned technician to open the work order without a second machine-access rejection', async () => {
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

    expect(documentAccessService.assertCanAccessMachine).not.toHaveBeenCalled();
    expect(result.workOrder).toEqual(
      expect.objectContaining({ _id: workOrderId.toHexString() }),
    );
  });

  it('lets every technician inspect an unassigned claimable work order', async () => {
    workOrdersModel.findOne.mockReturnValue(
      populateChain({
        _id: workOrderId,
        machine_id: machineId,
        technician_id: null,
      }),
    );

    await service.details(technicianId, workOrderId.toHexString());

    expect(documentAccessService.assertCanAccessMachine).not.toHaveBeenCalled();
  });

  it('does not apply machine authorization to an unassigned claimable work order', async () => {
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
    ).resolves.toEqual(
      expect.objectContaining({
        workOrder: expect.objectContaining({
          _id: workOrderId.toHexString(),
        }),
      }),
    );
    expect(documentAccessService.assertCanAccessMachine).not.toHaveBeenCalled();
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

  it('never fetches the full technician User document â€” populate is restricted to a safe projection', async () => {
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

describe('TechnicianService.workOrders â€” technician projection', () => {
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

  it('rejects an "approve" action outright â€” a technician can never validate their own actionable work', async () => {
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
