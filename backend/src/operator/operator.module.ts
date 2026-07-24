import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { Module as MachineModule, ModuleSchema } from '../schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import { Lubrifiant, LubrifiantSchema } from '../schemas/lubrifiant.schema';
import { KPI, KPISchema } from '../schemas/kpi.schema';
import { Catalogue, CatalogueSchema } from '../schemas/catalogue.schema';
import { Stock, StockSchema } from '../schemas/stock.schema';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import { Panne, PanneSchema } from '../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionSchema,
} from '../schemas/panne-solution.schema';
import { User, UserSchema } from '../schemas/user.schema';

@Module({
  imports: [
    WorkOrdersModule,
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: MachineType.name, schema: MachineTypeSchema },
      { name: MachineModule.name, schema: ModuleSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: Lubrifiant.name, schema: LubrifiantSchema },
      { name: KPI.name, schema: KPISchema },
      { name: Catalogue.name, schema: CatalogueSchema },
      { name: Stock.name, schema: StockSchema },
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: Panne.name, schema: PanneSchema },
      { name: PanneSolution.name, schema: PanneSolutionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [OperatorController],
  providers: [OperatorService],
})
export class OperatorModule {}
