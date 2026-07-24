import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FILE_STORAGE_PROVIDER } from './file-storage.types';
import { FileStorageService } from './file-storage.service';
import { LocalFileStorageProvider } from './local-file-storage.provider';
import { resolveFileStorageConfig } from './file-storage.config';
import { SupabaseStorageProvider } from './supabase-storage.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: FILE_STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = resolveFileStorageConfig(configService);
        return config.driver === 'supabase'
          ? new SupabaseStorageProvider(configService)
          : new LocalFileStorageProvider();
      },
    },
    FileStorageService,
  ],
  exports: [FileStorageService],
})
export class FileStorageModule {}
