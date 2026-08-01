import { ConfigService } from '@nestjs/config';
import { resolveFileStorageConfig } from './file-storage.config';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('resolveFileStorageConfig', () => {
  it('defaults to local storage outside production', () => {
    expect(
      resolveFileStorageConfig(config({ NODE_ENV: 'development' })).driver,
    ).toBe('local');
  });

  it('requires supabase storage in production', () => {
    expect(() =>
      resolveFileStorageConfig(
        config({
          NODE_ENV: 'production',
          FILE_STORAGE_DRIVER: 'local',
        }),
      ),
    ).toThrow('FILE_STORAGE_DRIVER must be supabase in production.');
  });

  it('requires Supabase credentials when Supabase is selected', () => {
    expect(() =>
      resolveFileStorageConfig(
        config({
          NODE_ENV: 'production',
          FILE_STORAGE_DRIVER: 'supabase',
        }),
      ),
    ).toThrow('Supabase storage requires');
  });

  it('accepts Supabase storage configuration', () => {
    const result = resolveFileStorageConfig(
      config({
        NODE_ENV: 'production',
        FILE_STORAGE_DRIVER: 'supabase',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SECRET_KEY: 'service-role-secret',
        SUPABASE_STORAGE_BUCKET: 'uploads',
      }),
    );

    expect(result.driver).toBe('supabase');
    expect(result.supabase.bucket).toBe('uploads');
  });
});
