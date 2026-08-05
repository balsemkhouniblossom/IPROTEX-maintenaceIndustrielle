import {
  readTimestamps,
  serializeDate,
  serializeObjectId,
} from '../../common/response/serialization.util';
import {
  PartRequest,
  PartRequestDocument,
} from '../../schemas/part-request.schema';
import { PartRequestResponse } from './part-request-response.types';

type PartRequestLike = (PartRequest | PartRequestDocument) & {
  _id: unknown;
};

export function toPartRequestResponse(
  doc: PartRequestLike,
): PartRequestResponse {
  const timestamps = readTimestamps(doc);
  return {
    _id: serializeObjectId(doc._id as string)!,
    request_id: doc.request_id,
    ot_id: serializeObjectId(doc.ot_id)!,
    part_id: serializeObjectId(doc.part_id)!,
    quantity: doc.quantity,
    requested_by: serializeObjectId(doc.requested_by)!,
    status: doc.status,
    requested_at: serializeDate(doc.requested_at)!,
    createdAt: serializeDate(timestamps.createdAt),
    updatedAt: serializeDate(timestamps.updatedAt),
  };
}
