export default function RoadmapLoading() {
  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* Header */}
      <div className="space-y-2">
        <div className="skeleton h-8 w-56 rounded-lg" />
        <div className="skeleton h-4 w-72 rounded" />
      </div>

      {/* Phase progress bar card */}
      <div className="glass-card rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-3 flex-wrap">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-6 w-20 rounded-full" />
            ))}
          </div>
          <div className="skeleton h-4 w-24 rounded" />
        </div>
        <div className="skeleton h-1.5 w-full rounded-full" />
      </div>

      {/* Velocity chart */}
      <div className="glass-card rounded-2xl p-5">
        <div className="skeleton h-28 w-full rounded-lg" />
      </div>

      {/* Horizontal scrollable week cards */}
      <div className="flex gap-4 overflow-hidden pt-1 pb-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="glass-card rounded-2xl p-4 space-y-3 shrink-0 w-52"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="skeleton h-5 w-16 rounded-full" />
            <div className="space-y-1">
              <div className="skeleton h-3 w-12 rounded" />
              <div className="skeleton h-5 w-full rounded" />
            </div>
            <div className="space-y-1">
              <div className="skeleton h-1 w-full rounded-full" />
              <div className="skeleton h-3 w-20 rounded" />
            </div>
            <div className="skeleton h-8 w-full rounded" />
          </div>
        ))}
      </div>

      {/* Selected week task list */}
      <div className="glass-card rounded-2xl p-5 space-y-3">
        <div className="skeleton h-4 w-48 rounded" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="skeleton h-3 w-4 rounded shrink-0 mt-0.5" />
            <div className="skeleton h-4 flex-1 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
