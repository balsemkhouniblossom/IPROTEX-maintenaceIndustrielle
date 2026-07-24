import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import {
  PreventiveTask,
  PreventiveTaskSchema,
} from '../schemas/preventive-task.schema';
import { PreventiveTasksController } from './preventive-tasks.controller';
import { PreventiveTasksService } from './preventive-tasks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PreventiveTask.name, schema: PreventiveTaskSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
    ]),
  ],
  controllers: [PreventiveTasksController],
  providers: [PreventiveTasksService],
})
export class PreventiveTasksModule {}
