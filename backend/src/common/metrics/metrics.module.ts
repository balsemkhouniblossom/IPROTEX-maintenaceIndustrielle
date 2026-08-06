import { Module } from '@nestjs/common';
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
  providers: [MetricsRegistry],
  exports: [MetricsRegistry],
})
export class MetricsModule {}
