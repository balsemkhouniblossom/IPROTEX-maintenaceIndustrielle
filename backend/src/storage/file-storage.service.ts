import { Inject, Injectable } from '@nestjs/common';
import {
  FILE_STORAGE_PROVIDER,
  FileStorageProvider,
  ProtectedStoredFile,
  StoreFileInput,
  StoredFile,
} from './file-storage.types';

@Injectable()
export class FileStorageService {
  constructor(
    @Inject(FILE_STORAGE_PROVIDER)
    private readonly provider: FileStorageProvider,
  ) {}

  save(input: StoreFileInput): Promise<StoredFile> {
    return this.provider.save(input);
  }

  delete(relativePath: string): Promise<void> {
    return this.provider.delete(relativePath);
  }

  ownsAvatar(reference: string): boolean {
    return this.provider.ownsAvatar?.(reference) ?? false;
  }

  ownsFile(reference?: string | null): boolean {
    return Boolean(reference && this.provider.ownsFile?.(reference));
  }

  readProtectedFile(reference: string): Promise<ProtectedStoredFile> {
    if (!this.provider.readProtectedFile) {
      throw new Error('Storage provider does not support protected file reads');
    }

    return this.provider.readProtectedFile(reference);
  }

  createSignedReadUrl(
    reference: string,
    expiresInSeconds?: number,
  ): Promise<string> {
    if (!this.provider.createSignedReadUrl) {
      throw new Error('Storage provider does not support signed file URLs');
    }

    return this.provider.createSignedReadUrl(reference, expiresInSeconds);
  }

  async resolveUrl(
    stablePath?: string | null,
    storedUrl?: string | null,
  ): Promise<string> {
    return this.provider.resolveUrl?.(stablePath, storedUrl) ?? (storedUrl || stablePath || '');
  }
}
