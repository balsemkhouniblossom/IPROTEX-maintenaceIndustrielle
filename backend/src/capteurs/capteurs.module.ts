import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CapteursController } from './capteurs.controller';
import { CapteursService } from './capteurs.service';
import { Capteur, CapteurSchema } from '../schemas/capteur.schema';
import { Mesure, MesureSchema } from '../schemas/mesure.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Capteur.name, schema: CapteurSchema },
      { name: Mesure.name, schema: MesureSchema },
    ]),
  ],
  controllers: [CapteursController],
  providers: [CapteursService],
})
export class CapteursModule {}
