import {
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp from 'sharp';
import {
  detectAvatarImageType,
  FileUploadService,
  normalizeAvatarImage,
  validateAndNormalizeAvatar,
} from './file-upload.service';
import type { FileStorageService } from './storage/file-storage.service';

jest.mock('sharp', () => jest.fn());

describe('FileUploadService avatar validation', () => {
  const mockedSharp = sharp as unknown as jest.Mock;
  let rotateMock: jest.Mock;
  let resizeMock: jest.Mock;
  let webpMock: jest.Mock;
  let toBufferMock: jest.Mock;
  let storageService: { save: jest.Mock; delete: jest.Mock };

  function fileWithBuffer(
    buffer: Buffer,
    options: Partial<Express.Multer.File> = {},
  ): Express.Multer.File {
    return {
      originalname: options.originalname ?? 'avatar.bin',
      mimetype: options.mimetype ?? 'application/octet-stream',
      buffer,
      size: options.size ?? buffer.length,
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

    storageService = {
      save: jest.fn().mockResolvedValue({
        fileName: 'avatar-1.webp',
        relativePath: '/files/uploads/avatars/avatar-1.webp',
        size: Buffer.byteLength('processed-webp'),
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0x00]), '.jpg'],
    [
      'PNG',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      '.png',
    ],
    [
      'WebP',
      Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
        0x50,
      ]),
      '.webp',
    ],
  ])('accepts valid %s content by byte signature', async (_, buffer, extension) => {
    const result = await validateAndNormalizeAvatar(fileWithBuffer(buffer));

    expect(result.buffer).toEqual(Buffer.from('processed-webp'));
    expect(result.fileName).toEqual(expect.stringMatching(/^avatar-.+\.webp$/));
    expect(extension).toBeTruthy();
  });

  it('accepts valid image bytes even when the client MIME type is fake', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

    const result = await validateAndNormalizeAvatar(
      fileWithBuffer(jpeg, {
        mimetype: 'application/pdf',
        originalname: 'renamed.pdf',
      }),
    );

    expect(result.fileName).toContain('.webp');
    expect(mockedSharp).toHaveBeenCalledWith(jpeg);
  });

  it('stores normalized avatars through the configured storage provider', async () => {
    const service = new FileUploadService(
      storageService as unknown as FileStorageService,
    );

    const result = await service.storeAvatar(
      fileWithBuffer(Buffer.from([0xff, 0xd8, 0xff, 0x00])),
    );

    expect(result.relativePath).toBe('/files/uploads/avatars/avatar-1.webp');
    expect(storageService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('processed-webp'),
        fileName: expect.stringMatching(/^avatar-.+\.webp$/),
        folder: 'avatars',
        contentType: 'image/webp',
      }),
    );
  });

  it('normalizes valid avatars with EXIF rotation, bounded resizing, metadata stripping, and WebP conversion', async () => {
    const raw = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

    const normalized = await normalizeAvatarImage(raw);

    expect(normalized).toEqual(Buffer.from('processed-webp'));
    expect(mockedSharp).toHaveBeenCalledWith(raw);
    expect(rotateMock).toHaveBeenCalledWith();
    expect(resizeMock).toHaveBeenCalledWith({
      width: 512,
      height: 512,
      fit: 'inside',
      withoutEnlargement: true,
    });
    expect(webpMock).toHaveBeenCalledWith();
    expect(toBufferMock).toHaveBeenCalledWith();
  });

  it('rejects image processing failures before storing a file', async () => {
    toBufferMock.mockRejectedValue(new Error('decode failed'));

    await expect(
      validateAndNormalizeAvatar(fileWithBuffer(Buffer.from([0xff, 0xd8, 0xff, 0x00]))),
    ).rejects.toThrow('Avatar image could not be processed');

    expect(storageService.save).not.toHaveBeenCalled();
  });

  it('rejects unsupported or renamed non-image content before storing', async () => {
    await expect(
      validateAndNormalizeAvatar(
        fileWithBuffer(Buffer.from('not really an image'), {
          mimetype: 'image/png',
          originalname: 'renamed.png',
        }),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects oversized avatar files before storing', async () => {
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0xff);

    await expect(
      validateAndNormalizeAvatar(
        fileWithBuffer(oversized, {
          mimetype: 'image/jpeg',
          originalname: 'large.jpg',
        }),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('keeps the existing 5 MB Multer limit', () => {
    expect(FileUploadService.createMulterOptions().limits?.fileSize).toBe(
      5 * 1024 * 1024,
    );
  });

  it('detects only supported avatar signatures', () => {
    expect(detectAvatarImageType(Buffer.from([0xff, 0xd8, 0xff]))).toEqual({
      extension: '.jpg',
    });
    expect(detectAvatarImageType(Buffer.from('plain text'))).toBeNull();
  });
});
