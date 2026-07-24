import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ModulePieces,
  ModulePiecesSchema,
} from '../schemas/module-pieces.schema';
import { ModulePiecesController } from './module-pieces.controller';
import { ModulePiecesService } from './module-pieces.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModulePieces.name, schema: ModulePiecesSchema },
    ]),
  ],
  controllers: [ModulePiecesController],
  providers: [ModulePiecesService],
})
export class ModulePiecesModule {}
