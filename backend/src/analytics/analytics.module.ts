import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { KpiModule } from '../kpi/kpi.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [DocumentsModule, KpiModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
