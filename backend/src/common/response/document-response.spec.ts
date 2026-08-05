import { Types } from 'mongoose';
import { toDocumentSummary } from './document-response';

function baseDoc() {
  return {
    _id: new Types.ObjectId(),
    document_id: 'DOC-1',
    machine_id: new Types.ObjectId(),
    type_document: 'manual',
    file_path: '/files/manual.pdf',
    file_name: 'manual.pdf',
    description: 'User manual',
    tags: ['manual'],
    uploaded_by: 'admin',
    date_ajout: new Date('2026-01-01T00:00:00.000Z'),
    lifecycle_history: [],
  };
}

describe('toDocumentSummary', () => {
  it('serializes an unpopulated machine_id ref to a plain id string', () => {
    const doc = baseDoc();
    expect(toDocumentSummary(doc).machine_id).toBe(doc.machine_id.toString());
  });

  it('maps a populated machine_id ref into the Machine summary shape', () => {
    const doc = baseDoc();
    const machineDoc = {
      _id: new Types.ObjectId(),
      machine_id: 'MCH-1',
      status: 'active',
    };
    (doc as unknown as { machine_id: unknown }).machine_id = machineDoc;

    const response = toDocumentSummary(doc);
    expect(response.machine_id).toMatchObject({
      _id: machineDoc._id.toString(),
      machine_id: 'MCH-1',
      status: 'active',
    });
  });

  it('never exposes Mongoose internal fields like __v or $__', () => {
    const doc = { ...baseDoc(), __v: 0 };
    const response = toDocumentSummary(doc);
    expect(response).not.toHaveProperty('__v');
    expect(response).not.toHaveProperty('$__');
    expect(response).not.toHaveProperty('_doc');
  });

  it('serializes date_ajout and lifecycle_history entries to ISO strings', () => {
    const actorId = new Types.ObjectId();
    const doc = {
      ...baseDoc(),
      lifecycle_history: [
        {
          action: 'published' as const,
          to_status: 'published' as const,
          actor_user_id: actorId,
          at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    };

    const response = toDocumentSummary(doc as never);
    expect(response.date_ajout).toBe(doc.date_ajout.toISOString());
    expect(response.lifecycle_history).toEqual([
      {
        action: 'published',
        from_status: undefined,
        to_status: 'published',
        actor_user_id: actorId.toString(),
        reason: undefined,
        at: '2026-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('omits storage/audit fields that are absent rather than emitting them as null', () => {
    const doc = baseDoc();
    const response = toDocumentSummary(doc);
    expect(response.storage_path).toBeUndefined();
    expect(response.file_url).toBeUndefined();
    expect(response.version).toBeUndefined();
    expect(response.revision).toBeUndefined();
  });
});
