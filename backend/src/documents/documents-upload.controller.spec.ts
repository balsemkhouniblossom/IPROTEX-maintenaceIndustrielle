import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import sharp from 'sharp';
import { Types } from 'mongoose';
import {
  DocumentsUploadController,
  normalizeOperatorPhoto,
} from './documents-upload.controller';
import { DocumentsService } from './documents.service';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request';
import { Role } from '../schemas/user.schema';
import { MANAGED_UPLOAD_ROUTE } from '../common/managed-file-url';
import type { FileStorageService } from '../storage/file-storage.service';
import type { DocumentAccessService } from './document-access.service';

jest.mock('sharp', () => jest.fn());

describe('DocumentsUploadController', () => {
  const machineId = new Types.ObjectId().toString();
  const request = {
    user: {
      userId: new Types.ObjectId().toString(),
      role: Role.OPERATOR,
    },
  } as AuthenticatedRequest;

  let documentsService: { create: jest.Mock };
  let fileStorageService: { save: jest.Mock; delete: jest.Mock };
  let documentAccessService: { assertCanAccessMachine: jest.Mock };
  let controller: DocumentsUploadController;
  const mockedSharp = sharp as unknown as jest.Mock;
  let rotateMock: jest.Mock;
  let resizeMock: jest.Mock;
  let webpMock: jest.Mock;
  let toBufferMock: jest.Mock;

  function pngUpload(): Express.Multer.File {
    return {
      originalname: 'fault.png',
      buffer: Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
      ]),
      size: 9,
    } as Express.Multer.File;
  }

  beforeEach(() => {
    rotateMock = jest.fn();
    resizeMock = jest.fn();
    webpMock = jest.fn();
    toBufferMock = jest.fn().mockResolvedValue(Buffer.from('processed-webp'));
    const pipeline = {
      rotate: rotateMock,
      resize: resizeMock,
      webp: webpMock,
      toBuffer: toBufferMock,
    };
    rotateMock.mockReturnValue(pipeline);
    resizeMock.mockReturnValue(pipeline);
    webpMock.mockReturnValue(pipeline);
    mockedSharp.mockReturnValue(pipeline);

    documentsService = {
      create: jest.fn(),
    };
    fileStorageService = {
      save: jest.fn().mockImplementation((input) =>
        Promise.resolve({
          fileName: input.fileName,
          relativePath: `${MANAGED_UPLOAD_ROUTE}/${input.fileName}`,
          size: input.buffer.length,
        }),
      ),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    documentAccessService = {
      assertCanAccessMachine: jest.fn().mockResolvedValue(undefined),
    };
    controller = new DocumentsUploadController(
      documentsService as unknown as DocumentsService,
      fileStorageService as unknown as FileStorageService,
      documentAccessService as unknown as DocumentAccessService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes valid operator photos to WebP before creating the document record', async () => {
    const createdDocument = { _id: new Types.ObjectId().toString() };
    documentsService.create.mockResolvedValue(createdDocument);

    const result = await controller.uploadFile(
      pngUpload(),
      {
        document_id: 'DOC-1',
        machine_id: machineId,
        type_document: 'fault_photo',
        uploaded_by: 'client-supplied-id',
      },
      request,
    );

    expect(result).toBe(createdDocument);
    expect(documentAccessService.assertCanAccessMachine).toHaveBeenCalledWith(
      request.user,
      machineId,
    );
    expect(fileStorageService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('processed-webp'),
        fileName: expect.stringMatching(/\.webp$/),
        folder: 'uploads',
        contentType: 'image/webp',
      }),
    );
    expect(documentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: 'DOC-1',
        machine_id: machineId,
        type_document: 'fault_photo',
        file_path: expect.stringMatching(
          new RegExp(`^${MANAGED_UPLOAD_ROUTE}/.+\\.webp$`),
        ),
        storage_path: expect.stringMatching(
          new RegExp(`^${MANAGED_UPLOAD_ROUTE}/.+\\.webp$`),
        ),
        file_url: undefined,
        file_name: 'fault.png',
        uploaded_by: request.user?.userId,
      }),
    );
    expect(fileStorageService.delete).not.toHaveBeenCalled();
  });

  it('uses EXIF rotation, bounded resizing, metadata stripping, and WebP conversion', async () => {
    const raw = pngUpload().buffer;

    const result = await normalizeOperatorPhoto(raw);

    expect(result).toEqual(Buffer.from('processed-webp'));
    expect(mockedSharp).toHaveBeenCalledWith(raw);
    expect(rotateMock).toHaveBeenCalledWith();
    expect(resizeMock).toHaveBeenCalledWith({
      width: 1920,
      height: 1920,
      fit: 'inside',
      withoutEnlargement: true,
    });
    expect(webpMock).toHaveBeenCalledWith();
    expect(toBufferMock).toHaveBeenCalledWith();
  });

  it('does not write or create a record when photo processing fails', async () => {
    toBufferMock.mockRejectedValue(new Error('decode failed'));

    await expect(
      controller.uploadFile(
        pngUpload(),
        {
          document_id: 'DOC-PROCESSING',
          machine_id: machineId,
          type_document: 'fault_photo',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fileStorageService.save).not.toHaveBeenCalled();
    expect(fileStorageService.delete).not.toHaveBeenCalled();
    expect(documentsService.create).not.toHaveBeenCalled();
  });

  it('rejects forged or unassigned machine ids before storage', async () => {
    documentAccessService.assertCanAccessMachine.mockRejectedValue(
      new BadRequestException('Invalid machine_id'),
    );

    await expect(
      controller.uploadFile(
        pngUpload(),
        {
          document_id: 'DOC-FORGED',
          machine_id: machineId,
          type_document: 'fault_photo',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(fileStorageService.save).not.toHaveBeenCalled();
    expect(documentsService.create).not.toHaveBeenCalled();
  });

  it('does not create a document record when storing the file fails', async () => {
    fileStorageService.save.mockRejectedValue(
      new InternalServerErrorException('Failed to store uploaded file'),
    );

    await expect(
      controller.uploadFile(
        pngUpload(),
        {
          document_id: 'DOC-2',
          machine_id: machineId,
          type_document: 'fault_photo',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(documentsService.create).not.toHaveBeenCalled();
    expect(fileStorageService.delete).not.toHaveBeenCalled();
  });

  it('deletes the newly written file when document creation fails', async () => {
    const databaseError = new Error('database unavailable');
    documentsService.create.mockRejectedValue(databaseError);

    await expect(
      controller.uploadFile(
        pngUpload(),
        {
          document_id: 'DOC-3',
          machine_id: machineId,
          type_document: 'fault_photo',
        },
        request,
      ),
    ).rejects.toBe(databaseError);

    expect(documentsService.create).toHaveBeenCalledTimes(1);
    expect(fileStorageService.delete).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${MANAGED_UPLOAD_ROUTE}/.+\\.webp$`)),
    );
  });

  it('stores Supabase public document photos with stable path without persisting public URL', async () => {
    const publicUrl =
      'https://project.supabase.co/storage/v1/object/public/bucket/uploads/photo.webp';
    documentsService.create.mockResolvedValue({ _id: 'doc-public' });
    fileStorageService.save.mockResolvedValue({
      fileName: 'photo.webp',
      storageKey: 'uploads/photo.webp',
      relativePath: 'uploads/photo.webp',
      url: publicUrl,
      shouldPersistUrl: true,
      size: 100,
    });

    await controller.uploadFile(
      pngUpload(),
      {
        document_id: 'DOC-PUBLIC',
        machine_id: machineId,
        type_document: 'operator_photo',
      },
      request,
    );

    expect(documentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        file_path: 'uploads/photo.webp',
        storage_path: 'uploads/photo.webp',
        file_url: undefined,
      }),
    );
  });

  it('stores Supabase private document photos without persisting signed URLs', async () => {
    documentsService.create.mockResolvedValue({ _id: 'doc-private' });
    fileStorageService.save.mockResolvedValue({
      fileName: 'photo.webp',
      storageKey: 'uploads/photo.webp',
      relativePath: 'uploads/photo.webp',
      url: 'https://project.supabase.co/storage/v1/object/sign/bucket/uploads/photo.webp?token=abc',
      shouldPersistUrl: false,
      size: 100,
    });

    await controller.uploadFile(
      pngUpload(),
      {
        document_id: 'DOC-PRIVATE',
        machine_id: machineId,
        type_document: 'operator_photo',
      },
      request,
    );

    expect(documentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        file_path: 'uploads/photo.webp',
        storage_path: 'uploads/photo.webp',
        file_url: undefined,
      }),
    );
  });

  it('rolls back Supabase documents by stored storage path', async () => {
    documentsService.create.mockRejectedValue(new Error('database unavailable'));
    fileStorageService.save.mockResolvedValue({
      fileName: 'photo.webp',
      storageKey: 'uploads/photo.webp',
      relativePath: 'uploads/photo.webp',
      url: 'https://project.supabase.co/storage/v1/object/sign/bucket/uploads/photo.webp?token=abc',
      shouldPersistUrl: false,
      size: 100,
    });

    await expect(
      controller.uploadFile(
        pngUpload(),
        {
          document_id: 'DOC-ROLLBACK',
          machine_id: machineId,
          type_document: 'operator_photo',
        },
        request,
      ),
    ).rejects.toThrow('database unavailable');

    expect(fileStorageService.delete).toHaveBeenCalledWith('uploads/photo.webp');
  });

  it('keeps non-photo document uploads unchanged', async () => {
    const createdDocument = { _id: new Types.ObjectId().toString() };
    const pdfBuffer = Buffer.from('%PDF-1.7');
    documentsService.create.mockResolvedValue(createdDocument);

    await controller.uploadFile(
      {
        originalname: 'manual.pdf',
        buffer: pdfBuffer,
        size: pdfBuffer.length,
      } as Express.Multer.File,
      {
        document_id: 'DOC-PDF',
        machine_id: machineId,
        type_document: 'manual',
      },
      request,
    );

    expect(mockedSharp).not.toHaveBeenCalled();
    expect(fileStorageService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: pdfBuffer,
        fileName: expect.stringMatching(/\.pdf$/),
        folder: 'uploads',
        contentType: undefined,
      }),
    );
    expect(documentsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        file_path: expect.stringMatching(
          new RegExp(`^${MANAGED_UPLOAD_ROUTE}/.+\\.pdf$`),
        ),
        file_name: 'manual.pdf',
      }),
    );
  });
});
