import { normalizeRouteForMetrics } from './route-normalizer';

describe('normalizeRouteForMetrics', () => {
  it('collapses a Mongo ObjectId segment to :id', () => {
    expect(
      normalizeRouteForMetrics('/work-orders/64f1a2b3c4d5e6f7a8b9c0d1'),
    ).toBe('/work-orders/:id');
  });

  it('collapses a UUID segment to :id', () => {
    expect(
      normalizeRouteForMetrics(
        '/reports/123e4567-e89b-12d3-a456-426614174000/download',
      ),
    ).toBe('/reports/:id/download');
  });

  it('collapses a plain numeric segment to :id', () => {
    expect(normalizeRouteForMetrics('/kpis/42')).toBe('/kpis/:id');
  });

  it('leaves static route segments untouched', () => {
    expect(normalizeRouteForMetrics('/documents/upload')).toBe(
      '/documents/upload',
    );
  });

  it('collapses multiple dynamic segments in the same path', () => {
    expect(
      normalizeRouteForMetrics('/work-orders/64f1a2b3c4d5e6f7a8b9c0d1/parts/7'),
    ).toBe('/work-orders/:id/parts/:id');
  });

  it('leaves the root path untouched', () => {
    expect(normalizeRouteForMetrics('/')).toBe('/');
  });
});
