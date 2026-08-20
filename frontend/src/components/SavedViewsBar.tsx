'use client';

import { useState } from 'react';
import { BookmarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';

export interface SavedView {
  _id: string;
  name: string;
  query: Record<string, unknown>;
  is_default: boolean;
}

type SavedViewsBarProps = Readonly<{
  views: SavedView[];
  activeViewId: string | null;
  onApply: (view: SavedView) => void;
  onSaveCurrent: (name: string) => void;
  onDelete: (view: SavedView) => void;
  saveLabel: string;
  namePlaceholder: string;
  emptyLabel: string;
  deleteLabel: string;
}>;

/**
 * A row of saved-search chips for a list page, backed by `/saved-views`.
 * Generic over whatever query shape the page's `useServerTable` produces —
 * this component never interprets `query`, it just stores/replays it.
 */
export function SavedViewsBar({
  views,
  activeViewId,
  onApply,
  onSaveCurrent,
  onDelete,
  saveLabel,
  namePlaceholder,
  emptyLabel,
  deleteLabel,
}: SavedViewsBarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  function submitNewView() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onSaveCurrent(trimmed);
    setNewName('');
    setCreating(false);
  }

  return (
    <fieldset className="flex flex-wrap items-center gap-2" aria-label={saveLabel}>
      {views.length === 0 && !creating && (
        <span className="text-xs text-[var(--text-secondary)]">{emptyLabel}</span>
      )}

      {views.map((view) => (
        <span
          key={view._id}
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
            activeViewId === view._id
              ? 'border-[var(--primary)] bg-[var(--surface-accent)] text-[var(--primary)]'
              : 'border-[var(--border)] text-[var(--text-secondary)]'
          }`}
        >
          <button type="button" onClick={() => onApply(view)} className="flex items-center gap-1">
            <BookmarkIcon className="h-3.5 w-3.5" />
            {view.name}
          </button>
          <button
            type="button"
            onClick={() => onDelete(view)}
            aria-label={`${deleteLabel}: ${view.name}`}
            className="ms-1 text-[var(--text-muted)] hover:text-red-600"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        </span>
      ))}

      {creating ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            className="input-field h-8 w-40 text-xs"
            placeholder={namePlaceholder}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewView();
              if (e.key === 'Escape') setCreating(false);
            }}
          />
          <button type="button" onClick={submitNewView} className="btn-secondary h-8 px-2 text-xs">
            {saveLabel}
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          style={{ minHeight: 24 }}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {saveLabel}
        </button>
      )}
    </fieldset>
  );
}
