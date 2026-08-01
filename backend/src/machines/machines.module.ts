import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MachinesService } from './machines.service';
import { MachinesController } from './machines.controller';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import { Device, DeviceSchema } from '../schemas/device.schema';
import { FaultEvent, FaultEventSchema } from '../schemas/fault-event.schema';
import { Telemetry, TelemetrySchema } from '../schemas/telemetry.schema';
import {
  MachineHealthPrediction,
  MachineHealthPredictionSchema,
} from '../schemas/machine-health-prediction.schema';
import { KPI, KPISchema } from '../schemas/kpi.schema';
import {
  KnowledgeArticle,
  KnowledgeArticleSchema,
} from '../schemas/knowledge-article.schema';
import {
  AiInteraction,
  AiInteractionSchema,
} from '../schemas/ai-interaction.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Machine.name, schema: MachineSchema },
      { name: ModuleEntity.name, schema: ModuleSchema },
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: Device.name, schema: DeviceSchema },
      { name: FaultEvent.name, schema: FaultEventSchema },
      { name: Telemetry.name, schema: TelemetrySchema },
      {
        name: MachineHealthPrediction.name,
        schema: MachineHealthPredictionSchema,
      },
      { name: KPI.name, schema: KPISchema },
      { name: KnowledgeArticle.name, schema: KnowledgeArticleSchema },
      { name: AiInteraction.name, schema: AiInteractionSchema },
    ]),
  ],
  controllers: [MachinesController],
  providers: [MachinesService],
  exports: [MachinesService],
})
export class MachinesModule {}
