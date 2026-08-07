import { Types } from 'mongoose';
import {
  toKpiResponse,
  toLubrifiantResponse,
  toOperatorPreventiveTaskResponse,
  toPanneResponse,
  toPanneSolutionResponse,
} from './operator-response.mapper';

describe('toOperatorPreventiveTaskResponse', () => {
  function baseTask() {
    return {
      _id: new Types.ObjectId(),
      task_id: 'PT-1',
      instruction: 'Check belt tension',
      status: 'pending' as const,
      source: 'manual' as const,
    };
  }

  it('serializes unpopulated plan_id/module_id refs to plain id strings', () => {
    const doc = {
      ...baseTask(),
      plan_id: new Types.ObjectId(),
      module_id: new Types.ObjectId(),
    };
    const response = toOperatorPreventiveTaskResponse(doc);
    expect(response.plan_id).toBe(doc.plan_id.toString());
    expect(response.module_id).toBe(doc.module_id.toString());
  });

  it('preserves an explicit null completed_at (reopened task) rather than omitting it', () => {
    const doc = { ...baseTask(), completed_at: null };
    const response = toOperatorPreventiveTaskResponse(doc as never);
    expect(response.completed_at).toBeNull();
    expect('completed_at' in response).toBe(true);
  });

  it('serializes a real completed_at Date to an ISO string', () => {
    const completedAt = new Date('2026-01-05T00:00:00.000Z');
    const doc = { ...baseTask(), completed_at: completedAt };
    const response = toOperatorPreventiveTaskResponse(doc as never);
    expect(response.completed_at).toBe(completedAt.toISOString());
  });

  it('omits completed_at entirely when undefined (never completed)', () => {
    const doc = baseTask();
    const response = toOperatorPreventiveTaskResponse(doc as never);
    expect(response.completed_at).toBeUndefined();
  });
});

describe('toLubrifiantResponse', () => {
  it('mirrors every Lubrifiant field with no sensitive data to exclude', () => {
    const doc = {
      _id: new Types.ObjectId(),
      lubrifiant_id: 'LUB-1',
      nom: 'Grease A',
      type: 'grease',
      viscosite: 'NLGI 2',
      usage: 'bearings',
    };
    expect(toLubrifiantResponse(doc)).toEqual({
      _id: doc._id.toString(),
      lubrifiant_id: 'LUB-1',
      nom: 'Grease A',
      type: 'grease',
      viscosite: 'NLGI 2',
      usage: 'bearings',
    });
  });
});

describe('toKpiResponse', () => {
  it('serializes machine_id and date fields to strings', () => {
    const machineId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      kpi_id: 'KPI-1',
      machine_id: machineId,
      date_calcul: new Date('2026-01-01T00:00:00.000Z'),
      periode_debut: new Date('2025-12-01T00:00:00.000Z'),
      periode_fin: new Date('2026-01-01T00:00:00.000Z'),
    };
    const response = toKpiResponse(doc);
    expect(response.machine_id).toBe(machineId.toString());
    expect(response.date_calcul).toBe(doc.date_calcul.toISOString());
  });
});

describe('toPanneResponse / toPanneSolutionResponse', () => {
  it('serializes an unpopulated panne_id ref to a plain id string', () => {
    const panneId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      solution_id: 'SOL-1',
      panne_id: panneId,
    };
    expect(toPanneSolutionResponse(doc).panne_id).toBe(panneId.toString());
  });

  it('maps a populated panne_id ref into the Panne response shape', () => {
    const panneDoc = {
      _id: new Types.ObjectId(),
      panne_id: 'P-1',
      code_panne: 'E-1',
      description: 'Overheating',
    };
    const doc = {
      _id: new Types.ObjectId(),
      solution_id: 'SOL-1',
      panne_id: panneDoc,
    };
    expect(toPanneSolutionResponse(doc as never).panne_id).toEqual(
      toPanneResponse(panneDoc),
    );
  });
});
