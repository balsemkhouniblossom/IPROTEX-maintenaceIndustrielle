import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";

const withNextIntl = createNextIntlPlugin();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors the production lock-down in src/config/api-base-url.ts: in prod
// this is always the Render API origin, in dev the local backend. Building
// connect-src from the same env var (rather than a hardcoded host) keeps
// this in sync with whatever backend the app is actually configured to
// call, including a future staging origin.
const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3001";
const apiOrigin = new URL(apiBaseUrl).origin;
const apiWebSocketOrigin = apiOrigin.replace(/^http/, "ws");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    // Force Turbopack to use the frontend folder as project root in this monorepo.
    root: __dirname,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push("canvas");
    }
    return config;
  },
  async headers() {
    // Next.js's App Router injects inline hydration/streaming scripts, so
    // a nonce-free script-src still needs 'unsafe-inline' here — this is a
    // real limitation (it doesn't stop inline script injection), not full
    // script isolation. It does stop loading scripts/styles/frames/objects
    // from any other origin, which is the gap this closes.
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob: ${apiOrigin}`,
      "font-src 'self' data:",
      `connect-src 'self' ${apiOrigin} ${apiWebSocketOrigin}`,
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);