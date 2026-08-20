'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLocale, useTranslations } from 'next-intl';
import { apiService } from '@/services/api';
import TimelineEventCard from './TimelineEventCard';
import TimelineFilters from './TimelineFilters';
import { dateGroupLabel, groupKeyForDate, isTranslatableGroupKey } from './groupByDate';
import type { MachineTimelineCategory, MachineTimelineEvent, MachineTimelinePage } from './types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const TIMELINE_SKELETON_KEYS = [
  'timeline-skeleton-1',
  'timeline-skeleton-2',
  'timeline-skeleton-3',
  'timeline-skeleton-4',
];

type TimelineRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'event'; key: string; event: MachineTimelineEvent };

function fallbackEventCountLabel(totalItems: number, locale: string): string {
  const eventWord = totalItems === 1 ? 'event' : 'events';
  return `${totalItems.toLocaleString(locale)} ${eventWord}`;
}

function timelineEmptyLabel(
  hasActiveFilter: boolean,
  t: ReturnType<typeof useTranslations>,
): string {
  if (hasActiveFilter) {
    return t('empty.filtered');
  }

  return t('empty.default');
}

/**
 * Owns the timeline's query state (search/category filter/pagination),
 * infinite scroll (a sentinel `<div>` observed via `IntersectionObserver`
 * inside the scroll container) and rendering (windowed via
 * `@tanstack/react-virtual`, the same virtualization library
 * `VirtualizedDataTable` already uses elsewhere) so the DOM stays bounded
 * no matter how many pages have been appended.
 */
export default function MachineTimelineFeed({ machineId }: Readonly<{ machineId: string }>) {
  const t = useTranslations('machineTimeline');
  const locale = useLocale();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<MachineTimelineCategory | 'all'>('all');

  const [items, setItems] = useState<MachineTimelineEvent[]>([]);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const fetchPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      const seq = ++requestSeq.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError('');

      try {
        const response = await apiService.getMachineTimeline(
          machineId,
          {
            page: targetPage,
            limit: PAGE_SIZE,
            search: debouncedSearch || undefined,
            types: activeCategory === 'all' ? undefined : activeCategory,
          },
          { signal: controller.signal },
        );
        if (seq !== requestSeq.current) return;
        const data = response.data as MachineTimelinePage;
        setItems((current) => (replace ? data.items : [...current, ...data.items]));
        setPage(data.page);
        setTotalItems(data.totalItems);
        setTotalPages(data.totalPages);
      } catch (err: unknown) {
        if (seq !== requestSeq.current) return;
        const name = (err as { name?: string; code?: string })?.name;
        const code = (err as { name?: string; code?: string })?.code;
        if (name === 'CanceledError' || name === 'AbortError' || code === 'ERR_CANCELED') return;
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setError(message || t('errors.loadTimeline'));
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [machineId, debouncedSearch, activeCategory, t],
  );

  useEffect(() => {
    void fetchPage(1, true);
  }, [fetchPage]);

  const hasMore = page < totalPages;
  const eventCountLabel = t.has('timelineEventCount')
    ? t('timelineEventCount', { count: totalItems })
    : fallbackEventCountLabel(totalItems, locale);

  const rows = useMemo<TimelineRow[]>(() => {
    const now = new Date();
    const built: TimelineRow[] = [];
    let lastGroupKey: string | null = null;
    for (const event of items) {
      const groupKey = groupKeyForDate(new Date(event.at), now, locale);
      const groupLabel = dateGroupLabel(groupKey);
      if (groupLabel !== lastGroupKey) {
        built.push({
          kind: 'header',
          key: `header-${groupLabel}-${built.length}`,
          label: isTranslatableGroupKey(groupKey) ? t(`groups.${groupKey}`) : groupLabel,
        });
        lastGroupKey = groupLabel;
      }
      built.push({ kind: 'event', key: event.id, event });
    }
    return built;
  }, [items, locale, t]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual owns its internal function identities.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? 52 : 220),
    overscan: 6,
  });

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          void fetchPage(page + 1, false);
        }
      },
      { root, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, fetchPage]);

  function resetFilters() {
    setSearchInput('');
    setActiveCategory('all');
  }

  let timelineContent: ReactNode;

  if (loading) {
    timelineContent = (
      <div className="space-y-3 py-4" aria-live="polite">
        <span className="sr-only">{t('loading')}</span>
        {TIMELINE_SKELETON_KEYS.map((key) => (
          <div key={key} className="h-40 animate-pulse rounded-2xl bg-(--surface-secondary)" />
        ))}
      </div>
    );
  } else if (error && items.length === 0) {
    timelineContent = (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-(--text-secondary)">{error}</p>
        <button type="button" className="btn-secondary" onClick={() => void fetchPage(1, true)}>
          {t('actions.retry')}
        </button>
      </div>
    );
  } else if (rows.length === 0) {
    timelineContent = (
      <p className="py-10 text-center text-sm text-(--text-secondary)">
        {timelineEmptyLabel(Boolean(debouncedSearch || activeCategory !== 'all'), t)}
      </p>
    );
  } else {
    timelineContent = (
      <>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  paddingBottom: row.kind === 'header' ? '0.5rem' : '1rem',
                }}
              >
                {row.kind === 'header' ? (
                  <div className="sticky top-0 z-10 flex items-center gap-3 bg-(--surface) py-2">
                    <div className="h-px w-8 bg-(--border)" />
                    <h3 className="rounded-full border border-(--border) bg-(--surface-secondary) px-3 py-1 text-sm font-bold text-(--text-primary)">
                      {row.label}
                    </h3>
                    <div className="h-px flex-1 bg-(--border)" />
                  </div>
                ) : (
                  <TimelineEventCard event={row.event} />
                )}
              </div>
            );
          })}
        </div>
        <div ref={sentinelRef} className="h-1" />
        {loadingMore && (
          <p className="py-3 text-center text-xs text-(--text-secondary)">{t('loadingMore')}</p>
        )}
        {!hasMore && items.length > 0 && (
          <p className="py-3 text-center text-xs text-(--text-secondary)">{t('endOfTimeline')}</p>
        )}
      </>
    );
  }

  return (
    <section className="rounded-2xl border border-(--border) bg-(--surface) p-4 shadow-(--shadow-sm) sm:p-5 lg:p-6">
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-(--text-primary)">{t('timelineTitle')}</h2>
          <p className="text-sm text-(--text-secondary)">{eventCountLabel}</p>
        </div>
      </div>
      <TimelineFilters
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        onReset={resetFilters}
      />

      <div
        ref={scrollRef}
        className="relative mt-5 max-h-[72vh] min-h-80 overflow-y-auto pe-1"
        aria-label={t('timelineTitle')}
      >
        {timelineContent}
      </div>
    </section>
  );
}
