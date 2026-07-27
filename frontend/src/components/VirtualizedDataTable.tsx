'use client';

import {
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowPathIcon, ChevronDownIcon, ChevronUpIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  /** CSS width (e.g. "12rem"), applied to both the header and body cells so virtualized rows line up with the header. */
  width?: string;
  align?: 'start' | 'end';
}

export type SortDirection = 'asc' | 'desc';

interface VirtualizedDataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage: string;
  loadingLabel: string;
  errorRetryLabel: string;
  /** Fixed viewport height in pixels — required for windowing to actually bound the number of rendered DOM rows. */
  height?: number;
  estimatedRowHeight?: number;
  sortField?: string;
  sortDirection?: SortDirection;
  onSortChange?: (field: string) => void;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  onToggleSelectAll?: (checked: boolean) => void;
  selectAllLabel?: string;
  selectRowLabel?: (row: T) => string;
  ariaLabel: string;
}

// The grid column widths are written to this CSS custom property exactly
// once (on the single scrolling element) and every other row — header
// included — only ever reads it back via var(...). There is no second
// place that could drift out of sync: the property inherits through the
// whole subtree regardless of nesting/position, so a header row and a
// virtualized row two levels deeper resolve the identical value.
const GRID_TEMPLATE_VAR = '--dt-grid-template-columns';

type GridTemplateStyle = CSSProperties & { [GRID_TEMPLATE_VAR]?: string };

/**
 * Windowed table shell shared by every large list page: server-paginated
 * rows are handed in already-fetched, and this component only decides
 * which of them are actually mounted to the DOM at any moment (via
 * `@tanstack/react-virtual`), keyed to a fixed-height scroll viewport.
 * Renders ARIA `table/row/columnheader/cell` roles by hand (rather than a
 * native `<table>`) because virtualized rows are absolutely positioned,
 * which native table layout doesn't support — a screen reader still
 * announces it as a table, and arrow-key roving tabindex makes every row
 * keyboard-reachable without requiring one Tab stop per row.
 *
 * Header and body live in the exact same scrolling element (one viewport,
 * one horizontal scrollbar, one vertical scrollbar) with the header made
 * `position: sticky` so it stays pinned while the rows scroll past it —
 * there is no second, independently-scrolling container that could ever
 * drift out of width/position sync with the first.
 */
export function VirtualizedDataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  emptyMessage,
  loadingLabel,
  errorRetryLabel,
  height = 480,
  estimatedRowHeight = 48,
  sortField,
  sortDirection,
  onSortChange,
  selectable = false,
  selectedKeys,
  onToggleSelect,
  onToggleSelectAll,
  selectAllLabel = 'Select all rows',
  selectRowLabel,
  ariaLabel,
}: VirtualizedDataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  // The header sits in normal flow above the virtualized rows, inside the
  // same scroll element - scrollMargin tells the virtualizer to treat that
  // real, measured header height as "already scrolled past" space, so its
  // scrollTop-vs-row-position math lines up with where rows actually sit
  // in the DOM instead of assuming the virtualized list starts at 0.
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    const node = headerRef.current;
    if (!node) return;

    const measure = () => setHeaderHeight(node.getBoundingClientRect().height);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 8,
    scrollMargin: headerHeight,
  });

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.min(index + 1, rows.length - 1);
        setFocusedIndex(next);
        virtualizer.scrollToIndex(next);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = Math.max(index - 1, 0);
        setFocusedIndex(prev);
        virtualizer.scrollToIndex(prev);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setFocusedIndex(0);
        virtualizer.scrollToIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        const last = rows.length - 1;
        setFocusedIndex(last);
        virtualizer.scrollToIndex(last);
      } else if (event.key === ' ' && selectable && onToggleSelect) {
        event.preventDefault();
        onToggleSelect(rowKey(rows[index]));
      }
    },
    [rows, virtualizer, selectable, onToggleSelect, rowKey],
  );

  const gridTemplateColumns = [
    selectable ? '2.5rem' : null,
    ...columns.map((column) => column.width ?? 'minmax(8rem, 1fr)'),
  ]
    .filter(Boolean)
    .join(' ');

  const gridColumnStyle: GridTemplateStyle = { gridTemplateColumns: `var(${GRID_TEMPLATE_VAR})` };

  const allSelected =
    selectable && rows.length > 0 && selectedKeys && rows.every((row) => selectedKeys.has(rowKey(row)));

  return (
    <div className="min-w-0">
      <div
        ref={scrollRef}
        role="table"
        aria-label={ariaLabel}
        className="min-w-full rounded-[var(--radius)] border border-[var(--border)] shadow-[var(--shadow)]"
        style={{ [GRID_TEMPLATE_VAR]: gridTemplateColumns, height, overflow: 'auto' } as GridTemplateStyle}
      >
        <div
          ref={headerRef}
          role="row"
          className="sticky top-0 z-10 grid items-center gap-4 border-b border-[var(--border)] bg-gradient-to-br from-[var(--surface-secondary)] to-[var(--background)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]"
          style={gridColumnStyle}
        >
          {selectable && (
            <span role="columnheader">
              <input
                type="checkbox"
                checked={Boolean(allSelected)}
                onChange={(e) => onToggleSelectAll?.(e.target.checked)}
                aria-label={selectAllLabel}
              />
            </span>
          )}
          {columns.map((column) => (
            <span
              key={column.key}
              role="columnheader"
              aria-sort={
                sortField === column.key ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none'
              }
              className={column.align === 'end' ? 'text-end' : undefined}
            >
              {column.sortable && onSortChange ? (
                <button
                  type="button"
                  onClick={() => onSortChange(column.key)}
                  className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
                >
                  {column.header}
                  {sortField === column.key &&
                    (sortDirection === 'desc' ? (
                      <ChevronDownIcon className="h-3 w-3" />
                    ) : (
                      <ChevronUpIcon className="h-3 w-3" />
                    ))}
                </button>
              ) : (
                column.header
              )}
            </span>
          ))}
        </div>

        {loading ? (
          // role="table" only permits row/rowgroup children — wrap the
          // status message in a single row/cell so it stays valid ARIA
          // table structure instead of a bare role="status" div.
          <div role="row">
            <div role="cell" className="animate-pulse space-y-2 p-3" aria-live="polite">
              <span className="sr-only">{loadingLabel}</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 rounded bg-[var(--surface-secondary)]" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div role="row">
            <div role="cell" className="flex flex-col items-center gap-3 py-10 text-center" aria-live="assertive">
              <ExclamationTriangleIcon className="h-8 w-8 text-red-500" aria-hidden="true" />
              <p className="text-sm text-[var(--text-secondary)]">{error}</p>
              {onRetry && (
                <button type="button" onClick={onRetry} className="btn-secondary inline-flex items-center gap-2">
                  <ArrowPathIcon className="h-4 w-4" />
                  {errorRetryLabel}
                </button>
              )}
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div role="row">
            <p role="cell" className="py-10 text-center text-sm text-[var(--text-secondary)]">
              {emptyMessage}
            </p>
          </div>
        ) : (
          <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const key = rowKey(row);
              const selected = selectedKeys?.has(key) ?? false;
              return (
                <div
                  key={key}
                  role="row"
                  aria-selected={selectable ? selected : undefined}
                  tabIndex={focusedIndex === virtualRow.index ? 0 : -1}
                  onFocus={() => setFocusedIndex(virtualRow.index)}
                  onKeyDown={(event) => handleRowKeyDown(event, virtualRow.index)}
                  className={`grid items-center gap-4 border-b border-[var(--border-soft)] px-4 py-3 text-sm outline-offset-2 transition-colors hover:bg-[var(--surface-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${
                    selected ? 'bg-[var(--surface-accent)]' : ''
                  }`}
                  style={{
                    ...gridColumnStyle,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  {selectable && (
                    <span role="cell">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleSelect?.(key)}
                        aria-label={selectRowLabel ? selectRowLabel(row) : undefined}
                      />
                    </span>
                  )}
                  {columns.map((column) => (
                    <span
                      key={column.key}
                      role="cell"
                      className={`min-w-0 truncate ${column.align === 'end' ? 'text-end' : ''}`}
                    >
                      {column.render(row)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
