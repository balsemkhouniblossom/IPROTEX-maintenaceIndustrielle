import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentsService } from './documents.service';
import type { FileStorageService } from '../storage/file-storage.service';

describe('DocumentsService storage URL resolution', () => {
  let documentModel: jest.Mock & {
    findById?: jest.Mock;
    find?: jest.Mock;
    countDocuments?: jest.Mock;
    findByIdAndDelete?: jest.Mock;
  };
  let storage: {
    resolveUrl: jest.Mock;
    ownsFile: jest.Mock;
    delete: jest.Mock;
    readProtectedFile: jest.Mock;
  };
  let service: DocumentsService;

  function doc(plain: Record<string, unknown>) {
    return {
      ...plain,
      toObject: () => ({ ...plain }),
      save: jest.fn().mockResolvedValue({
        toObject: () => ({ ...plain }),
      }),
    };
  }

  function existingModelStub() {
    return {
      exists: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(true) }),
    };
  }

  beforeEach(() => {
    documentModel = jest.fn() as jest.Mock & {
      findById?: jest.Mock;
      find?: jest.Mock;
      countDocuments?: jest.Mock;
      findByIdAndDelete?: jest.Mock;
    };
    storage = {
      resolveUrl: jest.fn((path?: string | null, url?: string | null) =>
        Promise.resolve(url || path || ''),
      ),
      ownsFile: jest.fn().mockReturnValue(false),
      delete: jest.fn().mockResolvedValue(undefined),
      readProtectedFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('file'),
        contentType: 'application/pdf',
        fileName: 'manual.pdf',
        size: 4,
      }),
    };
    service = new DocumentsService(
      documentModel as never,
      existingModelStub() as never,
      existingModelStub() as never,
      existingModelStub() as never,
      existingModelStub() as never,
      {} as never,
      storage as unknown as FileStorageService,
    );
  });

  it('replaces managed public Supabase URLs with protected document file endpoints', async () => {
    storage.ownsFile.mockReturnValue(true);
    const publicUrl =
      'https://project.supabase.co/storage/v1/object/public/bucket/uploads/photo.webp';
    documentModel.mockImplementation(() =>
      doc({
        _id: 'doc-public',
        document_id: 'DOC-PUBLIC',
        file_path: 'uploads/photo.webp',
        storage_path: 'uploads/photo.webp',
        file_url: publicUrl,
      }),
    );

    const result = await service.create({
      document_id: 'DOC-PUBLIC',
      machine_id: 'machine-id',
      type_document: 'operator_photo',
      file_path: 'uploads/photo.webp',
      storage_path: 'uploads/photo.webp',
      file_url: publicUrl,
      file_name: 'photo.webp',
    });

    expect(result.file_path).toBe('uploads/photo.webp');
    expect(result.file_url).toBe('/documents/doc-public/file');
    expect(storage.resolveUrl).not.toHaveBeenCalled();
  });

  it('uses protected document file endpoints for private storage paths', async () => {
    storage.ownsFile.mockReturnValue(true);
    const findResult = {
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(
        doc({
          _id: 'doc-private',
          document_id: 'DOC-PRIVATE',
          file_path: 'uploads/photo.webp',
          storage_path: 'uploads/photo.webp',
        }),
      ),
    };
    documentModel.findById = jest.fn().mockReturnValue(findResult);

    const result = await service.findOne('doc-id');

    expect(result.file_path).toBe('uploads/photo.webp');
    expect(result.file_url).toBe('/documents/doc-private/file');
    expect(storage.resolveUrl).not.toHaveBeenCalled();
  });

  it('preserves local document paths without requiring URL storage fields', async () => {
    const findResult = {
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        doc({
          document_id: 'DOC-LOCAL',
          file_path: '/uploads/photo.webp',
        }),
      ]),
    };
    documentModel.find = jest.fn().mockReturnValue(findResult);
    documentModel.countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    const result = await service.findAll(1, 10, 0);

    expect(result.items[0]?.file_path).toBe('/uploads/photo.webp');
    expect(result.items[0]?.file_url).toBe('/uploads/photo.webp');
  });

  it('reads protected files only when the stored reference is managed', async () => {
    storage.ownsFile.mockReturnValue(true);
    const findResult = {
      exec: jest.fn().mockResolvedValue(
        doc({
          _id: 'doc-read',
          file_path: '/uploads/manual.pdf',
        }),
      ),
    };
    documentModel.findById = jest.fn().mockReturnValue(findResult);

    const result = await service.readProtectedFile('doc-read');

    expect(result.buffer).toEqual(Buffer.from('file'));
    expect(storage.readProtectedFile).toHaveBeenCalledWith(
      '/uploads/manual.pdf',
    );
  });

  it('rejects protected file reads for external document URLs', async () => {
    storage.ownsFile.mockReturnValue(false);
    const findResult = {
      exec: jest.fn().mockResolvedValue(
        doc({
          _id: 'doc-external',
          file_path: 'https://example.com/shared.pdf',
        }),
      ),
    };
    documentModel.findById = jest.fn().mockReturnValue(findResult);

    await expect(service.readProtectedFile('doc-external')).rejects.toThrow(
      'Managed document file not found',
    );
    expect(storage.readProtectedFile).not.toHaveBeenCalled();
  });

  function freshDraft(plain: Record<string, unknown>) {
    return doc({
      status: 'draft',
      lifecycle_history: [{ action: 'created' }],
      ...plain,
    });
  }

  it('deletes Supabase managed files by stored storage path after record deletion', async () => {
    storage.ownsFile.mockReturnValue(true);
    documentModel.findById = jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue(freshDraft({ document_id: 'DOC-DELETE' })),
    });
    documentModel.findByIdAndDelete = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        doc({
          document_id: 'DOC-DELETE',
          file_path: 'uploads/photo.webp',
          storage_path: 'uploads/photo.webp',
        }),
      ),
    });

    await service.remove('doc-id');

    expect(storage.delete).toHaveBeenCalledWith('uploads/photo.webp');
  });

  it('deletes local managed files by existing stable path after record deletion', async () => {
    storage.ownsFile.mockReturnValue(true);
    documentModel.findById = jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue(freshDraft({ document_id: 'DOC-LOCAL-DELETE' })),
    });
    documentModel.findByIdAndDelete = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        doc({
          document_id: 'DOC-LOCAL-DELETE',
          file_path: '/uploads/local.webp',
        }),
      ),
    });

    await service.remove('doc-id');

    expect(storage.delete).toHaveBeenCalledWith('/uploads/local.webp');
  });

  it('preserves unknown external URLs during deletion', async () => {
    storage.ownsFile.mockReturnValue(false);
    documentModel.findById = jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue(freshDraft({ document_id: 'DOC-EXTERNAL' })),
    });
    documentModel.findByIdAndDelete = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        doc({
          document_id: 'DOC-EXTERNAL',
          file_path: 'https://example.com/shared.pdf',
        }),
      ),
    });

    await service.remove('doc-id');

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('rejects deleting a document that has already been published (real lifecycle history)', async () => {
    documentModel.findById = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        doc({
          document_id: 'DOC-PUBLISHED',
          status: 'published',
          lifecycle_history: [{ action: 'created' }, { action: 'published' }],
        }),
      ),
    });
    documentModel.findByIdAndDelete = jest.fn();

    await expect(service.remove('doc-id')).rejects.toThrow(
      'This document has lifecycle or version history and cannot be deleted; archive it instead to preserve its historical references',
    );
    expect(documentModel.findByIdAndDelete).not.toHaveBeenCalled();
  });

  it('keeps the Mongo deletion result when managed file deletion fails', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();
    storage.ownsFile.mockReturnValue(true);
    storage.delete.mockRejectedValue(new Error('storage unavailable'));
    documentModel.findById = jest.fn().mockReturnValue({
      exec: jest
        .fn()
        .mockResolvedValue(freshDraft({ document_id: 'DOC-MISSING' })),
    });
    documentModel.findByIdAndDelete = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(
        doc({
          document_id: 'DOC-MISSING',
          file_path: 'uploads/missing.webp',
        }),
      ),
    });

    const result = await service.remove('doc-id');

    expect(result.toObject().document_id).toBe('DOC-MISSING');
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to delete managed document file after record removal',
    );
  });
});

function createSessionMock() {
  return {
    withTransaction: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

function existsMock(result: boolean) {
  return {
    exists: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
  };
}

describe('DocumentsService lifecycle transitions', () => {
  const docId = new Types.ObjectId();

  function makeDoc(fields: Record<string, unknown>) {
    const plain = { _id: docId, document_id: 'DOC-1', ...fields };
    return { ...plain, toObject: () => ({ ...plain }) };
  }

  let documentModel: jest.Mock & {
    findById?: jest.Mock;
    findOneAndUpdate?: jest.Mock;
    find?: jest.Mock;
    create?: jest.Mock;
    db?: { startSession: jest.Mock };
  };
  let machineModel: { exists: jest.Mock };
  let maintenancePlanModel: { exists: jest.Mock };
  let workOrderModel: { exists: jest.Mock };
  let interventionReportModel: { exists: jest.Mock };
  let storage: {
    ownsFile: jest.Mock;
    resolveUrl: jest.Mock;
    delete: jest.Mock;
  };
  let session: ReturnType<typeof createSessionMock>;
  let service: DocumentsService;

  beforeEach(() => {
    session = createSessionMock();
    documentModel = jest.fn() as typeof documentModel;
    documentModel.mockImplementation((data: Record<string, unknown>) => ({
      ...data,
      toObject: () => ({ ...data }),
      save: jest
        .fn()
        .mockResolvedValue({ ...data, toObject: () => ({ ...data }) }),
    }));
    documentModel.findById = jest.fn();
    documentModel.findOneAndUpdate = jest.fn();
    documentModel.create = jest.fn();
    documentModel.db = { startSession: jest.fn().mockResolvedValue(session) };
    machineModel = existsMock(true);
    maintenancePlanModel = existsMock(true);
    workOrderModel = existsMock(true);
    interventionReportModel = existsMock(true);
    storage = {
      ownsFile: jest.fn().mockReturnValue(false),
      resolveUrl: jest.fn().mockResolvedValue(''),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new DocumentsService(
      documentModel as never,
      machineModel as never,
      maintenancePlanModel as never,
      workOrderModel as never,
      interventionReportModel as never,
      {} as never,
      storage as unknown as FileStorageService,
    );
  });

  describe('create', () => {
    it('rejects when the referenced machine does not exist', async () => {
      machineModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue(false),
      });

      await expect(
        service.create({
          document_id: 'DOC-1',
          machine_id: new Types.ObjectId().toHexString(),
          type_document: 'manual',
          file_path: '/uploads/a.pdf',
          file_name: 'a.pdf',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the referenced maintenance plan does not exist', async () => {
      maintenancePlanModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue(false),
      });

      await expect(
        service.create({
          document_id: 'DOC-1',
          machine_id: new Types.ObjectId().toHexString(),
          maintenance_plan_id: new Types.ObjectId().toHexString(),
          type_document: 'manual',
          file_path: '/uploads/a.pdf',
          file_name: 'a.pdf',
        }),
      ).rejects.toThrow('Referenced maintenance plan does not exist');
    });

    it('rejects when the referenced work order does not exist', async () => {
      workOrderModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue(false),
      });

      await expect(
        service.create({
          document_id: 'DOC-1',
          machine_id: new Types.ObjectId().toHexString(),
          work_order_id: new Types.ObjectId().toHexString(),
          type_document: 'manual',
          file_path: '/uploads/a.pdf',
          file_name: 'a.pdf',
        }),
      ).rejects.toThrow('Referenced work order does not exist');
    });

    it('rejects when the referenced intervention report does not exist', async () => {
      interventionReportModel.exists.mockReturnValue({
        exec: jest.fn().mockResolvedValue(false),
      });

      await expect(
        service.create({
          document_id: 'DOC-1',
          machine_id: new Types.ObjectId().toHexString(),
          intervention_report_id: new Types.ObjectId().toHexString(),
          type_document: 'manual',
          file_path: '/uploads/a.pdf',
          file_name: 'a.pdf',
        }),
      ).rejects.toThrow('Referenced intervention report does not exist');
    });

    it('creates a Draft with version 1 and a single "created" lifecycle entry', async () => {
      const result = await service.create(
        {
          document_id: 'DOC-1',
          machine_id: new Types.ObjectId().toHexString(),
          type_document: 'manual',
          file_path: '/uploads/a.pdf',
          file_name: 'a.pdf',
        },
        new Types.ObjectId().toHexString(),
      );

      expect(result.status).toBe('draft');
      expect(result.version).toBe(1);
      expect(result.revision).toBe(1);
      expect((result.lifecycle_history as unknown[]).length).toBe(1);
    });
  });

  describe('publish', () => {
    it('moves a Draft to Published, incrementing version and appending lifecycle history', async () => {
      const existing = makeDoc({ status: 'draft', version: 3 });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });
      const updated = makeDoc({ status: 'published', version: 4 });
      documentModel.findOneAndUpdate!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      });

      const result = await service.publish(
        docId.toHexString(),
        { expected_version: 3 },
        'actor-1',
      );

      expect(documentModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ _id: docId.toHexString(), version: 3 }),
        expect.objectContaining({
          $set: { status: 'published' },
          $inc: { version: 1 },
          $push: {
            lifecycle_history: expect.objectContaining({
              action: 'published',
              from_status: 'draft',
              to_status: 'published',
            }),
          },
        }),
        { new: true },
      );
      expect(result.status).toBe('published');
    });

    it('rejects publishing a document that is not currently a Draft', async () => {
      const existing = makeDoc({ status: 'published', version: 2 });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });

      await expect(
        service.publish(docId.toHexString(), { expected_version: 2 }),
      ).rejects.toThrow(ConflictException);
      expect(documentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('requires expected_version once the document has a version, rejecting when omitted', async () => {
      const existing = makeDoc({ status: 'draft', version: 3 });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });

      await expect(service.publish(docId.toHexString(), {})).rejects.toThrow(
        ConflictException,
      );
      expect(documentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('fails safe (conflict) when a concurrent transition wins the atomic status-guarded update race', async () => {
      const existing = makeDoc({ status: 'draft', version: 3 });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });
      documentModel.findOneAndUpdate!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.publish(docId.toHexString(), { expected_version: 3 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('archive', () => {
    it('archives a Published document', async () => {
      const existing = makeDoc({ status: 'published', version: 5 });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });
      const updated = makeDoc({ status: 'archived', version: 6 });
      documentModel.findOneAndUpdate!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updated),
      });

      const result = await service.archive(docId.toHexString(), {
        expected_version: 5,
      });
      expect(result.status).toBe('archived');
    });

    it('rejects archiving a Superseded document', async () => {
      const existing = makeDoc({ status: 'superseded', version: 5 });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });

      await expect(
        service.archive(docId.toHexString(), { expected_version: 5 }),
      ).rejects.toThrow(ConflictException);
      expect(documentModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('replace', () => {
    it('creates a new linked Draft version and marks the old document Superseded', async () => {
      const existing = makeDoc({
        status: 'published',
        version: 2,
        revision: 1,
        machine_id: new Types.ObjectId(),
      });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });

      const newDocId = new Types.ObjectId();
      const newDoc = makeDoc({
        _id: newDocId,
        document_id: 'DOC-1-r2',
        status: 'draft',
        version: 1,
        revision: 2,
        supersedes_document_id: docId,
        root_document_id: docId,
      });
      documentModel.create!.mockResolvedValue([newDoc]);

      const superseded = makeDoc({
        status: 'superseded',
        version: 3,
        superseded_by_document_id: newDocId,
      });
      documentModel.findOneAndUpdate!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(superseded),
      });

      const result = await service.replace(docId.toHexString(), {
        file: { file_path: '/uploads/b.pdf', file_name: 'b.pdf' },
        reason: 'Updated procedure',
        expectedVersion: 2,
        actorId: 'actor-1',
      });

      expect(documentModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            supersedes_document_id: docId,
            root_document_id: docId,
            revision: 2,
            status: 'draft',
            version: 1,
          }),
        ],
        { session },
      );
      expect(result.document.status).toBe('draft');
      expect(result.superseded.status).toBe('superseded');
      expect(session.endSession).toHaveBeenCalled();
    });

    it('rejects replacing a document that is already Superseded', async () => {
      const existing = makeDoc({ status: 'superseded', version: 2 });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });

      await expect(
        service.replace(docId.toHexString(), {
          file: { file_path: '/uploads/b.pdf', file_name: 'b.pdf' },
          expectedVersion: 2,
        }),
      ).rejects.toThrow(ConflictException);
      expect(documentModel.create).not.toHaveBeenCalled();
    });

    it('rolls back (rejects) when the old document loses the guarded-update race', async () => {
      const existing = makeDoc({ status: 'published', version: 2 });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(existing),
      });
      documentModel.create!.mockResolvedValue([
        makeDoc({ status: 'draft', version: 1 }),
      ]);
      documentModel.findOneAndUpdate!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.replace(docId.toHexString(), {
          file: { file_path: '/uploads/b.pdf', file_name: 'b.pdf' },
          expectedVersion: 2,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listVersionHistory', () => {
    it('resolves the root of the chain and returns every revision in order', async () => {
      const rootId = new Types.ObjectId();
      const current = makeDoc({
        _id: docId,
        root_document_id: rootId,
        revision: 2,
      });
      documentModel.findById!.mockReturnValue({
        exec: jest.fn().mockResolvedValue(current),
      });

      const chain = [
        makeDoc({ _id: rootId, revision: 1 }),
        makeDoc({ _id: docId, root_document_id: rootId, revision: 2 }),
      ];
      const sortMock = jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(chain) });
      documentModel.find = jest.fn().mockReturnValue({ sort: sortMock });

      const result = await service.listVersionHistory(docId.toHexString());

      expect(documentModel.find).toHaveBeenCalledWith({
        $or: [{ _id: rootId }, { root_document_id: rootId }],
      });
      expect(sortMock).toHaveBeenCalledWith({ revision: 1 });
      expect(result).toHaveLength(2);
    });
  });
});
