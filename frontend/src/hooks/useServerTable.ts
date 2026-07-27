'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ServerTablePage<T> {
  items: T[];
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

export interface ServerTableQuery<F> {
  page: number;
  limit: number;
  search: string;
  sort?: string;
  filters: F;
}

interface UseServerTableOptions<T, F> {
  fetcher: (query: ServerTableQuery<F>, signal: AbortSignal) => Promise<ServerTablePage<T>>;
  initialFilters: F;
  pageSize?: number;
  /** Milliseconds to wait after the last keystroke before the search term is applied — avoids firing one request per character. */
  searchDebounceMs?: number;
}

/**
 * Shared server-driven list state for large-scale pages: page/limit/search
 * (debounced)/sort/filters live here, every change fires exactly one
 * request via AbortController (canceling whatever was still in flight),
 * and a request-sequence counter discards a response that resolves after
 * a newer one already landed — the same out-of-order guard `users/page.tsx`
 * already used ad hoc, just extracted so every migrated page gets it for
 * free instead of re-deriving it.
 */
export function useServerTable<T, F extends Record<string, unknown>>({
  fetcher,
  initialFilters,
  pageSize = 20,
  searchDebounceMs = 300,
}: UseServerTableOptions<T, F>) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(pageSize);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<string | undefined>(undefined);
  const [filters, setFilters] = useState<F>(initialFilters);

  const [items, setItems] = useState<T[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, searchDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [searchInput, searchDebounceMs]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const result = await fetcher(
        { page, limit, search: debouncedSearch, sort, filters },
        controller.signal,
      );
      if (seq !== requestSeq.current) return; // a newer request already resolved
      setItems(result.items);
      setTotalItems(result.totalItems);
      setTotalPages(result.totalPages);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      if ((err as { name?: string })?.name === 'CanceledError' || (err as { name?: string })?.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, debouncedSearch, sort, filters, fetcher]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const toggleSort = useCallback((field: string) => {
    setSort((prev) => {
      if (prev === field) return `-${field}`;
      if (prev === `-${field}`) return undefined;
      return field;
    });
    setPage(1);
  }, []);

  const sortField = sort?.replace(/^-/, '');
  const sortDirection: 'asc' | 'desc' | undefined = sort?.startsWith('-') ? 'desc' : sort ? 'asc' : undefined;

  /** Applies a local mutation to `items` immediately (before the server confirms), returning a rollback to call on failure. */
  const applyOptimistic = useCallback((updater: (items: T[]) => T[]) => {
    let previous: T[] = [];
    setItems((current) => {
      previous = current;
      return updater(current);
    });
    return () => setItems(previous);
  }, []);

  return {
    items,
    loading,
    error,
    page,
    setPage,
    limit,
    setLimit,
    searchInput,
    setSearchInput,
    sort,
    setSort,
    sortField,
    sortDirection,
    toggleSort,
    filters,
    setFilters,
    totalItems,
    totalPages,
    reload: load,
    applyOptimistic,
    queryParams: useMemo(
      () => ({ page, limit, search: debouncedSearch, sort, filters }),
      [page, limit, debouncedSearch, sort, filters],
    ),
  };
}
