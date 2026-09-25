import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Panne, PanneSchema } from '../schemas/panne.schema';
import { PannesController } from './pannes.controller';
import { PannesService } from './pannes.service';
import { PannePart, PannePartSchema } from '../schemas/panne-part.schema';
import { MachineType, MachineTypeSchema } from '../schemas/machine-type.schema';
import { Catalogue, CatalogueSchema } from '../schemas/catalogue.schema';
import { ModuleType, ModuleTypeSchema } from '../schemas/module-type.schema';
import {
  ModulePieces,
  ModulePiecesSchema,
} from '../schemas/module-pieces.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Panne.name, schema: PanneSchema },
      { name: PannePart.name, schema: PannePartSchema },
      { name: MachineType.name, schema: MachineTypeSchema },
      { name: Catalogue.name, schema: CatalogueSchema },
      { name: ModuleType.name, schema: ModuleTypeSchema },
      { name: ModulePieces.name, schema: ModulePiecesSchema },
    ]),
  ],
  controllers: [PannesController],
  providers: [PannesService],
  exports: [PannesService],
})
export class PannesModule {}
