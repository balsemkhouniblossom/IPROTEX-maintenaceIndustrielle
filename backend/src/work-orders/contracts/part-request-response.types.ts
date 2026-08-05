import { PartRequestStatus } from '../../schemas/part-request.schema';

/** The actual serialized shape of a Part Request — no ref on this schema is ever populated today. */
export interface PartRequestResponse {
  _id: string;
  request_id: string;
  ot_id: string;
  part_id: string;
  quantity: number;
  requested_by: string;
  status: PartRequestStatus;
  requested_at: string;
  createdAt?: string;
  updatedAt?: string;
}
