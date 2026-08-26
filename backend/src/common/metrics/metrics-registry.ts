import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  BusinessMetricsCollector,
  BusinessMetricsSnapshot,
} from './business-metrics.collector';
import { normalizeRouteForMetrics } from './route-normalizer';

interface RouteStats {
  count: number;
  totalDurationMs: number;
}

const STATIC_METRIC_SERIES_COUNT = 10;
const METRIC_KEY_SEPARATOR = String.fromCodePoint(0);
const EMPTY_BUSINESS_METRICS: BusinessMetricsSnapshot = {
  openWorkOrders: 0,
  machineDowntimeHours: 0,
  completedInterventions: 0,
  lowStockItems: 0,
};

function escapeLabelValue(value: string): string {
  return value
    .replaceAll(String.fromCodePoint(92), String.raw`\\`)
    .replaceAll('"', String.raw`\"`);
}

/**
 * In-process request counters, rendered in Prometheus text exposition
 * format at `GET /health/metrics`. Deliberately in-memory and per-instance
 * (no cross-instance aggregation) — correct for the single-instance
 * deployment this app runs today; a real Prometheus setup would scrape
 * each instance independently anyway, which this already supports.
 */
@Injectable()
export class MetricsRegistry {
  private readonly logger = new Logger(MetricsRegistry.name);
  private readonly statsByKey = new Map<string, RouteStats>();
  private readonly processStartedAtSeconds = Date.now() / 1000;
  private metricsCollectionsTotal = 0;

  constructor(
    @Optional()
    private readonly businessMetricsCollector?: BusinessMetricsCollector,
  ) {}

  record(
    method: string,
    pathname: string,
    status: number,
    durationMs: number,
  ): void {
    const route = normalizeRouteForMetrics(pathname);
    const key = [method, route, String(status)].join(METRIC_KEY_SEPARATOR);
    const existing = this.statsByKey.get(key) ?? {
      count: 0,
      totalDurationMs: 0,
    };
    existing.count += 1;
    existing.totalDurationMs += durationMs;
    this.statsByKey.set(key, existing);
  }

  async renderPrometheusText(): Promise<string> {
    this.metricsCollectionsTotal += 1;
    const collectionTimestampSeconds = Date.now() / 1000;
    const { businessMetrics, businessMetricsSuccess } =
      await this.collectBusinessMetrics();
    const exposedSeriesCount =
      STATIC_METRIC_SERIES_COUNT + this.statsByKey.size * 3;

    const lines: string[] = [
      '# HELP gmao_backend_up Whether the GMAO backend process is running and able to render metrics.',
      '# TYPE gmao_backend_up gauge',
      'gmao_backend_up 1',
      '# HELP gmao_backend_start_time_seconds Unix timestamp for when the GMAO backend metrics registry was created.',
      '# TYPE gmao_backend_start_time_seconds gauge',
      `gmao_backend_start_time_seconds ${this.processStartedAtSeconds}`,
      '# HELP gmao_metrics_collection_timestamp_seconds Unix timestamp for the latest metrics collection render.',
      '# TYPE gmao_metrics_collection_timestamp_seconds gauge',
      `gmao_metrics_collection_timestamp_seconds ${collectionTimestampSeconds}`,
      '# HELP gmao_metrics_collections_total Total times the GMAO backend metrics endpoint has rendered metrics.',
      '# TYPE gmao_metrics_collections_total counter',
      `gmao_metrics_collections_total ${this.metricsCollectionsTotal}`,
      '# HELP gmao_metrics_exposed_series Number of backend metric series exposed in the latest metrics render.',
      '# TYPE gmao_metrics_exposed_series gauge',
      `gmao_metrics_exposed_series ${exposedSeriesCount}`,
      '# HELP gmao_business_metrics_collection_success Whether business metric collection succeeded during the latest metrics render.',
      '# TYPE gmao_business_metrics_collection_success gauge',
      `gmao_business_metrics_collection_success ${businessMetricsSuccess ? 1 : 0}`,
      '# HELP gmao_work_orders_open Current number of open work orders.',
      '# TYPE gmao_work_orders_open gauge',
      `gmao_work_orders_open ${businessMetrics.openWorkOrders}`,
      '# HELP gmao_machine_downtime_hours_total Total completed corrective machine downtime in hours.',
      '# TYPE gmao_machine_downtime_hours_total gauge',
      `gmao_machine_downtime_hours_total ${businessMetrics.machineDowntimeHours}`,
      '# HELP gmao_interventions_completed_total Current number of completed intervention reports.',
      '# TYPE gmao_interventions_completed_total gauge',
      `gmao_interventions_completed_total ${businessMetrics.completedInterventions}`,
      '# HELP gmao_stock_low_items Current number of stock records at or below their alert threshold.',
      '# TYPE gmao_stock_low_items gauge',
      `gmao_stock_low_items ${businessMetrics.lowStockItems}`,
      '# HELP http_requests_total Total HTTP requests handled, labeled by method, route, and status code.',
      '# TYPE http_requests_total counter',
    ];

    for (const [key, stats] of this.statsByKey) {
      const [method, route, status] = key.split(METRIC_KEY_SEPARATOR);
      const labels = `method="${method}",route="${escapeLabelValue(route)}",status="${status}"`;
      lines.push(`http_requests_total{${labels}} ${stats.count}`);
    }

    lines.push(
      '# HELP http_request_duration_ms_sum Sum of request durations in milliseconds, labeled by method, route, and status code.',
      '# TYPE http_request_duration_ms_sum counter',
    );
    for (const [key, stats] of this.statsByKey) {
      const [method, route, status] = key.split(METRIC_KEY_SEPARATOR);
      const labels = `method="${method}",route="${escapeLabelValue(route)}",status="${status}"`;
      lines.push(
        `http_request_duration_ms_sum{${labels}} ${stats.totalDurationMs}`,
      );
    }

    lines.push(
      '# HELP http_request_duration_ms_count Count of request durations in milliseconds, labeled by method, route, and status code.',
      '# TYPE http_request_duration_ms_count counter',
    );
    for (const [key, stats] of this.statsByKey) {
      const [method, route, status] = key.split(METRIC_KEY_SEPARATOR);
      const labels = `method="${method}",route="${escapeLabelValue(route)}",status="${status}"`;
      lines.push(`http_request_duration_ms_count{${labels}} ${stats.count}`);
    }

    return lines.join('\n') + '\n';
  }

  resetForTests(): void {
    this.statsByKey.clear();
    this.metricsCollectionsTotal = 0;
  }

  private async collectBusinessMetrics(): Promise<{
    businessMetrics: BusinessMetricsSnapshot;
    businessMetricsSuccess: boolean;
  }> {
    if (!this.businessMetricsCollector) {
      return {
        businessMetrics: EMPTY_BUSINESS_METRICS,
        businessMetricsSuccess: false,
      };
    }

    try {
      return {
        businessMetrics: await this.businessMetricsCollector.collect(),
        businessMetricsSuccess: true,
      };
    } catch (error) {
      this.logger.warn(
        `Business metrics collection failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        businessMetrics: EMPTY_BUSINESS_METRICS,
        businessMetricsSuccess: false,
      };
    }
  }
}
