// Skeleton loading primitives for the admin analytics dashboard. Reuses the
// same `animate-pulse bg-white/10` idiom as the existing Loading component so
// the visual language stays consistent. All are presentational and marked
// aria-hidden; callers should expose an accessible "loading" status
// separately (e.g. aria-busy on the region).

// Single shimmering block.
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} aria-hidden="true" />;
}

// Card-shaped skeleton matching StatCard's outer shell.
export function SkeletonCard() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-6" aria-hidden="true">
      <SkeletonBlock className="h-3 w-2/3" />
      <SkeletonBlock className="mt-4 h-8 w-1/3" />
    </div>
  );
}

// A responsive grid of skeleton cards.
export function SkeletonCardGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// Chart-shaped skeleton matching MiniLineChart's card footprint.
export function SkeletonChart() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4" aria-hidden="true">
      <div className="mb-2 flex items-center justify-between">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-4 w-8" />
      </div>
      <SkeletonBlock className="h-20 w-full" />
    </div>
  );
}

// Table skeleton with a header row and N body rows.
export function SkeletonTable({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5" aria-hidden="true">
      <div className="border-b border-white/10 p-4">
        <SkeletonBlock className="h-4 w-1/4" />
      </div>
      <div className="divide-y divide-white/5">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 p-4">
            {Array.from({ length: cols }).map((_, c) => (
              <SkeletonBlock key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
