import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KpiService } from './kpi.service';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import { Stock, StockSchema } from '../schemas/stock.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { User, UserSchema } from '../schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: Stock.name, schema: StockSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
