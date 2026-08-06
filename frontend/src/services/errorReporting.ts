/**
 * Single capture point for client-side render/runtime errors caught by
 * `ErrorBoundary` and the App Router `error.tsx`/`global-error.tsx`
 * boundaries. Kept deliberately small and dependency-free today (structured
 * console logging only) so an APM SDK (Sentry) can be wired in here later
 * without touching any of the call sites that already report through it.
 */
export interface ClientErrorContext {
  boundary: string;
  componentStack?: string;
  digest?: string;
}

export function reportClientError(error: Error, context: ClientErrorContext): void {
  console.error(`[ErrorBoundary:${context.boundary}]`, error, {
    digest: context.digest,
    componentStack: context.componentStack,
  });
}
