import * as fs from 'fs/promises';
import { LocalFileStorageProvider } from './local-file-storage.provider';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  access: jest.fn(),
  unlink: jest.fn(),
  readFile: jest.fn(),
}));

describe('LocalFileStorageProvider', () => {
  const mockedFs = fs as jest.Mocked<typeof fs>;
  let provider: LocalFileStorageProvider;

  beforeEach(() => {
    provider = new LocalFileStorageProvider();
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.writeFile.mockResolvedValue(undefined);
    mockedFs.access.mockResolvedValue(undefined);
    mockedFs.unlink.mockResolvedValue(undefined);
    mockedFs.readFile.mockResolvedValue(Buffer.from('file'));
  });

  afterEach(() => jest.clearAllMocks());

  it('stores avatar files in the managed local avatar directory', async () => {
    const result = await provider.save({
      buffer: Buffer.from('avatar'),
      fileName: 'avatar-1.webp',
      folder: 'avatars',
      contentType: 'image/webp',
    });

    expect(result.relativePath).toBe('/files/uploads/avatars/avatar-1.webp');
    expect(mockedFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('avatar-1.webp'),
      Buffer.from('avatar'),
    );
    expect(mockedFs.access).toHaveBeenCalledWith(mockedFs.writeFile.mock.calls[0][0]);
  });

  it('stores document files in the managed upload directory', async () => {
    const result = await provider.save({
      buffer: Buffer.from('photo'),
      fileName: 'photo.webp',
      folder: 'uploads',
      contentType: 'image/webp',
    });

    expect(result.relativePath).toBe('/uploads/photo.webp');
  });

  it('deletes managed files by relative path only', async () => {
    await provider.delete('/files/uploads/avatars/avatar-1.webp');

    expect(mockedFs.unlink).toHaveBeenCalledWith(
      expect.stringContaining('avatar-1.webp'),
    );
  });

  it('treats missing local managed files as already deleted', async () => {
    mockedFs.unlink.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );

    await expect(provider.delete('/uploads/missing.webp')).resolves.toBeUndefined();
  });

  it('owns only safe managed document file paths', () => {
    expect(provider.ownsFile('/uploads/document.webp')).toBe(true);
    expect(provider.ownsFile('uploads/document.webp')).toBe(true);
    expect(provider.ownsFile('/uploads/nested/document.webp')).toBe(false);
    expect(provider.ownsFile('/uploads/../secret.txt')).toBe(false);
    expect(provider.ownsFile('/files/uploads/avatars/avatar-1.webp')).toBe(false);
    expect(provider.ownsFile('https://example.com/document.webp')).toBe(false);
  });

  it('reads protected local files from the managed upload directory', async () => {
    const result = await provider.readProtectedFile('/uploads/manual.pdf');

    expect(result).toEqual(
      expect.objectContaining({
        buffer: Buffer.from('file'),
        contentType: 'application/pdf',
        fileName: 'manual.pdf',
        size: 4,
      }),
    );
    expect(mockedFs.readFile).toHaveBeenCalledWith(
      expect.stringContaining('manual.pdf'),
    );
  });

  it('rejects path traversal before reading local protected files', async () => {
    await expect(provider.readProtectedFile('/uploads/../secret.txt')).rejects.toThrow(
      'Invalid managed file reference',
    );
    expect(mockedFs.readFile).not.toHaveBeenCalled();
  });

  it('owns only managed avatar references', () => {
    expect(provider.ownsAvatar('/files/uploads/avatars/avatar-1.webp')).toBe(true);
    expect(provider.ownsAvatar('/files/uploads/avatars/default-avatar.webp')).toBe(false);
    expect(provider.ownsAvatar('https://example.com/avatar-1.webp')).toBe(false);
  });
});
