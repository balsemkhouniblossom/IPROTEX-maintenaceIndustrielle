import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TechnicianController } from './technician.controller';
import { TechnicianService } from './technician.service';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import { OTPieces, OTPiecesSchema } from '../schemas/ot-pieces.schema';
import { Catalogue, CatalogueSchema } from '../schemas/catalogue.schema';
import { Stock, StockSchema } from '../schemas/stock.schema';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationCenterModule } from '../notification-center/notification-center.module';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { KpiModule } from '../kpi/kpi.module';

@Module({
  imports: [
    WorkOrdersModule,
    DocumentsModule,
    NotificationCenterModule,
    StockMovementsModule,
    KpiModule,
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: OTPieces.name, schema: OTPiecesSchema },
      { name: Catalogue.name, schema: CatalogueSchema },
      { name: Stock.name, schema: StockSchema },
    ]),
  ],
  controllers: [TechnicianController],
  providers: [TechnicianService],
})
export class TechnicianModule {}
