'use client';

import { useTranslations } from 'next-intl';
import { WifiIcon } from '@heroicons/react/24/outline';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * App-wide connectivity banner — mounted once in `DashboardLayout` so
 * every page gets graceful offline degradation without each page building
 * its own network-status handling. Purely presentational: it never
 * retries requests itself, it just tells the user why things might be
 * failing right now.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const t = useTranslations('common');

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white"
    >
      <WifiIcon className="h-4 w-4" aria-hidden="true" />
      {t('offlineBanner')}
    </div>
  );
}
