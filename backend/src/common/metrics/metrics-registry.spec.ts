import { MetricsRegistry } from './metrics-registry';

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  it('aggregates counts and total duration for repeated requests to the same normalized route', async () => {
    registry.record('GET', '/work-orders/64f1a2b3c4d5e6f7a8b9c0d1', 200, 10);
    registry.record('GET', '/work-orders/aaaaaaaaaaaaaaaaaaaaaaaa', 200, 20);

    const text = await registry.renderPrometheusText();

    expect(text).toContain(
      'http_requests_total{method="GET",route="/work-orders/:id",status="200"} 2',
    );
    expect(text).toContain(
      'http_request_duration_ms_sum{method="GET",route="/work-orders/:id",status="200"} 30',
    );
    expect(text).toContain(
      'http_request_duration_ms_count{method="GET",route="/work-orders/:id",status="200"} 2',
    );
  });

  it('keeps distinct status codes as separate series for the same route', async () => {
    registry.record('GET', '/health', 200, 5);
    registry.record('GET', '/health', 500, 5);

    const text = await registry.renderPrometheusText();

    expect(text).toContain(
      'http_requests_total{method="GET",route="/health",status="200"} 1',
    );
    expect(text).toContain(
      'http_requests_total{method="GET",route="/health",status="500"} 1',
    );
  });

  it('includes HELP/TYPE metadata lines for backend health and request metrics', async () => {
    registry.record('GET', '/health', 200, 5);

    const text = await registry.renderPrometheusText();

    expect(text).toContain('# TYPE gmao_backend_up gauge');
    expect(text).toContain('# TYPE gmao_backend_start_time_seconds gauge');
    expect(text).toContain(
      '# TYPE gmao_metrics_collection_timestamp_seconds gauge',
    );
    expect(text).toContain('# TYPE gmao_metrics_collections_total counter');
    expect(text).toContain('# TYPE gmao_metrics_exposed_series gauge');
    expect(text).toContain(
      '# TYPE gmao_business_metrics_collection_success gauge',
    );
    expect(text).toContain('# TYPE gmao_work_orders_open gauge');
    expect(text).toContain('# TYPE gmao_machine_downtime_hours_total gauge');
    expect(text).toContain('# TYPE gmao_interventions_completed_total gauge');
    expect(text).toContain('# TYPE gmao_stock_low_items gauge');
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('# TYPE http_request_duration_ms_sum counter');
    expect(text).toContain('# TYPE http_request_duration_ms_count counter');
  });

  it('increments the metrics collection counter every time metrics are rendered', async () => {
    const first = await registry.renderPrometheusText();
    const second = await registry.renderPrometheusText();

    expect(first).toContain('gmao_metrics_collections_total 1');
    expect(second).toContain('gmao_metrics_collections_total 2');
  });

  it('renders collected business metrics when a collector is available', async () => {
    registry = new MetricsRegistry({
      collect: jest.fn().mockResolvedValue({
        openWorkOrders: 7,
        machineDowntimeHours: 12.5,
        completedInterventions: 4,
        lowStockItems: 2,
      }),
    } as never);

    const text = await registry.renderPrometheusText();

    expect(text).toContain('gmao_business_metrics_collection_success 1');
    expect(text).toContain('gmao_work_orders_open 7');
    expect(text).toContain('gmao_machine_downtime_hours_total 12.5');
    expect(text).toContain('gmao_interventions_completed_total 4');
    expect(text).toContain('gmao_stock_low_items 2');
  });

  it('keeps rendering base metrics when business metric collection fails', async () => {
    registry = new MetricsRegistry({
      collect: jest.fn().mockRejectedValue(new Error('database unavailable')),
    } as never);

    const text = await registry.renderPrometheusText();

    expect(text).toContain('gmao_backend_up 1');
    expect(text).toContain('gmao_business_metrics_collection_success 0');
    expect(text).toContain('gmao_work_orders_open 0');
  });

  it('escapes route label values for Prometheus text output', async () => {
    registry.record('GET', String.raw`/docs/"manual"\v1`, 200, 5);

    const text = await registry.renderPrometheusText();

    expect(text).toContain(String.raw`route="/docs/\"manual\"\\v1"`);
  });

  it('renders backend health metrics when no request metrics have been recorded', async () => {
    const text = await registry.renderPrometheusText();

    expect(text).toContain('gmao_backend_up 1');
    expect(text).toContain('gmao_metrics_exposed_series 10');
    expect(text).not.toContain('http_requests_total{');
  });

  it('clears recorded request stats and the collections counter on reset', async () => {
    registry.record('GET', '/health', 200, 5);
    await registry.renderPrometheusText();

    registry.resetForTests();
    const text = await registry.renderPrometheusText();

    expect(text).not.toContain('http_requests_total{');
    expect(text).toContain('gmao_metrics_collections_total 1');
  });

  it('handles non-Error rejections from business metric collection', async () => {
    registry = new MetricsRegistry({
      collect: jest.fn().mockRejectedValue('boom'),
    } as never);

    const text = await registry.renderPrometheusText();

    expect(text).toContain('gmao_business_metrics_collection_success 0');
  });
});
