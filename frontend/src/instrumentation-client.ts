const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
const sentryModule = dsn ? import("@sentry/nextjs") : null;

if (sentryModule) {
  void sentryModule.then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
        ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
        : 0.1,
    });
  });
}

export function onRouterTransitionStart(
  ...args: Parameters<
    typeof import("@sentry/nextjs").captureRouterTransitionStart
  >
): void {
  void sentryModule?.then((Sentry) => {
    Sentry.captureRouterTransitionStart(...args);
  });
}
