import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { MongooseModule } from '@nestjs/mongoose';
import { KpiService } from './kpi.service';
import { MttrCalculationService } from './mttr-calculation.service';
import { MttrSourceService } from './mttr-source.service';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import { Stock, StockSchema } from '../schemas/stock.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { Panne, PanneSchema } from '../schemas/panne.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: Stock.name, schema: StockSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: User.name, schema: UserSchema },
      { name: Panne.name, schema: PanneSchema },
      {
        name: InterventionReport.name,
        schema: InterventionReportSchema,
      },
    ]),
    CacheModule.register(),
  ],
  providers: [KpiService, MttrCalculationService, MttrSourceService],
  exports: [KpiService, MttrCalculationService, MttrSourceService],
})
export class KpiModule {}
