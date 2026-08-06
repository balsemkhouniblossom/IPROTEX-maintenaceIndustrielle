import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
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
    // In-memory store by default — the only thing `getAdminDashboard()`
    // caches. A Redis store is a drop-in swap here later (same pattern as
    // AuthThrottleStore) if this ever needs to be shared across more than
    // one backend instance; not needed at current scale.
    CacheModule.register(),
  ],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}
