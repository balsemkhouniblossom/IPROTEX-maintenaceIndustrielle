import * as Sentry from '@sentry/nextjs';

// Absent DSN is the current, expected state — no Sentry project exists
// for this app yet. Every Sentry.* call elsewhere (errorReporting.ts) is
// a documented safe no-op when init() was never called.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
  });
}
