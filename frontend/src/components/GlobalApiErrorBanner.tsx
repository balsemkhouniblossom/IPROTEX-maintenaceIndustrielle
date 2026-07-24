'use client';

import { useEffect, useState } from 'react';

type ApiErrorDetail = {
  message?: string;
  url?: string;
  method?: string;
};

const EVENT_NAME = 'app:api-network-error';

export default function GlobalApiErrorBanner() {
  const [error, setError] = useState<ApiErrorDetail | null>(null);

  useEffect(() => {
    const onApiError = (event: Event) => {
      const customEvent = event as CustomEvent<ApiErrorDetail>;
      setError(customEvent.detail || { message: 'Network error' });
    };

    window.addEventListener(EVENT_NAME, onApiError as EventListener);
    return () => {
      window.removeEventListener(EVENT_NAME, onApiError as EventListener);
    };
  }, []);

  if (!error) {
    return null;
  }

  return (
    <div className="global-api-error-banner fixed bottom-4 left-4 right-4 z-100 mx-auto max-w-3xl rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 shadow-lg">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">API connection issue</p>
          <p className="text-sm">
            The application is online, but it cannot reach the backend API.
          </p>
          <p className="mt-1 text-xs opacity-90 wrap-break-word">
            {error.method?.toUpperCase() || 'REQUEST'} {error.url || ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setError(null)}
          className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs hover:bg-red-100"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
