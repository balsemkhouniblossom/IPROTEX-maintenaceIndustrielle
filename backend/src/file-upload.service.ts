import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { FileStorageService } from './storage/file-storage.service';
import type { StoredFile } from './storage/file-storage.types';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

type AvatarImageType = {
  extension: '.jpg' | '.png' | '.webp';
};

export function detectAvatarImageType(buffer: Buffer): AvatarImageType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { extension: '.jpg' };
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { extension: '.png' };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { extension: '.webp' };
  }

  return null;
}

export async function validateAndNormalizeAvatar(
  file: Express.Multer.File,
): Promise<{ buffer: Buffer; fileName: string }> {
  const buffer = file.buffer;

  if (!buffer.length) {
    throw new BadRequestException('Avatar file is empty');
  }

  if (file.size > MAX_AVATAR_BYTES || buffer.length > MAX_AVATAR_BYTES) {
    throw new PayloadTooLargeException('Avatar file exceeds 5 MB');
  }

  const imageType = detectAvatarImageType(buffer);
  if (!imageType) {
    throw new UnsupportedMediaTypeException(
      'Unsupported avatar content. Only JPEG, PNG, and WebP images are allowed.',
    );
  }

  let processedBuffer: Buffer;
  try {
    processedBuffer = await normalizeAvatarImage(buffer);
  } catch {
    throw new BadRequestException('Avatar image could not be processed');
  }

  return {
    buffer: processedBuffer,
    fileName: `avatar-${Date.now()}-${randomUUID()}.webp`,
  };
}

export async function normalizeAvatarImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({
      width: 512,
      height: 512,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp()
    .toBuffer();
}

@Injectable()
export class FileUploadService {
  constructor(private readonly storage: FileStorageService) {}

  static createMulterOptions(): MulterOptions {
    return {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_AVATAR_BYTES,
      },
    };
  }

  createMulterOptions() {
    return FileUploadService.createMulterOptions();
  }

  async storeAvatar(file: Express.Multer.File): Promise<StoredFile> {
    const prepared = await validateAndNormalizeAvatar(file);
    return this.storage.save({
      buffer: prepared.buffer,
      fileName: prepared.fileName,
      folder: 'avatars',
      contentType: 'image/webp',
    });
  }

  async deleteAvatar(relativePath: string): Promise<void> {
    await this.storage.delete(relativePath);
  }

  isManagedAvatar(reference?: string | null): boolean {
    return Boolean(reference && this.storage.ownsAvatar(reference));
  }

  async resolveAvatarUrl(
    stablePath?: string | null,
    storedUrl?: string | null,
  ): Promise<string> {
    return this.storage.resolveUrl(stablePath, storedUrl);
  }
}
