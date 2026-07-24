import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User, UserSchema } from '../schemas/user.schema';
import { FileUploadService } from '../file-upload.service';
import { AdminAccountGuard } from '../auth/guards/admin-account.guard';
import { FileStorageModule } from '../storage/file-storage.module';

@Module({
  imports: [
    FileStorageModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, FileUploadService, AdminAccountGuard],
  exports: [UsersService],
})
export class UsersModule {}
