import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkOrdersService } from './work-orders.service';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import { CounterModule } from '../counters/counter.module';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { Panne, PanneSchema } from '../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionSchema,
} from '../schemas/panne-solution.schema';
import { KPI, KPISchema } from '../schemas/kpi.schema';
import { Stock, StockSchema } from '../schemas/stock.schema';
import { Catalogue, CatalogueSchema } from '../schemas/catalogue.schema';
import { OTPieces, OTPiecesSchema } from '../schemas/ot-pieces.schema';
import { Lubrifiant, LubrifiantSchema } from '../schemas/lubrifiant.schema';
import {
  LubrificationLog,
  LubrificationLogSchema,
} from '../schemas/lubrification-log.schema';
import { PartRequest, PartRequestSchema } from '../schemas/part-request.schema';
import { MaintenanceSchedulingService } from './maintenance-scheduling.service';
import { NotificationCenterModule } from '../notification-center/notification-center.module';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { KpiModule } from '../kpi/kpi.module';

@Module({
  imports: [
    CounterModule,
    NotificationCenterModule,
    StockMovementsModule,
    KpiModule,
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: ModuleEntity.name, schema: ModuleSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: MachineType.name, schema: MachineTypeSchema },
      { name: User.name, schema: UserSchema },
      { name: Panne.name, schema: PanneSchema },
      { name: PanneSolution.name, schema: PanneSolutionSchema },
      { name: KPI.name, schema: KPISchema },
      { name: Stock.name, schema: StockSchema },
      { name: Catalogue.name, schema: CatalogueSchema },
      { name: OTPieces.name, schema: OTPiecesSchema },
      { name: Lubrifiant.name, schema: LubrifiantSchema },
      { name: LubrificationLog.name, schema: LubrificationLogSchema },
      { name: PartRequest.name, schema: PartRequestSchema },
    ]),
  ],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService, MaintenanceSchedulingService],
  exports: [WorkOrdersService, MaintenanceSchedulingService],
})
export class WorkOrdersModule {}
