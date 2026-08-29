import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkOrder, WorkOrderSchema } from '../schemas/work-order.schema';
import {
  TranslationCache,
  TranslationCacheSchema,
} from '../schemas/translation-cache.schema';
import { DynamicContentTranslationController } from './dynamic-content-translation.controller';
import { DynamicContentTranslationService } from './dynamic-content-translation.service';
import { GeminiDynamicTranslationProvider } from './dynamic-translation.provider';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: TranslationCache.name, schema: TranslationCacheSchema },
    ]),
  ],
  controllers: [DynamicContentTranslationController],
  providers: [DynamicContentTranslationService, GeminiDynamicTranslationProvider],
})
export class DynamicContentTranslationModule {}
