import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AiAnomalyAnalysis,
  AiAnomalyAnalysisSchema,
} from '../schemas/ai-anomaly-analysis.schema';
import { Capteur, CapteurSchema } from '../schemas/capteur.schema';
import { Module as ModuleEntity, ModuleSchema } from '../schemas/module.schema';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationCenterModule } from '../notification-center/notification-center.module';
import { AiAnomalyController } from './ai-anomaly.controller';
import { AiAnomalyFastApiClient } from './ai-anomaly-fastapi.client';
import { AiAnomalyService } from './ai-anomaly.service';

@Module({
  imports: [
    ConfigModule,
    DocumentsModule,
    NotificationCenterModule,
    MongooseModule.forFeature([
      { name: AiAnomalyAnalysis.name, schema: AiAnomalyAnalysisSchema },
      { name: Capteur.name, schema: CapteurSchema },
      { name: ModuleEntity.name, schema: ModuleSchema },
    ]),
  ],
  controllers: [AiAnomalyController],
  providers: [AiAnomalyService, AiAnomalyFastApiClient],
  exports: [AiAnomalyService],
})
export class AiAnomalyModule {}
