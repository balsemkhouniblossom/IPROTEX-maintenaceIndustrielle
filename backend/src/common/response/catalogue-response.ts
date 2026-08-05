import { Catalogue, CatalogueDocument } from '../../schemas/catalogue.schema';
import { Stock, StockDocument } from '../../schemas/stock.schema';
import { mapPopulatedRef, serializeObjectId } from './serialization.util';

/**
 * Mirrors every `Catalogue` field actually consumed by Operator/Technician
 * frontend code, excluding `unit_cost` — that field is currently exposed on
 * the raw document but never read by any Operator/Technician UI (only the
 * Admin Catalogues page shows pricing), so it is deliberately dropped here
 * per the audit's "exclude internal pricing... unless currently exposed and
 * consumed" instruction.
 */
export interface CatalogueSummaryResponse {
  _id: string;
  part_id: string;
  nom_piece: string;
  ref_constructeur: string;
  fabricant?: string;
  categorie_piece?: string;
}

/** The actual serialized shape of a Stock record — `part_id` is a plain ObjectId string on endpoints that don't populate it, and a `CatalogueSummaryResponse` on endpoints that do. */
export interface StockResponse {
  _id: string;
  stock_id: string;
  part_id: string | CatalogueSummaryResponse;
  quantite_en_stock: number;
  quantite_reservee: number;
  seuil_alerte_stock?: number;
  quantite_minimale?: number;
  emplacement?: string;
  version?: number;
}

type CatalogueLike = (Catalogue | CatalogueDocument) & { _id: unknown };
type StockLike = (Stock | StockDocument) & { _id: unknown };

export function toCatalogueSummary(
  doc: CatalogueLike,
): CatalogueSummaryResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    part_id: doc.part_id,
    nom_piece: doc.nom_piece,
    ref_constructeur: doc.ref_constructeur,
    fabricant: doc.fabricant,
    categorie_piece: doc.categorie_piece,
  };
}

export function toStockResponse(doc: StockLike): StockResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    stock_id: doc.stock_id,
    part_id: mapPopulatedRef(
      doc.part_id as unknown as CatalogueLike | string,
      toCatalogueSummary,
    )!,
    quantite_en_stock: doc.quantite_en_stock,
    quantite_reservee: doc.quantite_reservee,
    seuil_alerte_stock: doc.seuil_alerte_stock,
    quantite_minimale: doc.quantite_minimale,
    emplacement: doc.emplacement,
    version: doc.version,
  };
}
