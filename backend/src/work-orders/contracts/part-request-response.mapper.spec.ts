import { Types } from 'mongoose';
import { toPartRequestResponse } from './part-request-response.mapper';
import { PartRequestStatus } from '../../schemas/part-request.schema';

describe('toPartRequestResponse', () => {
  it('serializes every ObjectId ref to a plain string and every date to an ISO string', () => {
    const otId = new Types.ObjectId();
    const partId = new Types.ObjectId();
    const requestedBy = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      request_id: 'PR-1',
      ot_id: otId,
      part_id: partId,
      quantity: 3,
      requested_by: requestedBy,
      status: PartRequestStatus.PENDING,
      requested_at: new Date('2026-01-01T00:00:00.000Z'),
    };

    const response = toPartRequestResponse(doc);

    expect(response).toEqual({
      _id: doc._id.toString(),
      request_id: 'PR-1',
      ot_id: otId.toString(),
      part_id: partId.toString(),
      quantity: 3,
      requested_by: requestedBy.toString(),
      status: PartRequestStatus.PENDING,
      requested_at: doc.requested_at.toISOString(),
      createdAt: undefined,
      updatedAt: undefined,
    });
  });

  it('never exposes Mongoose internal fields', () => {
    const doc = {
      _id: new Types.ObjectId(),
      request_id: 'PR-1',
      ot_id: new Types.ObjectId(),
      part_id: new Types.ObjectId(),
      quantity: 1,
      requested_by: new Types.ObjectId(),
      status: PartRequestStatus.PENDING,
      requested_at: new Date(),
      __v: 0,
    };
    const response = toPartRequestResponse(doc);
    expect(response).not.toHaveProperty('__v');
  });
});
