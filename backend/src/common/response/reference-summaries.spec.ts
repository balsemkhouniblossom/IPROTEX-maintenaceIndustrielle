import { Types } from 'mongoose';
import {
  toMachineSummary,
  toMachineTypeSummary,
  toMaintenancePlanSummary,
  toModuleSummary,
  toUserSummary,
} from './reference-summaries';

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right);

describe('toUserSummary', () => {
  it('never surfaces sensitive User fields even if the source object carries them', () => {
    const compromised = {
      _id: new Types.ObjectId(),
      user_id: 'U-1',
      nom_complet: 'Jane Doe',
      role: 'technician',
      password: 'hashed',
      refresh_token_hash: 'hashed-refresh',
      reset_password_token: 'token',
      reset_password_expires: new Date(),
      google_id: 'google-123',
      google_auth_history: [{ at: new Date() }],
    };

    const summary = toUserSummary(compromised);

    expect(Object.keys(summary).sort(compareStrings)).toEqual(
      ['_id', 'nom_complet', 'role', 'user_id'].sort(compareStrings),
    );
  });
});

describe('toMachineTypeSummary', () => {
  it('never exposes Mongoose internal fields like __v', () => {
    const doc = {
      _id: new Types.ObjectId(),
      type_id: 1,
      name: 'Conveyor',
      description: 'desc',
      __v: 0,
    };
    expect(toMachineTypeSummary(doc as never)).not.toHaveProperty('__v');
  });
});

describe('toMachineSummary', () => {
  it('serializes an unpopulated type_id ref to a plain id string', () => {
    const typeId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      machine_id: 'MCH-1',
      serial_no: 'SN-1',
      status: 'active',
      type_id: typeId,
    };
    expect(toMachineSummary(doc as never).type_id).toBe(typeId.toString());
  });

  it('maps a populated type_id ref into the MachineType summary shape', () => {
    const doc = {
      _id: new Types.ObjectId(),
      machine_id: 'MCH-1',
      serial_no: 'SN-1',
      status: 'active',
      type_id: { _id: new Types.ObjectId(), type_id: 2, name: 'Press' },
    };
    expect(toMachineSummary(doc as never).type_id).toEqual({
      _id: doc.type_id._id.toString(),
      type_id: 2,
      name: 'Press',
      description: undefined,
    });
  });
});

describe('toModuleSummary', () => {
  it('serializes an unpopulated machine_id ref to a plain id string', () => {
    const machineId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      module_id: 'MOD-1',
      machine_id: machineId,
      mod_type_id: new Types.ObjectId(),
      localisation: 'Zone A',
    };
    expect(toModuleSummary(doc as never).machine_id).toBe(machineId.toString());
  });
});

describe('toMaintenancePlanSummary', () => {
  it('mirrors every field the plan schema exposes (no field-limiting projection is ever used for this ref)', () => {
    const doc = {
      _id: new Types.ObjectId(),
      plan_id: 'PLAN-1',
      module_id: new Types.ObjectId(),
      type_maintenance: 'preventive',
      frequence: 3,
      unite_frequence: 'months',
      instruction: 'Lubricate bearings',
      responsable: 'Team A',
      huile_graisse: 'SAE 30',
      documentation: 'doc.pdf',
      maintenance_code: 'W1',
      frequence_label: 'Every 3 months',
      status: 'active',
      version: 2,
    };

    const summary = toMaintenancePlanSummary(doc as never);

    expect(summary.maintenance_code).toBe('W1');
    expect(summary.plan_id).toBe('PLAN-1');
    expect(summary._id).toBe(doc._id.toString());
    expect(summary.module_id).toBe(doc.module_id.toString());
  });
});
