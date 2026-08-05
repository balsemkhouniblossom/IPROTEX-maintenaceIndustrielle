import { Types } from 'mongoose';
import {
  toLubricationLogResponse,
  toLubricationLogResponseOrNull,
} from './lubrication-log-response.mapper';

describe('toLubricationLogResponse', () => {
  it('serializes every ObjectId ref to a plain string and the date to an ISO string', () => {
    const moduleId = new Types.ObjectId();
    const lubrifiantId = new Types.ObjectId();
    const technicianId = new Types.ObjectId();
    const doc = {
      _id: new Types.ObjectId(),
      log_id: 'LUB-1',
      module_id: moduleId,
      lubrifiant_id: lubrifiantId,
      date_application: new Date('2026-01-01T00:00:00.000Z'),
      quantite: 2,
      technician_id: technicianId,
    };

    expect(toLubricationLogResponse(doc)).toEqual({
      _id: doc._id.toString(),
      log_id: 'LUB-1',
      module_id: moduleId.toString(),
      lubrifiant_id: lubrifiantId.toString(),
      date_application: doc.date_application.toISOString(),
      quantite: 2,
      technician_id: technicianId.toString(),
    });
  });

  it('preserves null for the not-created case (no lubrication logged)', () => {
    expect(toLubricationLogResponseOrNull(null)).toBeNull();
    expect(toLubricationLogResponseOrNull(undefined)).toBeNull();
  });
});
