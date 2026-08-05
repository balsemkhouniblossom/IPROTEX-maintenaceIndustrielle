import {
  mapPopulatedRef,
  serializeObjectId,
} from '../../common/response/serialization.util';
import { toCatalogueSummary } from '../../common/response/catalogue-response';
import { CatalogueDocument } from '../../schemas/catalogue.schema';
import { OTPieces, OTPiecesDocument } from '../../schemas/ot-pieces.schema';
import { TechnicianPartResponse } from './technician-response.types';

type OTPiecesLike = (OTPieces | OTPiecesDocument) & { _id: unknown };

export function toTechnicianPartResponse(
  doc: OTPiecesLike,
): TechnicianPartResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    ot_id: serializeObjectId(doc.ot_id)!,
    part_id: mapPopulatedRef(
      doc.part_id as unknown as CatalogueDocument | string,
      toCatalogueSummary,
    )!,
    quantite: doc.quantite,
  };
}
