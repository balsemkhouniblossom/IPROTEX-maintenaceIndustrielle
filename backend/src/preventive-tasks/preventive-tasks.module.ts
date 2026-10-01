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
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { Module as MachineModule, ModuleSchema } from '../schemas/module.schema';
import { PreventiveTasksController } from './preventive-tasks.controller';
import { PreventiveTasksService } from './preventive-tasks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PreventiveTask.name, schema: PreventiveTaskSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: MachineModule.name, schema: ModuleSchema },
    ]),
  ],
  controllers: [PreventiveTasksController],
  providers: [PreventiveTasksService],
  exports: [PreventiveTasksService],
})
export class PreventiveTasksModule {}
