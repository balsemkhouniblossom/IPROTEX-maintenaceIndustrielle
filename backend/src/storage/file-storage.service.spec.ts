import { FileStorageService } from './file-storage.service';
import { FileStorageProvider, StoreFileInput } from './file-storage.types';

describe('FileStorageService', () => {
  const input: StoreFileInput = {
    buffer: Buffer.from('test'),
    fileName: 'test.pdf',
    folder: 'uploads',
  };

  it('delegates save to provider', async () => {
    const provider = {
      save: jest.fn().mockResolvedValue({ relativePath: '/test/file.pdf' }),
    } as unknown as FileStorageProvider;
    const service = new FileStorageService(provider);
    const result = await service.save(input);
    expect(provider.save).toHaveBeenCalledWith(input);
    expect(result.relativePath).toBe('/test/file.pdf');
  });

  it('delegates delete to provider', async () => {
    const provider = {
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as FileStorageProvider;
    const service = new FileStorageService(provider);
    await service.delete('/test/file.pdf');
    expect(provider.delete).toHaveBeenCalledWith('/test/file.pdf');
  });

  it('ownsAvatar returns false when provider has no ownsAvatar', async () => {
    const provider = {} as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(service.ownsAvatar('ref-1')).toBe(false);
  });

  it('ownsAvatar delegates to provider', async () => {
    const provider = {
      ownsAvatar: jest.fn().mockReturnValue(true),
    } as unknown as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(service.ownsAvatar('ref-1')).toBe(true);
  });

  it('ownsFile returns false for empty reference', async () => {
    const provider = {} as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(service.ownsFile(undefined)).toBe(false);
    expect(service.ownsFile(null)).toBe(false);
  });

  it('ownsFile delegates to provider', async () => {
    const provider = {
      ownsFile: jest.fn().mockReturnValue(true),
    } as unknown as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(service.ownsFile('ref-1')).toBe(true);
  });

  it('readProtectedFile throws when provider lacks support', () => {
    const provider = {} as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(() => service.readProtectedFile('ref-1')).toThrow(
      'Storage provider does not support protected file reads',
    );
  });

  it('readProtectedFile delegates to provider', async () => {
    const provider = {
      readProtectedFile: jest
        .fn()
        .mockResolvedValue({ fileName: 'file.pdf', contentType: 'application/pdf', size: 100 }),
    } as unknown as FileStorageProvider;
    const service = new FileStorageService(provider);
    const result = await service.readProtectedFile('ref-1');
    expect(provider.readProtectedFile).toHaveBeenCalledWith('ref-1');
    expect(result.fileName).toBe('file.pdf');
  });

  it('createSignedReadUrl throws when provider lacks support', () => {
    const provider = {} as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(() => service.createSignedReadUrl('ref-1')).toThrow(
      'Storage provider does not support signed file URLs',
    );
  });

  it('createSignedReadUrl delegates to provider', async () => {
    const provider = {
      createSignedReadUrl: jest
        .fn()
        .mockResolvedValue('https://example.com/file.pdf?token=abc'),
    } as unknown as FileStorageProvider;
    const service = new FileStorageService(provider);
    const result = await service.createSignedReadUrl('ref-1', 3600);
    expect(provider.createSignedReadUrl).toHaveBeenCalledWith('ref-1', 3600);
    expect(result).toBe('https://example.com/file.pdf?token=abc');
  });

  it('resolveUrl returns storedUrl when available', async () => {
    const provider = {} as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(await service.resolveUrl(undefined, 'https://example.com/file.pdf')).toBe(
      'https://example.com/file.pdf',
    );
  });

  it('resolveUrl returns stablePath when no storedUrl', async () => {
    const provider = {} as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(await service.resolveUrl('/stable/path.pdf')).toBe('/stable/path.pdf');
  });

  it('resolveUrl returns empty string for no input', async () => {
    const provider = {} as FileStorageProvider;
    const service = new FileStorageService(provider);
    expect(await service.resolveUrl()).toBe('');
  });
});
