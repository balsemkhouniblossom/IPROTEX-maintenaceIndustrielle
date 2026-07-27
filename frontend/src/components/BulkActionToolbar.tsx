'use client';

import { ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface BulkActionToolbarProps {
  selectedCount: number;
  onClearSelection: () => void;
  clearLabel: string;
  countLabel: (count: number) => string;
  children: ReactNode;
}

/**
 * The sticky "N selected — [actions]" bar that appears above a table once
 * at least one row is checked. Actions themselves are page-specific
 * (bulk-approve differs from bulk-close), so they're passed in as
 * children rather than baked into this component.
 */
export function BulkActionToolbar({
  selectedCount,
  onClearSelection,
  clearLabel,
  countLabel,
  children,
}: BulkActionToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={countLabel(selectedCount)}
      className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--primary)] bg-[var(--surface-accent)] px-4 py-2"
    >
      <span className="text-sm font-medium text-[var(--primary)]">{countLabel(selectedCount)}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClearSelection}
        className="ms-auto inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <XMarkIcon className="h-3.5 w-3.5" />
        {clearLabel}
      </button>
    </div>
  );
}
