import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { SupabaseStorageProvider } from './supabase-storage.provider';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('SupabaseStorageProvider', () => {
  const mockedCreateClient = createClient as jest.Mock;
  const upload = jest.fn();
  const remove = jest.fn();
  const getPublicUrl = jest.fn();
  const createSignedUrl = jest.fn();
  const download = jest.fn();
  const from = jest.fn();

  function provider(values: Record<string, string | undefined> = {}) {
    from.mockReturnValue({
      upload,
      remove,
      getPublicUrl,
      createSignedUrl,
      download,
    });
    mockedCreateClient.mockReturnValue({
      storage: { from },
    });

    return new SupabaseStorageProvider(
      config({
        FILE_STORAGE_DRIVER: 'supabase',
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SECRET_KEY: 'service-role-secret',
        SUPABASE_STORAGE_BUCKET: 'bucket',
        ...values,
      }),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    upload.mockResolvedValue({ data: { path: 'uploads/avatar-1.webp' }, error: null });
    remove.mockResolvedValue({ data: [], error: null });
    getPublicUrl.mockReturnValue({
      data: {
        publicUrl:
          'https://project.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-1.webp',
      },
    });
    createSignedUrl.mockImplementation((path: string) =>
      Promise.resolve({
        data: {
          signedUrl: `https://project.supabase.co/storage/v1/object/sign/bucket/${path}?token=abc`,
        },
        error: null,
      }),
    );
    download.mockResolvedValue({
      data: new Blob([Buffer.from('file')], { type: 'application/pdf' }),
      error: null,
    });
  });

  it('creates a server-side Supabase client with the secret key only in NestJS', () => {
    provider();

    expect(mockedCreateClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'service-role-secret',
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: false,
          autoRefreshToken: false,
        }),
      }),
    );
  });

  it('uploads avatars with generated storage keys and returns public URLs for public buckets', async () => {
    const result = await provider({ SUPABASE_STORAGE_BUCKET_PUBLIC: 'true' }).save({
      buffer: Buffer.from('avatar'),
      fileName: 'avatar-1.webp',
      folder: 'avatars',
      contentType: 'image/webp',
    });

    expect(result.storageKey).toBe('uploads/avatars/avatar-1.webp');
    expect(result.relativePath).toBe('uploads/avatars/avatar-1.webp');
    expect(result.url).toContain('/storage/v1/object/public/bucket/uploads/avatars/avatar-1.webp');
    expect(result.shouldPersistUrl).toBe(true);
    expect(upload).toHaveBeenCalledWith('uploads/avatars/avatar-1.webp', Buffer.from('avatar'), {
      contentType: 'image/webp',
      upsert: false,
    });
  });

  it('returns signed URLs for private buckets', async () => {
    const result = await provider({
      SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS: '3600',
    }).save({
      buffer: Buffer.from('photo'),
      fileName: 'photo.webp',
      folder: 'uploads',
      contentType: 'image/webp',
    });

    expect(result.storageKey).toBe('uploads/photo.webp');
    expect(result.relativePath).toBe('uploads/photo.webp');
    expect(result.url).toContain('/storage/v1/object/sign/bucket/uploads/photo.webp');
    expect(result.shouldPersistUrl).toBe(false);
    expect(createSignedUrl).toHaveBeenCalledWith('uploads/photo.webp', 3600);
  });

  it('regenerates signed URLs from stable storage paths for private buckets', async () => {
    const storage = provider({
      SUPABASE_SIGNED_URL_EXPIRES_IN_SECONDS: '1800',
    });

    const first = await storage.resolveUrl('uploads/photo.webp');
    const second = await storage.resolveUrl('uploads/photo.webp');

    expect(first).toContain('token=abc');
    expect(second).toContain('token=abc');
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(createSignedUrl).toHaveBeenCalledWith('uploads/photo.webp', 1800);
  });

  it('falls back to the stored path when resolving a signed URL fails', async () => {
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'object not found' },
    });
    const storage = provider();

    await expect(storage.resolveUrl('uploads/missing.webp')).resolves.toBe(
      'uploads/missing.webp',
    );
  });

  it('falls back to a persisted URL when resolving a signed URL fails', async () => {
    const legacyUrl =
      'https://project.supabase.co/storage/v1/object/sign/bucket/uploads/missing.webp?token=old';
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'object not found' },
    });
    const storage = provider();

    await expect(
      storage.resolveUrl('uploads/missing.webp', legacyUrl),
    ).resolves.toBe(legacyUrl);
  });

  it('quarantines rejected uploads under their own prefix without ever generating a URL', async () => {
    const result = await provider({ SUPABASE_STORAGE_BUCKET_PUBLIC: 'true' }).save({
      buffer: Buffer.from('rejected'),
      fileName: 'rejected-1.rejected',
      folder: 'quarantine',
      contentType: 'application/octet-stream',
    });

    expect(result.storageKey).toBe('quarantine/rejected-1.rejected');
    expect(result.url).toBeUndefined();
    expect(result.shouldPersistUrl).toBe(false);
    expect(getPublicUrl).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('never treats a quarantine storage key as an ownable/servable document', () => {
    const storage = provider();

    expect(storage.ownsFile('quarantine/rejected-1.rejected')).toBe(false);
  });

  it('deletes by storage key for rollback', async () => {
    await provider().delete('uploads/photo.webp');

    expect(remove).toHaveBeenCalledWith(['uploads/photo.webp']);
  });

  it('owns only safe Supabase document storage keys and URLs', () => {
    const storage = provider();

    expect(storage.ownsFile('uploads/photo.webp')).toBe(true);
    expect(storage.ownsFile('uploads/nested/photo.webp')).toBe(false);
    expect(storage.ownsFile('uploads/../secret.txt')).toBe(false);
    expect(storage.ownsFile('uploads/avatars/avatar-1.webp')).toBe(false);
    expect(
      storage.ownsFile(
        'https://project.supabase.co/storage/v1/object/public/bucket/uploads/photo.webp',
      ),
    ).toBe(true);
    expect(storage.ownsFile('https://example.com/uploads/photo.webp')).toBe(false);
  });

  it('downloads protected Supabase document files by validated storage key', async () => {
    const result = await provider().readProtectedFile('uploads/manual.pdf');

    expect(download).toHaveBeenCalledWith('uploads/manual.pdf');
    expect(result).toEqual(
      expect.objectContaining({
        buffer: Buffer.from('file'),
        contentType: 'application/pdf',
        fileName: 'manual.pdf',
        size: 4,
      }),
    );
  });

  it('creates short-lived signed URLs only for protected document keys', async () => {
    const storage = provider();

    await expect(storage.createSignedReadUrl('uploads/manual.pdf', 30)).resolves.toContain(
      '/storage/v1/object/sign/bucket/uploads/manual.pdf',
    );
    expect(createSignedUrl).toHaveBeenCalledWith('uploads/manual.pdf', 30);
    await expect(
      storage.createSignedReadUrl('uploads/avatars/avatar-1.webp', 30),
    ).rejects.toThrow('Invalid managed file reference');
  });

  it('returns not found when a protected Supabase object is missing or expired', async () => {
    download.mockResolvedValue({ data: null, error: { message: 'not found' } });

    await expect(provider().readProtectedFile('uploads/missing.pdf')).rejects.toThrow(
      'Managed file not found',
    );
  });

  it('deletes owned Supabase public and signed URLs for replacement cleanup', async () => {
    const storage = provider();

    await storage.delete(
      'https://project.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-1.webp',
    );
    await storage.delete(
      'https://project.supabase.co/storage/v1/object/sign/bucket/uploads/photo.webp?token=abc',
    );

    expect(remove).toHaveBeenNthCalledWith(1, ['uploads/avatars/avatar-1.webp']);
    expect(remove).toHaveBeenNthCalledWith(2, ['uploads/photo.webp']);
  });

  it('owns only Supabase avatar objects from the configured bucket', () => {
    const storage = provider();

    expect(
      storage.ownsAvatar(
        'https://project.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-1.webp',
      ),
    ).toBe(true);
    expect(
      storage.ownsAvatar(
        'https://other.supabase.co/storage/v1/object/public/bucket/uploads/avatars/avatar-1.webp',
      ),
    ).toBe(false);
    expect(storage.ownsAvatar('https://lh3.googleusercontent.com/avatar.webp')).toBe(false);
  });
});
