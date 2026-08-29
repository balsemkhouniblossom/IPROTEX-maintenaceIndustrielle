import { Types } from 'mongoose';
import { toCatalogueSummary, toStockResponse } from './catalogue-response';

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right);

describe('toCatalogueSummary', () => {
  it('excludes unit_cost (internal pricing never consumed by Operator/Technician UI) and Mongoose metadata', () => {
    const doc = {
      _id: new Types.ObjectId(),
      part_id: 'P-1',
      nom_piece: 'Bearing',
      ref_constructeur: 'REF-1',
      fabricant: 'Acme',
      categorie_piece: 'Mechanical',
      unit_cost: 42.5,
      __v: 0,
    };

    const summary = toCatalogueSummary(doc);

    expect(summary).not.toHaveProperty('unit_cost');
    expect(summary).not.toHaveProperty('__v');
    expect(Object.keys(summary).sort(compareStrings)).toEqual(
      [
        '_id',
        'part_id',
        'nom_piece',
        'ref_constructeur',
        'fabricant',
        'categorie_piece',
      ].sort(compareStrings),
    );
  });
});

describe('toStockResponse', () => {
  it('serializes an unpopulated part_id ref to a plain id string', () => {
    const partId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      stock_id: 'S-1',
      part_id: partId,
      quantite_en_stock: 10,
      quantite_reservee: 2,
    };

    expect(toStockResponse(doc).part_id).toBe(partId.toString());
  });

  it('maps a populated part_id ref into the Catalogue summary shape, excluding unit_cost', () => {
    const doc = {
      _id: new Types.ObjectId(),
      stock_id: 'S-1',
      part_id: {
        _id: new Types.ObjectId(),
        part_id: 'P-1',
        nom_piece: 'Bearing',
        ref_constructeur: 'REF-1',
        unit_cost: 99,
      },
      quantite_en_stock: 10,
      quantite_reservee: 2,
    };

    const response = toStockResponse(doc as never);
    expect(response.part_id).not.toHaveProperty('unit_cost');
    expect(response.part_id).toEqual({
      _id: doc.part_id._id.toString(),
      part_id: 'P-1',
      nom_piece: 'Bearing',
      ref_constructeur: 'REF-1',
      fabricant: undefined,
      categorie_piece: undefined,
    });
  });

  it('preserves quantity/version fields exactly, including a zero reserved quantity', () => {
    const doc = {
      _id: new Types.ObjectId(),
      stock_id: 'S-1',
      part_id: new Types.ObjectId(),
      quantite_en_stock: 5,
      quantite_reservee: 0,
      seuil_alerte_stock: 2,
      quantite_minimale: 1,
      emplacement: 'Aisle 3',
      version: 4,
    };

    expect(toStockResponse(doc)).toMatchObject({
      quantite_en_stock: 5,
      quantite_reservee: 0,
      seuil_alerte_stock: 2,
      quantite_minimale: 1,
      emplacement: 'Aisle 3',
      version: 4,
    });
  });
});
