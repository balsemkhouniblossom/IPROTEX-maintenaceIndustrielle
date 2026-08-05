import { Types } from 'mongoose';
import {
  toWorkOrderResponse,
  toWorkOrderResponseOrNull,
} from './work-order-response.mapper';

function baseWorkOrder() {
  return {
    _id: new Types.ObjectId(),
    ot_id: 'WO-PREV-000001',
    machine_id: new Types.ObjectId(),
    module_id: new Types.ObjectId(),
    technician_id: new Types.ObjectId(),
    plan_id: new Types.ObjectId(),
    description: 'Inspect belt tension',
    type_maintenance: 'preventive',
    status: 'scheduled',
    priorite: 'medium',
    code_panne: undefined,
    date_created: new Date('2026-01-01T00:00:00.000Z'),
    date_start: new Date('2026-01-02T00:00:00.000Z'),
    scheduled_date: undefined,
    due_date: undefined,
    execution_date: undefined,
    date_end: undefined,
    date_closed: undefined,
    recurrence_source_occurrence_id: undefined,
    preventive_occurrence_key: undefined,
    original_due_date: undefined,
    reschedule_reason: undefined,
    rescheduled_by: undefined,
    rescheduled_at: undefined,
    validated_by: undefined,
    validated_at: undefined,
    lifecycle_history: [],
  };
}

describe('toWorkOrderResponse', () => {
  it('serializes unpopulated ObjectId refs to plain id strings', () => {
    const doc = baseWorkOrder();
    const response = toWorkOrderResponse(doc);

    expect(response.machine_id).toBe(doc.machine_id.toString());
    expect(response.module_id).toBe(doc.module_id.toString());
    expect(response.technician_id).toBe(doc.technician_id.toString());
    expect(response.plan_id).toBe(doc.plan_id.toString());
    expect(typeof response.machine_id).toBe('string');
  });

  it('serializes populated refs into their focused summary shape', () => {
    const doc = baseWorkOrder();
    const machineDoc = {
      _id: new Types.ObjectId(),
      machine_id: 'MCH-001',
      serial_no: 'SN-1',
      status: 'active',
      type_id: new Types.ObjectId(),
    };
    const technicianDoc = {
      _id: new Types.ObjectId(),
      user_id: 'U-1',
      nom_complet: 'Jane Technician',
      role: 'technician',
    };
    (doc as unknown as { machine_id: unknown }).machine_id = machineDoc;
    (doc as unknown as { technician_id: unknown }).technician_id =
      technicianDoc;

    const response = toWorkOrderResponse(doc);

    expect(response.machine_id).toEqual({
      _id: machineDoc._id.toString(),
      machine_id: 'MCH-001',
      serial_no: 'SN-1',
      reference: undefined,
      fabricant: undefined,
      model: undefined,
      location: undefined,
      status: 'active',
      type_id: machineDoc.type_id.toString(),
    });
    expect(response.technician_id).toEqual({
      _id: technicianDoc._id.toString(),
      user_id: 'U-1',
      nom_complet: 'Jane Technician',
      role: 'technician',
    });
  });

  it('never leaks sensitive User fields even if a caller forgot the safe projection', () => {
    const doc = baseWorkOrder();
    const compromisedTechnicianDoc = {
      _id: new Types.ObjectId(),
      user_id: 'U-1',
      nom_complet: 'Jane Technician',
      role: 'technician',
      // A populate that forgot SAFE_USER_PROJECTION would bring these back —
      // the response type/mapper must not surface them even if present.
      password: 'hashed-secret',
      refresh_token_hash: 'hashed-refresh',
      reset_password_token: 'reset-token',
    };
    (doc as unknown as { technician_id: unknown }).technician_id =
      compromisedTechnicianDoc;

    const response = toWorkOrderResponse(doc);

    expect(response.technician_id).not.toHaveProperty('password');
    expect(response.technician_id).not.toHaveProperty('refresh_token_hash');
    expect(response.technician_id).not.toHaveProperty('reset_password_token');
    expect(Object.keys(response.technician_id as object).sort()).toEqual(
      ['_id', 'nom_complet', 'role', 'user_id'].sort(),
    );
  });

  it('serializes Date fields to the same ISO strings Date#toJSON would have produced', () => {
    const doc = baseWorkOrder();
    const response = toWorkOrderResponse(doc);

    expect(response.date_created).toBe(doc.date_created.toISOString());
    expect(response.date_start).toBe(doc.date_start!.toISOString());
    expect(typeof response.date_created).toBe('string');
  });

  it('omits optional fields that are absent rather than emitting null/"undefined"', () => {
    const doc = baseWorkOrder();
    const response = toWorkOrderResponse(doc);

    expect(response.due_date).toBeUndefined();
    expect(response.module_id ? undefined : response.module_id).toBeUndefined();
    expect(response.rescheduled_by).toBeUndefined();
  });

  it('maps embedded lifecycle_history entries with serialized actor/date fields', () => {
    const doc = baseWorkOrder();
    const actorId = new Types.ObjectId();
    (doc as unknown as { lifecycle_history: unknown[] }).lifecycle_history = [
      {
        action: 'validated',
        from_status: 'waiting_validation',
        to_status: 'validated',
        actor_user_id: actorId,
        reason: undefined,
        at: new Date('2026-02-01T00:00:00.000Z'),
      },
    ];

    const response = toWorkOrderResponse(doc);

    expect(response.lifecycle_history).toEqual([
      {
        action: 'validated',
        from_status: 'waiting_validation',
        to_status: 'validated',
        actor_user_id: actorId.toString(),
        reason: undefined,
        at: '2026-02-01T00:00:00.000Z',
      },
    ]);
  });

  it('preserves _id/status through a null-safe pass-through for mutation endpoints that may not find a document', () => {
    expect(toWorkOrderResponseOrNull(null)).toBeNull();
    expect(toWorkOrderResponseOrNull(undefined)).toBeNull();

    const doc = baseWorkOrder();
    const response = toWorkOrderResponseOrNull(doc);
    expect(response?._id).toBe(doc._id.toString());
    expect(response?.status).toBe('scheduled');
  });
});
