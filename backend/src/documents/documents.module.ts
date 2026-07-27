import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { DocumentsController } from './documents.controller';
import { DocumentsUploadController } from './documents-upload.controller';
import { DocumentsService } from './documents.service';
import { DocumentAccessService } from './document-access.service';
import { FileStorageModule } from '../storage/file-storage.module';

import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import {
  DocumentRejection,
  DocumentRejectionSchema,
} from '../schemas/document-rejection.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';

@Module({
  imports: [
    FileStorageModule,
    MongooseModule.forFeature([
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: DocumentRejection.name, schema: DocumentRejectionSchema },
      { name: Machine.name, schema: MachineSchema }, // ✅ REQUIRED FIX
      { name: User.name, schema: UserSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
    ]),
  ],
  controllers: [DocumentsController, DocumentsUploadController],
  providers: [DocumentsService, DocumentAccessService],
  exports: [DocumentAccessService, DocumentsService],
})
export class DocumentsModule {}
