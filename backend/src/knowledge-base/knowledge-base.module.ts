import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';

import {
  KnowledgeArticle,
  KnowledgeArticleSchema,
} from '../schemas/knowledge-article.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import {
  MaintenancePlan,
  MaintenancePlanSchema,
} from '../schemas/maintenance-plan.schema';
import {
  PreventiveTask,
  PreventiveTaskSchema,
} from '../schemas/preventive-task.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KnowledgeArticle.name, schema: KnowledgeArticleSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: MachineType.name, schema: MachineTypeSchema },
      { name: MaintenancePlan.name, schema: MaintenancePlanSchema },
      { name: PreventiveTask.name, schema: PreventiveTaskSchema },
    ]),
  ],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
