import {
  serializeDate,
  serializeObjectId,
} from '../../common/response/serialization.util';
import {
  LubrificationLog,
  LubrificationLogDocument,
} from '../../schemas/lubrification-log.schema';
import { LubricationLogResponse } from './lubrication-log-response.types';

type LubricationLogLike = (LubrificationLog | LubrificationLogDocument) & {
  _id: unknown;
};

export function toLubricationLogResponse(
  doc: LubricationLogLike,
): LubricationLogResponse {
  return {
    _id: serializeObjectId(doc._id as string)!,
    log_id: doc.log_id,
    module_id: serializeObjectId(doc.module_id)!,
    lubrifiant_id: serializeObjectId(doc.lubrifiant_id)!,
    date_application: serializeDate(doc.date_application)!,
    quantite: doc.quantite,
    technician_id: serializeObjectId(doc.technician_id)!,
  };
}

export function toLubricationLogResponseOrNull(
  doc: LubricationLogLike | null | undefined,
): LubricationLogResponse | null {
  return doc ? toLubricationLogResponse(doc) : null;
}
