import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Mesure, MesureSchema } from '../schemas/mesure.schema';
import { MesuresController } from './mesures.controller';
import { MesuresService } from './mesures.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Mesure.name, schema: MesureSchema }]),
  ],
  controllers: [MesuresController],
  providers: [MesuresService],
})
export class MesuresModule {}
