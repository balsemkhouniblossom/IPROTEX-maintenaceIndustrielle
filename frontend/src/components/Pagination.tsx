'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  limit: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export default function Pagination({
  page,
  totalPages,
  totalItems,
  limit,
  onPageChange,
  className = '',
}: PaginationProps) {
  const safePage = Number.isFinite(page) ? page : 1;
  const safeLimit = Number.isFinite(limit) ? limit : 10;
  const safeTotalItems = Number.isFinite(totalItems) ? totalItems : 0;
  const safeTotalPages = Number.isFinite(totalPages) ? totalPages : 1;

  const start =
    safeTotalItems === 0
      ? 0
      : (safePage - 1) * safeLimit + 1;

  const end = Math.min(safePage * safeLimit, safeTotalItems);

  const pages: number[] = [];
  for (let current = Math.max(1, safePage - 2); current <= Math.min(safeTotalPages, safePage + 2); current += 1) {
    pages.push(current);
  }

  return (
    <nav
      aria-label="Pagination"
      className={`flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface/90 px-4 py-3 shadow-sm backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="min-w-0 text-sm text-text-secondary" aria-live="polite">
        Showing <span className="font-semibold text-text-primary">{start}</span> to{' '}
        <span className="font-semibold text-text-primary">{end}</span> of{' '}
        <span className="font-semibold text-text-primary">{totalItems}</span> items
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
          disabled={safePage <= 1}
          className="inline-flex min-w-0 items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm font-medium text-text-secondary transition hover:border-(--border-hover) hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-40"
          title="Previous"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          <span className="truncate">Previous</span>
        </button>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {pages[0] > 1 && (
            <>
              <button
                type="button"
                onClick={() => onPageChange(1)}
                aria-label="Page 1"
                style={{ minWidth: 40, minHeight: 40 }}
                className="h-10 min-w-10 rounded-xl border border-border px-3 text-sm font-medium text-text-secondary transition hover:border-(--border-hover) hover:bg-surface-secondary"
              >
                1
              </button>
              {pages[0] > 2 && <span className="px-1 text-text-muted">...</span>}
            </>
          )}

          {pages.map((currentPage) => (
            <button
              key={currentPage}
              type="button"
              onClick={() => onPageChange(currentPage)}
              aria-current={currentPage === page ? 'page' : undefined}
              aria-label={`Page ${currentPage}`}
              style={{ minWidth: 40, minHeight: 40 }}
              className={`h-10 min-w-10 rounded-xl border px-3 text-sm font-medium transition ${currentPage === page
                ? 'border-primary bg-primary text-white shadow-sm'
                : 'border-border text-text-secondary hover:border-(--border-hover) hover:bg-surface-secondary'
                }`}
            >
              {currentPage}
            </button>
          ))}

          {pages[pages.length - 1] < safeTotalPages && (
            <>
              {pages[pages.length - 1] < safeTotalPages - 1 && <span className="px-1 text-text-muted">...</span>}
              <button
                type="button"
                onClick={() => onPageChange(safeTotalPages)}
                aria-label={`Page ${safeTotalPages}`}
                style={{ minWidth: 40, minHeight: 40 }}
                className="h-10 min-w-10 rounded-xl border border-border px-3 text-sm font-medium text-text-secondary transition hover:border-(--border-hover) hover:bg-surface-secondary"
              >
                {safeTotalPages}
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onPageChange(Math.min(safeTotalPages, safePage + 1))}
          disabled={safePage >= safeTotalPages}
          className="inline-flex min-w-0 items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm font-medium text-text-secondary transition hover:border-(--border-hover) hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-40"
          title="Next"
        >
          <span className="truncate">Next</span>
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
