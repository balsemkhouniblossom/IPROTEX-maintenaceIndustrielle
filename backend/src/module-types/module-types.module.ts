import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModuleTypesService } from './module-types.service';
import { ModuleTypesController } from './module-types.controller';
import { ModuleType, ModuleTypeSchema } from '../schemas/module-type.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import {
  ModulePieces,
  ModulePiecesSchema,
} from '../schemas/module-pieces.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModuleType.name, schema: ModuleTypeSchema },
      { name: ModuleEntity.name, schema: ModuleSchema },
      { name: ModulePieces.name, schema: ModulePiecesSchema },
    ]),
  ],
  controllers: [ModuleTypesController],
  providers: [ModuleTypesService],
  exports: [ModuleTypesService],
})
export class ModuleTypesModule {}
