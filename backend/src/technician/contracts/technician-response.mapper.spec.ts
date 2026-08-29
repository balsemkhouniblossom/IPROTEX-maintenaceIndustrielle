import { Types } from 'mongoose';
import { toTechnicianPartResponse } from './technician-response.mapper';

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
