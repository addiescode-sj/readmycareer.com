export default function SavedPlanLoading() {
  return (
    <div className="space-y-10 pb-16 max-w-5xl">
      {/* Back link */}
      <div className="skeleton h-4 w-32 rounded" />

      {/* Header: title + optimize button (matches flex items-start justify-between gap-4) */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1 min-w-0">
          <div className="skeleton h-9 w-64 rounded-lg" />
          <div className="skeleton h-4 w-80 rounded" />
        </div>
        <div className="skeleton h-9 w-36 rounded-xl shrink-0" />
      </div>

      {/* Gap analysis: 2-column grid (gauge + radar) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card rounded-2xl p-8 flex flex-col items-center justify-center min-h-[240px] gap-4">
          <div className="skeleton h-48 w-48 rounded-full" />
          <div className="skeleton h-3 w-32 rounded" />
        </div>
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <div className="skeleton h-4 w-28 rounded" />
          <div className="skeleton h-52 w-52 rounded-full mx-auto" />
        </div>
      </div>

      {/* Evidence-based findings (full-width) */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="skeleton h-4 w-44 rounded" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="skeleton h-5 w-14 rounded-full shrink-0" />
            <div className="skeleton h-4 flex-1 rounded" />
          </div>
        ))}
      </div>

      {/* Roadmap weeks */}
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
