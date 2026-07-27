'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks `navigator.onLine` plus the browser's `online`/`offline` events.
 * This is a real but coarse signal (a machine can be "online" per the OS
 * yet unable to reach this app's API) — pages that need to know the API
 * specifically is reachable should still surface their own request
 * failures; this hook is for the app-wide "you appear to be offline"
 * banner, not a substitute for per-request error handling.
 */
export function useOnlineStatus(): boolean {
  // Always start `true` (matching the server, which has no `navigator` at
  // all) so the client's pre-hydration render can't disagree with the SSR
  // output — reading the real `navigator.onLine` synchronously here would
  // render the offline banner on first paint whenever the browser happens
  // to be offline at that instant, mismatching the server's HTML.
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
