import * as Sentry from '@sentry/nextjs';

/**
 * Single capture point for client-side render/runtime errors caught by
 * `ErrorBoundary` and the App Router `error.tsx`/`global-error.tsx`
 * boundaries. Every call site already routes through here, which is why
 * Sentry only needed wiring in this one place — `Sentry.captureException`
 * is a documented safe no-op when `Sentry.init()` was never called (i.e.
 * `NEXT_PUBLIC_SENTRY_DSN` unset, the current state), so nothing here
 * needs its own enabled/disabled branch.
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

  Sentry.captureException(error, {
    tags: { boundary: context.boundary },
    extra: {
      digest: context.digest,
      componentStack: context.componentStack,
    },
  });
}
