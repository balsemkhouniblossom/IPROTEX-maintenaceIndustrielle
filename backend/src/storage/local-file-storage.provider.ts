import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import { join } from 'path';
import {
  MANAGED_AVATAR_DIRECTORY,
  MANAGED_AVATAR_FILE_PREFIX,
  MANAGED_AVATAR_ROUTE,
  MANAGED_QUARANTINE_DIRECTORY,
  toManagedAvatarPath,
  toManagedQuarantinePath,
  toManagedUploadPath,
} from '../common/managed-file-url';
import {
  FileStorageProvider,
  ProtectedStoredFile,
  StoreFileInput,
  StoredFile,
} from './file-storage.types';

@Injectable()
export class LocalFileStorageProvider implements FileStorageProvider {
  readonly driver = 'local' as const;

  async save(input: StoreFileInput): Promise<StoredFile> {
    const directory =
      input.folder === 'avatars'
        ? join(process.cwd(), 'uploads', MANAGED_AVATAR_DIRECTORY)
        : input.folder === 'quarantine'
          ? join(process.cwd(), MANAGED_QUARANTINE_DIRECTORY)
          : join(process.cwd(), 'uploads');
    const path = join(directory, input.fileName);

    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path, input.buffer);
      await fs.access(path);
    } catch {
      throw new InternalServerErrorException('Failed to store uploaded file');
    }

    return {
      fileName: input.fileName,
      relativePath:
        input.folder === 'avatars'
          ? toManagedAvatarPath(input.fileName)
          : input.folder === 'quarantine'
            ? toManagedQuarantinePath(input.fileName)
            : toManagedUploadPath(input.fileName),
      shouldPersistUrl: false,
      size: input.buffer.length,
    };
  }

  async delete(relativePath: string): Promise<void> {
    const normalized = relativePath.trim().replace(/\\/g, '/');
    const fileName = normalized.split('/').pop();
    if (!fileName) return;

    const directory = normalized.includes(`/${MANAGED_AVATAR_DIRECTORY}/`)
      ? join(process.cwd(), 'uploads', MANAGED_AVATAR_DIRECTORY)
      : join(process.cwd(), 'uploads');

    try {
      await fs.unlink(join(directory, fileName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  async readProtectedFile(reference: string): Promise<ProtectedStoredFile> {
    const fileName = this.toManagedUploadFileName(reference);
    if (!fileName) {
      throw new BadRequestException('Invalid managed file reference');
    }

    try {
      const buffer = await fs.readFile(
        join(process.cwd(), 'uploads', fileName),
      );
      return {
        buffer,
        contentType: getContentType(fileName),
        fileName,
        size: buffer.length,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('Managed file not found');
      }
      throw error;
    }
  }

  ownsFile(reference: string): boolean {
    return Boolean(this.toManagedUploadFileName(reference));
  }

  ownsAvatar(reference: string): boolean {
    const normalized = reference.trim().replace(/\\/g, '/');
    if (!normalized.startsWith(`${MANAGED_AVATAR_ROUTE}/`)) return false;

    const fileName = normalized.slice(`${MANAGED_AVATAR_ROUTE}/`.length);
    return fileName.startsWith(MANAGED_AVATAR_FILE_PREFIX);
  }

  resolveUrl(
    stablePath?: string | null,
    storedUrl?: string | null,
  ): Promise<string> {
    return Promise.resolve(storedUrl || stablePath || '');
  }

  private toManagedUploadFileName(reference: string): string | null {
    const normalized = reference.trim().replace(/\\/g, '/');
    const value = normalized.startsWith('uploads/')
      ? `/${normalized}`
      : normalized;

    if (!value.startsWith('/uploads/')) return null;

    const fileName = value.slice('/uploads/'.length);
    if (!/^[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/.test(fileName)) return null;

    return fileName;
  }
}

function getContentType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'webp':
      return 'image/webp';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return 'application/octet-stream';
  }
}
