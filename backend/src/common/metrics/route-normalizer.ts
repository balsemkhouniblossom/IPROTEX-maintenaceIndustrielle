const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_PATTERN = /^\d+$/;

/**
 * Collapses a request path's dynamic segments (Mongo ObjectIds, UUIDs,
 * plain numeric IDs) into a fixed `:id` placeholder before it's ever used
 * as a metrics label. Without this, every distinct work order/document/
 * user visited would mint its own Prometheus time series — unbounded
 * cardinality that grows forever and is the single most common way to
 * blow up a metrics backend's memory/storage.
 */
export function normalizeRouteForMetrics(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (
        OBJECT_ID_PATTERN.test(segment) ||
        UUID_PATTERN.test(segment) ||
        NUMERIC_PATTERN.test(segment)
      ) {
        return ':id';
      }
      return segment;
    })
    .join('/');
}
