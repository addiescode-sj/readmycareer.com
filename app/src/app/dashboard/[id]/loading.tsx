export default function SavedPlanLoading() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Back link skeleton */}
      <div className="skeleton h-4 w-32 rounded" />

      {/* Title */}
      <div className="space-y-2">
        <div className="skeleton h-9 w-80 rounded-lg" />
        <div className="skeleton h-4 w-52 rounded" />
      </div>

      {/* Gap analysis card */}
      <div className="glass-card rounded-2xl p-8 space-y-6">
        <div className="skeleton h-5 w-40 rounded" />
        <div className="flex flex-col lg:flex-row gap-8 items-center">
          <div className="skeleton h-48 w-48 rounded-full shrink-0" />
          <div className="flex-1 space-y-3 w-full">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-2 flex-1 rounded-full" />
                <div className="skeleton h-3 w-8 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Roadmap weeks skeleton */}
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass-card rounded-2xl p-6 space-y-3">
            <div className="flex items-center gap-3">
              <div className="skeleton h-8 w-8 rounded-lg" />
              <div className="space-y-1 flex-1">
                <div className="skeleton h-4 w-32 rounded" />
                <div className="skeleton h-3 w-48 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
