'use client';

import { useEffect } from 'react';
import { reportClientError } from '@/services/errorReporting';

/**
 * Catches errors thrown by the root layout itself. Next.js requires this
 * file to render its own `<html>`/`<body>` — if the root layout crashed,
 * none of its providers/fonts/CSS can be assumed to still work, so this
 * stays deliberately minimal and dependency-free (no next-intl, no theme
 * tokens, inline styles only).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, { boundary: 'global-root', digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0f172a',
          color: '#f1f5f9',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ marginTop: '8px', maxWidth: '28rem', fontSize: '0.875rem', color: '#94a3b8' }}>
          The application ran into an unexpected error while loading. Try again — if the
          problem continues, reload the page.
        </p>
        {error.digest && (
          <p style={{ marginTop: '4px', fontSize: '0.75rem', color: '#64748b' }}>
            Reference: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '24px',
            borderRadius: '8px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            padding: '10px 20px',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
