export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="skeleton h-8 w-64 rounded-lg" />
        <div className="skeleton h-4 w-48 rounded" />
      </div>

      {/* Plan cards skeleton grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="glass-card rounded-2xl p-6 space-y-4"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <div className="skeleton h-5 w-3/4 rounded" />
                <div className="skeleton h-3 w-1/2 rounded" />
              </div>
              <div className="skeleton h-6 w-16 rounded-full ml-4" />
            </div>

            {/* Radar chart placeholder */}
            <div className="skeleton h-32 w-32 rounded-full mx-auto" />

            {/* Findings chips */}
            <div className="space-y-2">
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-5/6 rounded" />
            </div>

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton h-3 w-8 rounded" />
              </div>
              <div className="h-1.5 rounded-full bg-surface-container overflow-hidden">
                <div className="skeleton h-full w-1/3 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
