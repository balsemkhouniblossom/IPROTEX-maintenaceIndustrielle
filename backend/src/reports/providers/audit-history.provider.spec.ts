import { Types } from 'mongoose';
import { AuditHistoryReportProvider } from './audit-history.provider';

function execResolves(result: unknown) {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('AuditHistoryReportProvider', () => {
  function buildProvider(opts: {
    documents?: unknown[];
    plans?: unknown[];
    workOrders?: unknown[];
    users?: unknown[];
  }) {
    const documentModel = {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(execResolves(opts.documents ?? [])) }),
    };
    const maintenancePlanModel = {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(execResolves(opts.plans ?? [])) }),
    };
    const workOrderModel = {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(execResolves(opts.workOrders ?? [])) }),
    };
    const userModel = {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue(execResolves(opts.users ?? [])) }),
    };
    const provider = new AuditHistoryReportProvider(
      documentModel as never,
      maintenancePlanModel as never,
      workOrderModel as never,
      userModel as never,
    );
    return { provider, userModel };
  }

  it('flattens Document and MaintenancePlan lifecycle_history into one sorted, actor-resolved trail', async () => {
    const actorId = new Types.ObjectId();
    const { provider, userModel } = buildProvider({
      documents: [
        {
          document_id: 'DOC-1',
          lifecycle_history: [
            {
              at: new Date('2026-06-01T00:00:00Z'),
              action: 'publish',
              from_status: 'draft',
              to_status: 'published',
              actor_user_id: actorId,
              reason: 'ready',
            },
          ],
        },
      ],
      plans: [
        {
          plan_id: 'PLAN-1',
          lifecycle_history: [
            {
              at: new Date('2026-06-02T00:00:00Z'),
              action: 'archive',
              from_status: 'active',
              to_status: 'archived',
              actor_user_id: actorId,
            },
          ],
        },
      ],
      users: [{ _id: actorId, nom_complet: 'Jane Tech' }],
    });

    const dataset = await provider.buildDataset({});

    expect(userModel.find).toHaveBeenCalled();
    // Most recent first.
    expect(dataset.rows).toEqual([
      expect.objectContaining({ entity_type: 'maintenance_plan', entity_id: 'PLAN-1', action: 'archive', actor: 'Jane Tech' }),
      expect.objectContaining({ entity_type: 'document', entity_id: 'DOC-1', action: 'publish', actor: 'Jane Tech', reason: 'ready' }),
    ]);
    expect(dataset.summary).toEqual([{ label: 'Total entries', value: 2 }]);
  });

  it('filters entries to the requested date range', async () => {
    const { provider } = buildProvider({
      documents: [
        {
          document_id: 'DOC-1',
          lifecycle_history: [
            { at: new Date('2025-01-01T00:00:00Z'), action: 'publish', to_status: 'published' },
            { at: new Date('2026-06-01T00:00:00Z'), action: 'archive', to_status: 'archived' },
          ],
        },
      ],
    });

    const dataset = await provider.buildDataset({ dateFrom: new Date('2026-01-01') });

    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0].action).toBe('archive');
  });

  it('applies the limit and returns an empty trail when nothing exists', async () => {
    const { provider } = buildProvider({});
    const dataset = await provider.buildDataset({ limit: 5 });
    expect(dataset.rows).toEqual([]);
    expect(dataset.summary).toEqual([{ label: 'Total entries', value: 0 }]);
  });
});
