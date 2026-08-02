import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MachineTimelineService } from './machine-timeline.service';
import {
  MachineTimelineCategory,
  MachineTimelineEventType,
} from './machine-timeline.types';

function chain<T>(value: T) {
  const result: {
    find: jest.Mock;
    select: jest.Mock;
    populate: jest.Mock;
    sort: jest.Mock;
    limit: jest.Mock;
    exec: jest.Mock;
  } = {
    find: jest.fn(),
    select: jest.fn(),
    populate: jest.fn(),
    sort: jest.fn(),
    limit: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  result.find.mockReturnValue(result);
  result.select.mockReturnValue(result);
  result.populate.mockReturnValue(result);
  result.sort.mockReturnValue(result);
  result.limit.mockReturnValue(result);
  return result;
}

function distinctChain<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

describe('MachineTimelineService', () => {
  const machineId = new Types.ObjectId().toString();
  const machineObjectId = new Types.ObjectId(machineId);

  function buildService(overrides: {
    machine?: unknown;
    modules?: unknown[];
    moduleIds?: unknown[];
    workOrders?: unknown[];
    workOrderIds?: unknown[];
    interventionReports?: unknown[];
    faultEvents?: unknown[];
    documents?: unknown[];
    maintenancePlans?: unknown[];
    preventiveTasks?: unknown[];
    lubricationLogs?: unknown[];
    stockMovements?: unknown[];
    aiInteractions?: unknown[];
    users?: unknown[];
  }) {
    const machine =
      overrides.machine !== undefined
        ? overrides.machine
        : {
            _id: machineObjectId,
            machine_id: 'M-1',
            status: 'operational',
            lifecycle_history: [],
          };
    const workOrders = overrides.workOrders ?? [];
    const workOrderIds =
      overrides.workOrderIds ?? workOrders.map((wo: any) => wo._id);
    const moduleIds = overrides.moduleIds ?? [];

    const machineModel = {
      findById: jest.fn().mockReturnValue(chain(machine)),
    };
    const moduleModel = {
      distinct: jest.fn().mockReturnValue(distinctChain(moduleIds)),
      find: jest.fn().mockReturnValue(chain(overrides.modules ?? [])),
    };
    const workOrderModel = {
      distinct: jest.fn().mockReturnValue(distinctChain(workOrderIds)),
      find: jest.fn().mockReturnValue(chain(workOrders)),
      select: jest.fn(),
    };
    const interventionReportModel = {
      find: jest
        .fn()
        .mockReturnValue(chain(overrides.interventionReports ?? [])),
    };
    const faultEventModel = {
      find: jest.fn().mockReturnValue(chain(overrides.faultEvents ?? [])),
    };
    const documentModel = {
      find: jest.fn().mockReturnValue(chain(overrides.documents ?? [])),
    };
    const maintenancePlanModel = {
      find: jest.fn().mockReturnValue(chain(overrides.maintenancePlans ?? [])),
    };
    const preventiveTaskModel = {
      find: jest.fn().mockReturnValue(chain(overrides.preventiveTasks ?? [])),
      findOne: jest.fn().mockReturnValue(chain(null)),
    };
    const lubricationLogModel = {
      find: jest.fn().mockReturnValue(chain(overrides.lubricationLogs ?? [])),
      findOne: jest.fn().mockReturnValue(chain(null)),
    };
    const stockMovementModel = {
      find: jest.fn().mockReturnValue(chain(overrides.stockMovements ?? [])),
      aggregate: jest.fn().mockReturnValue(distinctChain([])),
    };
    const aiInteractionModel = {
      find: jest.fn().mockReturnValue(chain(overrides.aiInteractions ?? [])),
    };
    const userModel = {
      find: jest.fn().mockReturnValue(chain(overrides.users ?? [])),
    };

    const service = new MachineTimelineService(
      machineModel as never,
      moduleModel as never,
      workOrderModel as never,
      interventionReportModel as never,
      faultEventModel as never,
      documentModel as never,
      maintenancePlanModel as never,
      preventiveTaskModel as never,
      lubricationLogModel as never,
      stockMovementModel as never,
      aiInteractionModel as never,
      userModel as never,
    );

    return { service, machineModel, userModel };
  }

  it('rejects an invalid machine id', async () => {
    const { service } = buildService({});
    await expect(service.getTimeline('not-an-id', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when the machine does not exist', async () => {
    const { service } = buildService({ machine: null });
    await expect(service.getTimeline(machineId, {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('merges events from multiple sources and sorts them newest-first', async () => {
    const workOrderId = new Types.ObjectId();
    const { service } = buildService({
      workOrders: [
        {
          _id: workOrderId,
          ot_id: 'OT-1',
          status: 'completed',
          type_maintenance: 'corrective',
          date_created: new Date('2026-01-01T00:00:00Z'),
          date_start: new Date('2026-01-02T00:00:00Z'),
          date_end: new Date('2026-01-03T00:00:00Z'),
          lifecycle_history: [],
        },
      ],
      faultEvents: [
        {
          _id: new Types.ObjectId(),
          code_panne: 'E-1',
          severity: 'critical',
          raised_at: new Date('2026-01-05T00:00:00Z'),
        },
      ],
    });

    const result = await service.getTimeline(machineId, { page: 1, limit: 20 });

    expect(result.items.map((event) => event.type)).toEqual([
      MachineTimelineEventType.FAULT_REPORTED,
      MachineTimelineEventType.WORK_ORDER_COMPLETED,
      MachineTimelineEventType.WORK_ORDER_STARTED,
      MachineTimelineEventType.WORK_ORDER_CREATED,
    ]);
    expect(result.totalItems).toBe(4);
  });

  it('filters events by category via the `types` query param', async () => {
    const workOrderId = new Types.ObjectId();
    const { service } = buildService({
      workOrders: [
        {
          _id: workOrderId,
          ot_id: 'OT-1',
          status: 'completed',
          type_maintenance: 'corrective',
          date_created: new Date('2026-01-01T00:00:00Z'),
          lifecycle_history: [],
        },
      ],
      faultEvents: [
        {
          _id: new Types.ObjectId(),
          code_panne: 'E-1',
          severity: 'critical',
          raised_at: new Date('2026-01-05T00:00:00Z'),
        },
      ],
    });

    const result = await service.getTimeline(machineId, {
      types: MachineTimelineCategory.FAULTS,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe(MachineTimelineEventType.FAULT_REPORTED);
  });

  it('filters events by a case-insensitive search term', async () => {
    const { service } = buildService({
      faultEvents: [
        {
          _id: new Types.ObjectId(),
          code_panne: 'E-1',
          severity: 'critical',
          message: 'Hydraulic pressure loss',
          raised_at: new Date('2026-01-05T00:00:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          code_panne: 'E-2',
          severity: 'warning',
          message: 'Belt slippage',
          raised_at: new Date('2026-01-04T00:00:00Z'),
        },
      ],
    });

    const result = await service.getTimeline(machineId, {
      search: 'hydraulic',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].description).toContain('Hydraulic');
  });

  it('paginates the merged, sorted event set', async () => {
    const faultEvents = Array.from({ length: 5 }).map((_, index) => ({
      _id: new Types.ObjectId(),
      code_panne: `E-${index}`,
      severity: 'warning',
      raised_at: new Date(2026, 0, index + 1),
    }));
    const { service } = buildService({ faultEvents });

    const result = await service.getTimeline(machineId, { page: 2, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.totalItems).toBe(5);
    expect(result.totalPages).toBe(3);
    // Newest first overall: index 4, 3, 2, 1, 0 — page 2 (limit 2) is [2, 1].
    expect(result.items.map((event) => event.metadata?.faultCode)).toEqual([
      'E-2',
      'E-1',
    ]);
  });

  it('resolves actor names in a single batched query', async () => {
    const actorId = new Types.ObjectId();
    const { service, userModel } = buildService({
      faultEvents: [
        {
          _id: new Types.ObjectId(),
          code_panne: 'E-1',
          severity: 'critical',
          raised_at: new Date('2026-01-05T00:00:00Z'),
          resolved_at: new Date('2026-01-06T00:00:00Z'),
          resolved_by: actorId,
        },
      ],
      users: [{ _id: actorId, nom_complet: 'Jane Tech', role: 'technician' }],
    });

    const result = await service.getTimeline(machineId, {});

    expect(userModel.find).toHaveBeenCalledTimes(1);
    const resolvedEvent = result.items.find(
      (event) => event.type === MachineTimelineEventType.FAULT_RESOLVED,
    );
    expect(resolvedEvent?.actor).toEqual({
      id: actorId.toString(),
      name: 'Jane Tech',
      role: 'technician',
    });
  });

  describe('getSummary', () => {
    it('computes open/closed work order counts and downtime', async () => {
      const { service } = buildService({
        workOrders: [
          {
            status: 'completed',
            type_maintenance: 'preventive',
            date_start: new Date('2026-01-01T00:00:00Z'),
            date_end: new Date('2026-01-01T04:00:00Z'),
          },
          {
            status: 'in_progress',
            type_maintenance: 'corrective',
          },
        ],
        machine: {
          _id: machineObjectId,
          machine_id: 'M-1',
          serial_no: 'SN-1',
          status: 'operational',
          type_id: { _id: new Types.ObjectId(), name: 'Press' },
        },
      });

      const summary = await service.getSummary(machineId);

      expect(summary.stats.openWorkOrders).toBe(1);
      expect(summary.stats.closedWorkOrders).toBe(1);
      expect(summary.stats.preventiveCompleted).toBe(1);
      expect(summary.stats.correctiveCompleted).toBe(0);
      expect(summary.stats.downtimeHours).toBe(4);
      expect(summary.machine.type).toEqual({
        id: expect.any(String),
        name: 'Press',
      });
    });
  });
});
