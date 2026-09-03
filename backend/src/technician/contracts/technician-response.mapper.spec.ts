import { Types } from 'mongoose';
import {
  toTechnicianPartResponse,
  toModuleTypeSummary,
} from './technician-response.mapper';

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right);

describe('toTechnicianPartResponse', () => {
  it('serializes an unpopulated part_id ref to a plain id string', () => {
    const partId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      ot_id: new Types.ObjectId(),
      part_id: partId,
      quantite: 3,
    };
    const response = toTechnicianPartResponse(doc);
    expect(response.part_id).toBe(partId.toString());
    expect(response.quantite).toBe(3);
  });

  it('maps a populated part_id ref into the Catalogue summary shape, excluding unit_cost', () => {
    const doc = {
      _id: new Types.ObjectId(),
      ot_id: new Types.ObjectId(),
      part_id: {
        _id: new Types.ObjectId(),
        part_id: 'P-1',
        nom_piece: 'Bearing',
        ref_constructeur: 'REF-1',
        unit_cost: 55,
      },
      quantite: 2,
    };
    const response = toTechnicianPartResponse(doc as never);
    expect(response.part_id).not.toHaveProperty('unit_cost');
    expect(response.part_id).toMatchObject({
      part_id: 'P-1',
      nom_piece: 'Bearing',
      ref_constructeur: 'REF-1',
    });
  });

  it('never exposes Mongoose internal fields', () => {
    const doc = {
      _id: new Types.ObjectId(),
      ot_id: new Types.ObjectId(),
      part_id: new Types.ObjectId(),
      quantite: 1,
      __v: 0,
    };
    const response = toTechnicianPartResponse(doc);
    expect(response).not.toHaveProperty('__v');
    expect(Object.keys(response).sort(compareStrings)).toEqual(
      ['_id', 'ot_id', 'part_id', 'quantite'].sort(compareStrings),
    );
  });
});

describe('toModuleTypeSummary', () => {
  it('returns an empty object for null or undefined refs', () => {
    expect(toModuleTypeSummary(null)).toEqual({});
    expect(toModuleTypeSummary(undefined)).toEqual({});
  });

  it('serializes an ObjectId ref to an id-only summary', () => {
    const id = new Types.ObjectId();
    expect(toModuleTypeSummary(id)).toEqual({ _id: id.toString() });
  });

  it('serializes a string ref to an id-only summary', () => {
    const id = new Types.ObjectId().toString();
    expect(toModuleTypeSummary(id)).toEqual({ _id: id });
  });

  it('maps a populated ref with name into an id and name summary', () => {
    const id = new Types.ObjectId();
    const response = toModuleTypeSummary({ _id: id, name: 'Motor' });
    expect(response).toEqual({ _id: id.toString(), name: 'Motor' });
  });

  it('maps a populated ref without an _id to an undefined _id', () => {
    const response = toModuleTypeSummary({ name: 'Motor' });
    expect(response).toEqual({ _id: undefined, name: 'Motor' });
  });

  it('maps a populated ref without a name to an undefined name', () => {
    const id = new Types.ObjectId();
    const response = toModuleTypeSummary({ _id: id });
    expect(response).toEqual({ _id: id.toString(), name: undefined });
  });
});
