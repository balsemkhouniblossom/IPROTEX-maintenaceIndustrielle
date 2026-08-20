'use client';

import { useTranslations } from 'next-intl';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface WidgetErrorFallbackProps {
  onRetry: () => void;
  /** Use when the widget already renders its own outer card/panel chrome. */
  bare?: boolean;
}

/**
 * Shared fallback UI for `ErrorBoundary`-wrapped widgets (charts, PDF
 * viewer, AI assistant, monitoring panels, tables, forms) — one look for
 * "this widget crashed, the rest of the page is fine" across the app.
 */
export function WidgetErrorFallback({ onRetry, bare = false }: WidgetErrorFallbackProps) {
  const t = useTranslations('errors.widget');

  const content = (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <ExclamationTriangleIcon
        className="h-8 w-8"
        style={{ color: 'var(--color-error, #dc2626)' }}
        aria-hidden="true"
      />
      <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {t('title')}
      </p>
      <p className="max-w-xs text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {t('description')}
      </p>
      <button type="button" onClick={onRetry} className="btn-secondary mt-2 text-xs">
        {t('retry')}
      </button>
    </div>
  );

  if (bare) return content;
  return <div className="panel">{content}</div>;
}

export function renderWidgetErrorFallback(_error: Error, reset: () => void) {
  return <WidgetErrorFallback onRetry={reset} />;
}

export default WidgetErrorFallback;
