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
      toObject: () => ({ ...plain }),
      save: jest.fn().mockResolvedValue({
        toObject: () => ({ ...plain }),
      }),
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
    expect(storage.readProtectedFile).toHaveBeenCalledWith('/uploads/manual.pdf');
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

  it('deletes Supabase managed files by stored storage path after record deletion', async () => {
    storage.ownsFile.mockReturnValue(true);
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

  it('keeps the Mongo deletion result when managed file deletion fails', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();
    storage.ownsFile.mockReturnValue(true);
    storage.delete.mockRejectedValue(new Error('storage unavailable'));
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
