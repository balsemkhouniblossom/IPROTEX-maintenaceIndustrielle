import { Types } from 'mongoose';
import {
  mapPopulatedRef,
  serializeObjectId,
  isObjectIdRef,
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

/** A populated `mod_type_id` reference — either a plain ObjectId or a document with `_id`/`name`. */
export type ModuleTypeRef = unknown;

/**
 * Serializes a module's `mod_type_id` reference, whether it arrives as a raw
 * ObjectId or as a populated `{ _id, name }` document.
 */
export function toModuleTypeSummary(ref: unknown): {
  _id?: string;
  name?: string;
} {
  if (ref === null || ref === undefined) return {};
  if (isObjectIdRef(ref) || typeof ref === 'string') {
    return { _id: serializeObjectId(ref as Types.ObjectId | string) ?? undefined };
  }
  const doc = ref as { _id?: unknown; name?: string };
  return {
    _id:
      doc._id !== undefined
        ? serializeObjectId(doc._id as Types.ObjectId | string) ?? undefined
        : undefined,
    name: doc.name,
  };
}
