import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import { ModulesController } from './modules.controller';
import { ModulesService } from './modules.service';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import { Capteur, CapteurSchema } from '../schemas/capteur.schema';
import {
  LubrificationLog,
  LubrificationLogSchema,
} from '../schemas/lubrification-log.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModuleEntity.name, schema: ModuleSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: Capteur.name, schema: CapteurSchema },
      { name: LubrificationLog.name, schema: LubrificationLogSchema },
    ]),
  ],
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
