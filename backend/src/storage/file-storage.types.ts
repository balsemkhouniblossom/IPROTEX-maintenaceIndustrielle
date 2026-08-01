export type FileStorageDriver = 'local' | 'supabase';

export type ManagedStorageFolder = 'uploads' | 'avatars' | 'quarantine';

export type StoreFileInput = {
  buffer: Buffer;
  fileName: string;
  folder: ManagedStorageFolder;
  contentType?: string;
};

export type StoredFile = {
  fileName: string;
  storageKey?: string;
  relativePath: string;
  url?: string;
  shouldPersistUrl?: boolean;
  size: number;
};

export type ProtectedStoredFile = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  size: number;
};

export interface FileStorageProvider {
  readonly driver: FileStorageDriver;
  save(input: StoreFileInput): Promise<StoredFile>;
  delete(relativePath: string): Promise<void>;
  readProtectedFile?(reference: string): Promise<ProtectedStoredFile>;
  createSignedReadUrl?(
    reference: string,
    expiresInSeconds?: number,
  ): Promise<string>;
  resolveUrl?(
    stablePath?: string | null,
    storedUrl?: string | null,
  ): Promise<string>;
  ownsFile?(reference: string): boolean;
  ownsAvatar?(reference: string): boolean;
}

export const FILE_STORAGE_PROVIDER = Symbol('FILE_STORAGE_PROVIDER');
