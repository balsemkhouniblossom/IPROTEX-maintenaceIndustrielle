/**
 * Shared loading-placeholder primitives. Replaces the
 * `animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600` idiom
 * that was duplicated ad hoc across list pages (machines, devices, ...) with
 * one reusable, theme-aware set of building blocks.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className}`}
      style={{ background: 'var(--color-border)' }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 1, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`h-3 ${index === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="w-full space-y-3" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-full max-w-sm" />
      <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: rows }, (_, rowIndex) => (
          <div
            key={rowIndex}
            className="flex items-center gap-4 border-t px-4 py-3"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {Array.from({ length: columns }, (_, colIndex) => (
              <Skeleton key={colIndex} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full-page fallback for the App Router's `loading.tsx` route convention. */
export function PageSkeleton() {
  return (
    <div className="min-h-screen p-6" style={{ background: 'var(--color-background)' }}>
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-8 w-64" />
        <SkeletonTable />
      </div>
    </div>
  );
}
