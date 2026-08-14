import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  MANAGED_AVATAR_DIRECTORY,
  MANAGED_AVATAR_FILE_PREFIX,
  MANAGED_QUARANTINE_DIRECTORY,
} from '../common/managed-file-url';
import { resolveFileStorageConfig } from './file-storage.config';
import {
  FileStorageProvider,
  ProtectedStoredFile,
  StoreFileInput,
  StoredFile,
} from './file-storage.types';

@Injectable()
export class SupabaseStorageProvider implements FileStorageProvider {
  readonly driver = 'supabase' as const;
  private readonly logger = new Logger(SupabaseStorageProvider.name);
  private readonly client: SupabaseClient;
  private readonly supabaseOrigin: string;
  private readonly bucket: string;
  private readonly bucketIsPublic: boolean;
  private readonly signedUrlExpiresInSeconds: number;

  constructor(configService: ConfigService, client?: SupabaseClient) {
    const config = resolveFileStorageConfig(configService);
    this.supabaseOrigin = new URL(config.supabase.url ?? '').origin;
    this.bucket = config.supabase.bucket ?? '';
    this.bucketIsPublic = config.supabase.bucketIsPublic;
    this.signedUrlExpiresInSeconds = config.supabase.signedUrlExpiresInSeconds;
    this.client =
      client ??
      createClient(config.supabase.url ?? '', config.supabase.secretKey ?? '', {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
  }

  async save(input: StoreFileInput): Promise<StoredFile> {
    const storageKey = this.createStorageKey(input);
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(storageKey, input.buffer, {
        contentType: input.contentType,
        upsert: false,
      });

    if (error) {
      throw new InternalServerErrorException('Failed to store uploaded file');
    }

    // Quarantined files (rejected uploads) are write-only evidence: never
    // generate a public or signed URL for them, regardless of bucket
    // visibility — that would defeat the point of quarantining them.
    const url =
      input.folder === 'quarantine'
        ? undefined
        : await this.createReadableUrl(storageKey, true);

    return {
      fileName: input.fileName,
      storageKey,
      relativePath: storageKey,
      url,
      shouldPersistUrl: input.folder !== 'quarantine' && this.bucketIsPublic,
      size: input.buffer.length,
    };
  }

  async delete(relativePathOrKey: string): Promise<void> {
    const storageKey = this.toStorageKey(relativePathOrKey);
    if (!storageKey) return;

    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([storageKey]);
    if (error) {
      throw error;
    }
  }

  async readProtectedFile(reference: string): Promise<ProtectedStoredFile> {
    const storageKey = this.toDocumentStorageKey(reference);
    if (!storageKey) {
      throw new BadRequestException('Invalid managed file reference');
    }

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(storageKey);

    if (error || !data) {
      throw new NotFoundException('Managed file not found');
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    return {
      buffer,
      contentType: data.type || getContentType(storageKey),
      fileName: storageKey.split('/').pop() ?? 'download',
      size: buffer.length,
    };
  }

  async createSignedReadUrl(
    reference: string,
    expiresInSeconds = this.signedUrlExpiresInSeconds,
  ): Promise<string> {
    const storageKey = this.toDocumentStorageKey(reference);
    if (!storageKey) {
      throw new BadRequestException('Invalid managed file reference');
    }

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(storageKey, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new NotFoundException('Managed file not found');
    }

    return data.signedUrl;
  }

  ownsAvatar(reference: string): boolean {
    const storageKey = this.toStorageKey(reference);
    return Boolean(
      storageKey?.startsWith(`uploads/${MANAGED_AVATAR_DIRECTORY}/`) &&
      storageKey.split('/').pop()?.startsWith(MANAGED_AVATAR_FILE_PREFIX),
    );
  }

  ownsFile(reference: string): boolean {
    return Boolean(this.toDocumentStorageKey(reference));
  }

  async resolveUrl(
    stablePath?: string | null,
    storedUrl?: string | null,
  ): Promise<string> {
    if (this.bucketIsPublic && storedUrl?.trim()) return storedUrl;

    const storageKey = stablePath ? this.toStorageKey(stablePath) : null;
    if (!storageKey) return storedUrl || stablePath || '';

    try {
      return await this.createReadableUrl(storageKey, false);
    } catch {
      this.logger.warn('Failed to resolve managed file URL');
      return storedUrl || stablePath || '';
    }
  }

  private createStorageKey(input: StoreFileInput): string {
    const prefix =
      input.folder === 'avatars'
        ? `uploads/${MANAGED_AVATAR_DIRECTORY}`
        : input.folder === 'quarantine'
          ? MANAGED_QUARANTINE_DIRECTORY
          : 'uploads';
    return `${prefix}/${input.fileName}`;
  }

  private toStorageKey(relativePathOrKey: string): string | null {
    const normalized = relativePathOrKey.trim().replaceAll('\\', '/');
    if (!normalized) return null;

    if (normalized.startsWith('uploads/')) return normalized;

    const keyFromUrl = this.toStorageKeyFromUrl(normalized);
    if (keyFromUrl) return keyFromUrl;

    if (normalized.startsWith('/files/uploads/')) {
      return normalized.replace(/^\/files\//, '');
    }

    if (normalized.startsWith('/uploads/')) {
      return normalized.slice(1);
    }

    return null;
  }

  private toDocumentStorageKey(reference: string): string | null {
    const storageKey = this.toStorageKey(reference);
    if (!storageKey?.startsWith('uploads/')) return null;
    if (storageKey.startsWith(`uploads/${MANAGED_AVATAR_DIRECTORY}/`))
      return null;

    const fileName = storageKey.slice('uploads/'.length);
    if (!/^[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/.test(fileName)) return null;

    return storageKey;
  }

  private toStorageKeyFromUrl(value: string): string | null {
    if (!/^https?:\/\//i.test(value)) return null;

    try {
      const url = new URL(value);
      if (url.origin !== this.supabaseOrigin) return null;

      const marker = `/storage/v1/object/`;
      const markerIndex = url.pathname.indexOf(marker);
      if (markerIndex === -1) return null;

      const objectPath = url.pathname.slice(markerIndex + marker.length);
      const parts = objectPath.split('/').filter(Boolean);
      if (parts[0] !== 'public' && parts[0] !== 'sign') return null;
      if (parts[1] !== this.bucket) return null;

      return parts.slice(2).join('/') || null;
    } catch {
      return null;
    }
  }

  private async createReadableUrl(
    storageKey: string,
    rollbackOnFailure: boolean,
  ): Promise<string> {
    if (this.bucketIsPublic) {
      return this.client.storage.from(this.bucket).getPublicUrl(storageKey).data
        .publicUrl;
    }

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(storageKey, this.signedUrlExpiresInSeconds);

    if (error || !data?.signedUrl) {
      if (rollbackOnFailure) {
        await this.delete(storageKey);
      }
      throw new InternalServerErrorException(
        'Failed to create uploaded file URL',
      );
    }

    return data.signedUrl;
  }
}

function getContentType(pathOrKey: string): string {
  const extension = pathOrKey.split('.').pop()?.toLowerCase();
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
    default:
      return 'application/octet-stream';
  }
}
