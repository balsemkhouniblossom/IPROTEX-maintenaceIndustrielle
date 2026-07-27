'use client';

import { useEffect } from 'react';

/**
 * Minimal cross-page "a shared list just went stale" signal — a thin,
 * named wrapper around the plain `window.dispatchEvent(new Event(...))`
 * pattern this app already used ad hoc (e.g. `work-orders:changed`,
 * `users:approvals-changed`). This is deliberately NOT a cache: nothing
 * here stores or serves data. It only tells a subscribed `useServerTable`
 * page "reload whenever you next get a chance" — the actual data always
 * comes from a fresh server round trip, so there is no risk of serving
 * stale or unconfirmed data from a cache. Reserved for mutations that
 * happen on one page/flow but are known to make another page's list stale
 * (e.g. an Operator submitting a corrective report changes what the Admin
 * Work Orders list shows) — most CRUD stays page-local and doesn't need
 * this at all.
 */
export const LIST_EVENTS = {
  workOrders: 'work-orders:changed',
  maintenancePlans: 'maintenance-plans:changed',
  reports: 'reports:changed',
} as const;

export type ListEventName = (typeof LIST_EVENTS)[keyof typeof LIST_EVENTS];

export function invalidateList(event: ListEventName): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(event));
  }
}

/** Re-runs `onInvalidate` whenever `event` fires while this component is mounted. */
export function useListInvalidation(event: ListEventName, onInvalidate: () => void): void {
  useEffect(() => {
    window.addEventListener(event, onInvalidate);
    return () => window.removeEventListener(event, onInvalidate);
  }, [event, onInvalidate]);
}
