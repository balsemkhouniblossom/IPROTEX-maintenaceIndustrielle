import { Types } from 'mongoose';
import { AiContextBuilderService } from './ai-context-builder.service';
import { FaultEventSeverity } from '../schemas/fault-event.schema';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

function findByIdStub(result: unknown) {
  return jest.fn().mockReturnValue(execResolves(result));
}

function findOneStub(result: unknown) {
  return jest.fn().mockReturnValue(execResolves(result));
}

function findChainStub(result: unknown[]) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  };
  return jest.fn().mockReturnValue(chain);
}

describe('AiContextBuilderService', () => {
  const machineId = new Types.ObjectId().toString();
  const machineTypeId = new Types.ObjectId();

  function buildService(
    overrides: {
      machine?: unknown;
      machineType?: unknown;
      panne?: unknown;
      panneSolution?: unknown;
      faultEvents?: unknown[];
      workOrders?: unknown[];
      interventionReports?: unknown[];
      knowledgeArticles?: unknown[];
    } = {},
  ) {
    const machineModel = { findById: findByIdStub(overrides.machine ?? null) };
    const machineTypeModel = {
      findById: findByIdStub(overrides.machineType ?? null),
    };
    const panneModel = { findOne: findOneStub(overrides.panne ?? null) };
    const panneSolutionModel = {
      findOne: findOneStub(overrides.panneSolution ?? null),
    };
    const faultEventModel = {
      find: findChainStub(overrides.faultEvents ?? []),
    };
    const workOrderModel = { find: findChainStub(overrides.workOrders ?? []) };
    const interventionReportModel = {
      find: findChainStub(overrides.interventionReports ?? []),
    };
    const knowledgeBaseService = {
      computeSuggestions: jest
        .fn()
        .mockResolvedValue(overrides.knowledgeArticles ?? []),
    };

    const service = new AiContextBuilderService(
      machineModel as never,
      machineTypeModel as never,
      panneModel as never,
      panneSolutionModel as never,
      faultEventModel as never,
      workOrderModel as never,
      interventionReportModel as never,
      knowledgeBaseService as never,
    );

    return { service, knowledgeBaseService };
  }

  it('returns an empty-but-shaped context when no machineId or faultCode is given', async () => {
    const { service } = buildService();

    const context = await service.buildContext({});

    expect(context.machineName).toBeUndefined();
    expect(context.activeAlarms).toEqual([]);
    expect(context.maintenanceHistory).toEqual([]);
    expect(context.knowledgeArticles).toEqual([]);
  });

  it('resolves machine name and type when a valid machineId is given', async () => {
    const { service } = buildService({
      machine: {
        _id: machineId,
        machine_id: 'M-001',
        reference: 'Line 3',
        type_id: machineTypeId,
      },
      machineType: { name: 'Braiding Machine' },
    });

    const context = await service.buildContext({ machineId });

    expect(context.machineName).toBe('M-001 (Line 3)');
    expect(context.machineTypeName).toBe('Braiding Machine');
  });

  it('ignores an invalid (non-ObjectId) machineId rather than querying with it', async () => {
    const { service } = buildService();

    const context = await service.buildContext({
      machineId: 'not-an-object-id',
    });

    expect(context.machineName).toBeUndefined();
    expect(context.activeAlarms).toEqual([]);
  });

  it('resolves catalog probable cause and approved solution from a faultCode', async () => {
    const panneId = new Types.ObjectId();
    const { service } = buildService({
      panne: {
        _id: panneId,
        code_panne: 'E-42',
        description: 'Motor overcurrent',
      },
      panneSolution: {
        panne_id: panneId,
        cause_probable: 'Worn bearing',
        solution_recommandee: 'Replace bearing and re-lubricate',
      },
    });

    const context = await service.buildContext({ faultCode: 'E-42' });

    expect(context.faultDescription).toBe('Motor overcurrent');
    expect(context.probableCause).toBe('Worn bearing');
    expect(context.approvedSolution).toBe('Replace bearing and re-lubricate');
  });

  it('maps active (unresolved) fault events to alarms', async () => {
    const { service } = buildService({
      machine: { _id: machineId, machine_id: 'M-001', type_id: machineTypeId },
      faultEvents: [
        {
          code_panne: 'E-42',
          severity: FaultEventSeverity.CRITICAL,
          message: 'Overcurrent trip',
          raised_at: new Date('2026-07-01T10:00:00.000Z'),
        },
      ],
    });

    const context = await service.buildContext({ machineId });

    expect(context.activeAlarms).toEqual([
      {
        codePanne: 'E-42',
        severity: FaultEventSeverity.CRITICAL,
        message: 'Overcurrent trip',
        raisedAt: '2026-07-01T10:00:00.000Z',
      },
    ]);
  });

  it('joins work orders with their most recent intervention report for maintenance history', async () => {
    const workOrderId = new Types.ObjectId();
    const { service } = buildService({
      machine: { _id: machineId, machine_id: 'M-001', type_id: machineTypeId },
      workOrders: [
        {
          _id: workOrderId,
          date_created: new Date('2026-06-01T00:00:00.000Z'),
          type_maintenance: 'corrective',
          status: 'closed',
          code_panne: 'E-42',
          description: 'Motor tripped on overcurrent',
        },
      ],
      interventionReports: [
        {
          ot_id: workOrderId,
          date_debut: new Date('2026-06-01T08:00:00.000Z'),
          cause_racine: 'Worn bearing',
          description_action: 'Replaced bearing',
        },
      ],
    });

    const context = await service.buildContext({ machineId });

    expect(context.maintenanceHistory).toEqual([
      {
        date: '2026-06-01T00:00:00.000Z',
        type: 'corrective',
        status: 'closed',
        codePanne: 'E-42',
        description: 'Motor tripped on overcurrent',
        rootCause: 'Worn bearing',
        actionTaken: 'Replaced bearing',
      },
    ]);
  });

  it('passes machineId and faultCode through to the Knowledge Base suggestion engine', async () => {
    const { service, knowledgeBaseService } = buildService({
      machine: { _id: machineId, machine_id: 'M-001', type_id: machineTypeId },
      knowledgeArticles: [
        {
          title: 'Overcurrent troubleshooting',
          summary: 'Check bearings first',
          category: 'troubleshooting',
        },
      ],
    });

    const context = await service.buildContext({
      machineId,
      faultCode: 'E-42',
    });

    expect(knowledgeBaseService.computeSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ machineId, faultCode: 'E-42', limit: 5 }),
    );
    expect(context.knowledgeArticles).toEqual([
      {
        title: 'Overcurrent troubleshooting',
        summary: 'Check bearings first',
        category: 'troubleshooting',
      },
    ]);
  });
});
