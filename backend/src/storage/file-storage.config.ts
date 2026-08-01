import { ConfigService } from '@nestjs/config';
import type { FileStorageDriver } from './file-storage.types';

export type FileStorageConfig = {
  driver: FileStorageDriver;
  supabase: {
    url?: string;
    secretKey?: string;
    bucket?: string;
    bucketIsPublic: boolean;
    signedUrlExpiresInSeconds: number;
  };
};

function isProduction(configService: ConfigService): boolean {
  return configService.get<string>('NODE_ENV') === 'production';
}

function normalizeDriver(value?: string): FileStorageDriver | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'local' || normalized === 'supabase'
    ? normalized
    : null;
}

export function resolveFileStorageConfig(
  configService: ConfigService,
): FileStorageConfig {
  const configuredDriver = normalizeDriver(
    configService.get<string>('FILE_STORAGE_DRIVER'),
  );

  if (configService.get<string>('FILE_STORAGE_DRIVER') && !configuredDriver) {
    throw new Error(
      'Invalid FILE_STORAGE_DRIVER. Expected "local" or "supabase".',
    );
  }

  const driver =
    configuredDriver ?? (isProduction(configService) ? 'supabase' : 'local');
  if (isProduction(configService) && driver !== 'supabase') {
    throw new Error('FILE_STORAGE_DRIVER must be supabase in production.');
  }

  const supabase = {
    url: configService.get<string>('SUPABASE_URL'),
    secretKey: configService.get<string>('SUPABASE_SECRET_KEY'),
    bucket: configService.get<string>('SUPABASE_STORAGE_BUCKET'),
    bucketIsPublic:
      configService.get<string>('SUPABASE_STORAGE_BUCKET_PUBLIC') === 'true',
    signedUrlExpiresInSeconds: Number(
      configService.get<string>('SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS') ??
        60 * 60 * 24 * 7,
    ),
  };

  if (driver === 'supabase') {
    if (
      !supabase.url?.trim() ||
      !supabase.secretKey?.trim() ||
      !supabase.bucket?.trim()
    ) {
      throw new Error(
        'Supabase storage requires SUPABASE_URL, SUPABASE_SECRET_KEY, and SUPABASE_STORAGE_BUCKET.',
      );
    }

    if (
      !Number.isFinite(supabase.signedUrlExpiresInSeconds) ||
      supabase.signedUrlExpiresInSeconds <= 0
    ) {
      throw new Error(
        'SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS must be a positive number.',
      );
    }
  }

  return { driver, supabase };
}
