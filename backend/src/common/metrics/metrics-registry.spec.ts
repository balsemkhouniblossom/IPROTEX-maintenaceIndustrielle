import { MetricsRegistry } from './metrics-registry';

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  it('aggregates counts and total duration for repeated requests to the same normalized route', () => {
    registry.record('GET', '/work-orders/64f1a2b3c4d5e6f7a8b9c0d1', 200, 10);
    registry.record('GET', '/work-orders/aaaaaaaaaaaaaaaaaaaaaaaa', 200, 20);

    const text = registry.renderPrometheusText();

    expect(text).toContain(
      'http_requests_total{method="GET",route="/work-orders/:id",status="200"} 2',
    );
    expect(text).toContain(
      'http_request_duration_ms_sum{method="GET",route="/work-orders/:id",status="200"} 30',
    );
  });

  it('keeps distinct status codes as separate series for the same route', () => {
    registry.record('GET', '/health', 200, 5);
    registry.record('GET', '/health', 500, 5);

    const text = registry.renderPrometheusText();

    expect(text).toContain(
      'http_requests_total{method="GET",route="/health",status="200"} 1',
    );
    expect(text).toContain(
      'http_requests_total{method="GET",route="/health",status="500"} 1',
    );
  });

  it('includes HELP/TYPE metadata lines for both metrics', () => {
    registry.record('GET', '/health', 200, 5);

    const text = registry.renderPrometheusText();

    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('# TYPE http_request_duration_ms_sum counter');
  });

  it('renders an empty body (just HELP/TYPE headers) when nothing has been recorded', () => {
    const text = registry.renderPrometheusText();

    expect(text).not.toContain('http_requests_total{');
  });
});
