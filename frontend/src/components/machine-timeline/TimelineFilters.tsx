'use client';

import {
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CATEGORY_COLOR_CLASSES, CATEGORY_ICONS, TIMELINE_CATEGORIES } from './eventMeta';
import type { MachineTimelineCategory } from './types';

type TimelineFiltersProps = Readonly<{
  activeCategory: MachineTimelineCategory | 'all';
  onCategoryChange: (category: MachineTimelineCategory | 'all') => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onReset: () => void;
}>;

export default function TimelineFilters({
  activeCategory,
  onCategoryChange,
  searchInput,
  onSearchInputChange,
  onReset,
}: TimelineFiltersProps) {
  const t = useTranslations('machineTimeline');
  const hasFilters = searchInput.trim().length > 0 || activeCategory !== 'all';
  const label = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-(--text-secondary)" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            placeholder={t('filters.searchPlaceholder')}
            aria-label={t('filters.searchPlaceholder')}
            className="h-12 w-full rounded-xl border border-(--border) bg-(--surface) pe-12 ps-11 text-base text-(--text-primary) shadow-(--shadow-sm) transition placeholder:text-(--text-muted) hover:border-(--border-hover) focus:border-(--primary) focus:outline-none focus:ring-4 focus:ring-blue-500/15"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => onSearchInputChange('')}
              className="absolute end-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-(--text-secondary) transition hover:bg-(--surface-secondary) hover:text-(--text-primary) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)"
              aria-label={label('actions.clearSearch', 'Clear search')}
            >
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onReset}
          disabled={!hasFilters}
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-(--border) bg-(--surface-secondary) px-4 text-sm font-semibold text-(--text-primary) transition hover:border-(--border-hover) hover:bg-(--surface) disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)"
        >
          {label('actions.resetFilters', 'Reset filters')}
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('filters.title')}>
        <FilterChip
          label={t('filters.all')}
          active={activeCategory === 'all'}
          onClick={() => onCategoryChange('all')}
        />
        {TIMELINE_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category];
          return (
            <FilterChip
              key={category}
              label={t(`filters.categories.${category}`)}
              active={activeCategory === category}
              onClick={() => onCategoryChange(category)}
              icon={<Icon className="h-4 w-4" aria-hidden="true" />}
              className={CATEGORY_COLOR_CLASSES[category]}
            />
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  icon,
  className,
}: Readonly<{
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  className?: string;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
        active
          ? 'border-(--primary) bg-(--primary) text-(--text-inverse) shadow-(--shadow-sm)'
          : className ?? 'border-(--border) bg-(--surface) text-(--text-secondary)'
      } hover:-translate-y-0.5 hover:shadow-(--shadow-sm) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--primary)`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
