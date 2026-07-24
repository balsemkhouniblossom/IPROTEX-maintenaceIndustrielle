import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { DocumentsController } from './documents.controller';
import { DocumentsUploadController } from './documents-upload.controller';
import { DocumentsService } from './documents.service';
import { DocumentAccessService } from './document-access.service';
import { FileStorageModule } from '../storage/file-storage.module';

import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';

@Module({
  imports: [
    FileStorageModule,
    MongooseModule.forFeature([
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: Machine.name, schema: MachineSchema }, // ✅ REQUIRED FIX
      { name: User.name, schema: UserSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
    ]),
  ],
  controllers: [DocumentsController, DocumentsUploadController],
  providers: [DocumentsService, DocumentAccessService],
  exports: [DocumentAccessService],
})
export class DocumentsModule {}
