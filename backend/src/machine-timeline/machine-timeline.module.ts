import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { FaultEvent, FaultEventSchema } from '../schemas/fault-event.schema';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import {
  PreventiveTask,
  PreventiveTaskSchema,
} from '../schemas/preventive-task.schema';
import {
  LubrificationLog,
  LubrificationLogSchema,
} from '../schemas/lubrification-log.schema';
import {
  StockMovement,
  StockMovementSchema,
} from '../schemas/stock-movement.schema';
import {
  AiInteraction,
  AiInteractionSchema,
} from '../schemas/ai-interaction.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { DocumentsModule } from '../documents/documents.module';
import { MachineTimelineController } from './machine-timeline.controller';
import { MachineTimelineService } from './machine-timeline.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Machine.name, schema: MachineSchema },
      { name: ModuleEntity.name, schema: ModuleSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
      { name: FaultEvent.name, schema: FaultEventSchema },
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: PreventiveTask.name, schema: PreventiveTaskSchema },
      { name: LubrificationLog.name, schema: LubrificationLogSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: AiInteraction.name, schema: AiInteractionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    DocumentsModule,
  ],
  controllers: [MachineTimelineController],
  providers: [MachineTimelineService],
})
export class MachineTimelineModule {}
