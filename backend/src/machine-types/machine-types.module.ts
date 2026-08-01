import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MachineTypesService } from './machine-types.service';
import { MachineTypesController } from './machine-types.controller';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { Machine, MachineSchema } from '../schemas/machine.schema';
import { ModuleType, ModuleTypeSchema } from '../schemas/module-type.schema';
import {
  KnowledgeArticle,
  KnowledgeArticleSchema,
} from '../schemas/knowledge-article.schema';
import { CounterModule } from '../counters/counter.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MachineType.name, schema: MachineTypeSchema },
      { name: Machine.name, schema: MachineSchema },
      { name: ModuleType.name, schema: ModuleTypeSchema },
      { name: KnowledgeArticle.name, schema: KnowledgeArticleSchema },
    ]),
    CounterModule,
  ],
  controllers: [MachineTypesController],
  providers: [MachineTypesService],
  exports: [MachineTypesService],
})
export class MachineTypesModule {}
