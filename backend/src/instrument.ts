// Sentry's own docs require this be the very first thing imported by
// main.ts, before any other module — Sentry.init() has to run before the
// code it's supposed to instrument gets loaded. `./load-env` runs its own
// import-time side effect (populating process.env from backend/.env*), so
// importing it first here — rather than relying on main.ts's own
// `import './load-env'` running before this file — is what makes
// `SENTRY_DSN` actually be readable below.
import './load-env';
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN?.trim();

// Absent DSN is the default, expected state until a Sentry project
// exists for this app — every Sentry.* call elsewhere in the codebase is
// a documented safe no-op when init() was never called, so nothing needs
// its own "is Sentry enabled" branch.
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
  });
}
