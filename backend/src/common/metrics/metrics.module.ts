import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KpiModule } from '../../kpi/kpi.module';
import {
  InterventionReport,
  InterventionReportSchema,
} from '../../schemas/intervention-report.schema';
import { WorkOrder, WorkOrderSchema } from '../../schemas/work-order.schema';
import { BusinessMetricsCollector } from './business-metrics.collector';
import { MetricsRegistry } from './metrics-registry';

/**
 * Shared singleton for `MetricsRegistry` — imported by both `AppModule`
 * (so `RequestLoggingMiddleware` can record into it) and `HealthModule`
 * (so `GET /health/metrics` can render it). Nest resolves a provider
 * exported from an imported module as the same instance everywhere it's
 * imported, so both sides see one shared registry, not two independent
 * counters.
 */
@Module({
  imports: [
    KpiModule,
    MongooseModule.forFeature([
      { name: WorkOrder.name, schema: WorkOrderSchema },
      { name: InterventionReport.name, schema: InterventionReportSchema },
    ]),
  ],
  providers: [BusinessMetricsCollector, MetricsRegistry],
  exports: [MetricsRegistry],
})
export class MetricsModule {}
