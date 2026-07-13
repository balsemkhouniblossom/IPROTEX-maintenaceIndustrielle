import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OperatorController } from './operator.controller';
import { OperatorService } from './operator.service';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../schemas/intervention-report.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { DocumentEntity, DocumentSchema } from '../schemas/document.schema';
import { Panne, PanneSchema } from '../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionSchema,
} from '../schemas/panne-solution.schema';

@Module({
  imports: [
    WorkOrdersModule,
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: MachineType.name, schema: MachineTypeSchema },
      { name: DocumentEntity.name, schema: DocumentSchema },
      { name: Panne.name, schema: PanneSchema },
      { name: PanneSolution.name, schema: PanneSolutionSchema },
    ]),
  ],
  controllers: [OperatorController],
  providers: [OperatorService],
})
export class OperatorModule {}
