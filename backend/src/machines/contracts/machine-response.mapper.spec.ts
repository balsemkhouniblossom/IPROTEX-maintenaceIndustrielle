import { Types } from 'mongoose';
import {
  toMachineResponse,
  toMachineResponseOrNull,
} from './machine-response.mapper';

function baseMachine() {
  return {
    _id: new Types.ObjectId(),
    machine_id: 'MCH-001',
    type_id: new Types.ObjectId(),
    serial_no: 'SN-001',
    reference: undefined,
    installation_date: new Date('2025-06-01T00:00:00.000Z'),
    poids_kg: 120,
    fabricant: 'Acme',
    model: 'X-100',
    location: 'Hall A',
    status: 'active',
    lifecycle_history: [],
    createdAt: new Date('2025-06-01T00:00:00.000Z'),
    updatedAt: new Date('2025-06-02T00:00:00.000Z'),
  };
}

describe('toMachineResponse', () => {
  it('serializes an unpopulated type_id ref to a plain id string', () => {
    const doc = baseMachine();
    const response = toMachineResponse(doc);

    expect(response.type_id).toBe(doc.type_id.toString());
    expect(response._id).toBe(doc._id.toString());
  });

  it('serializes a populated type_id ref into the MachineType summary shape', () => {
    const doc = baseMachine();
    const typeDoc = {
      _id: new Types.ObjectId(),
      type_id: 3,
      name: 'Conveyor',
      description: 'Belt conveyor systems',
    };
    (doc as unknown as { type_id: unknown }).type_id = typeDoc;

    const response = toMachineResponse(doc);

    expect(response.type_id).toEqual({
      _id: typeDoc._id.toString(),
      type_id: 3,
      name: 'Conveyor',
      description: 'Belt conveyor systems',
    });
  });

  it('serializes Date fields (including Mongoose timestamps) to ISO strings', () => {
    const doc = baseMachine();
    const response = toMachineResponse(doc);

    expect(response.installation_date).toBe(
      doc.installation_date.toISOString(),
    );
    expect(response.createdAt).toBe(doc.createdAt.toISOString());
    expect(response.updatedAt).toBe(doc.updatedAt.toISOString());
  });

  it('never exposes Mongoose internal fields like __v', () => {
    const doc = { ...baseMachine(), __v: 0 };
    const response = toMachineResponse(doc);

    expect(response).not.toHaveProperty('__v');
  });

  it('maps lifecycle_history entries with a serialized actor id and date', () => {
    const doc = baseMachine();
    const actorId = new Types.ObjectId();
    (doc as unknown as { lifecycle_history: unknown[] }).lifecycle_history = [
      {
        action: 'status_changed',
        from_status: 'inactive',
        to_status: 'active',
        actor_user_id: actorId,
        reason: 'Recommissioned',
        at: new Date('2025-06-03T00:00:00.000Z'),
      },
    ];

    const response = toMachineResponse(doc);

    expect(response.lifecycle_history).toEqual([
      {
        action: 'status_changed',
        from_status: 'inactive',
        to_status: 'active',
        actor_user_id: actorId.toString(),
        reason: 'Recommissioned',
        at: '2025-06-03T00:00:00.000Z',
      },
    ]);
  });

  it('preserves null-safety for the not-found case on findOne/update/remove', () => {
    expect(toMachineResponseOrNull(null)).toBeNull();
    expect(toMachineResponseOrNull(undefined)).toBeNull();

    const doc = baseMachine();
    expect(toMachineResponseOrNull(doc)?._id).toBe(doc._id.toString());
  });
});
