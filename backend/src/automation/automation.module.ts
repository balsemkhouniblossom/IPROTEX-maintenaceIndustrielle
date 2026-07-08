import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { Stock, StockSchema } from '../schemas/stock.schema';
import {
  LubrificationLog,
  LubrificationLogSchema,
} from '../schemas/lubrification-log.schema';
import { Capteur, CapteurSchema } from '../schemas/capteur.schema';
import { Mesure, MesureSchema } from '../schemas/mesure.schema';
import { KPI, KPISchema } from '../schemas/kpi.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { AutomationSchedulerService } from './automation.scheduler.service';

@Module({
  imports: [
    WorkOrdersModule,
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: ModuleEntity.name, schema: ModuleSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
      { name: Stock.name, schema: StockSchema },
      { name: LubrificationLog.name, schema: LubrificationLogSchema },
      { name: Capteur.name, schema: CapteurSchema },
      { name: Mesure.name, schema: MesureSchema },
      { name: KPI.name, schema: KPISchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [AutomationSchedulerService],
})
export class AutomationModule {}
