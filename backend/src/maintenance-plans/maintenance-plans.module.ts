import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import { MaintenancePlansController } from './maintenance-plans.controller';
import { MaintenancePlansService } from './maintenance-plans.service';
import { WorkOrdersModule } from '../work-orders/work-orders.module';

@Module({
  imports: [
    WorkOrdersModule,
    MongooseModule.forFeature([
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
    ]),
  ],
  controllers: [MaintenancePlansController],
  providers: [MaintenancePlansService],
  exports: [MaintenancePlansService],
})
export class MaintenancePlansModule {}
