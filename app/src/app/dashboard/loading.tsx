export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="skeleton h-8 w-64 rounded-lg" />
        <div className="skeleton h-4 w-48 rounded" />
      </div>

      {/* Plan cards — single column, full-width (matches actual grid grid-cols-1 gap-8) */}
      <div className="grid grid-cols-1 gap-8">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="glass-card rounded-[32px] p-8"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <div className="flex flex-col lg:flex-row gap-10">
              {/* Left: info section */}
              <div className="flex-1 min-w-0 space-y-6">
                {/* Title + status badge */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="skeleton h-8 w-64 rounded-lg" />
                  <div className="skeleton h-6 w-20 rounded-full" />
                </div>

                {/* Metadata: company, weeks, date */}
                <div className="flex flex-wrap gap-4">
                  <div className="skeleton h-4 w-32 rounded" />
                  <div className="skeleton h-4 w-20 rounded" />
                  <div className="skeleton h-4 w-36 rounded" />
                </div>

                {/* Findings section */}
                <div className="space-y-3">
                  <div className="skeleton h-3 w-40 rounded" />
                  {[0, 1].map((j) => (
                    <div key={j} className="p-4 rounded-2xl bg-muted/30 border border-border/50 flex items-start gap-3">
                      <div className="skeleton h-5 w-12 rounded-full shrink-0" />
                      <div className="skeleton h-4 flex-1 rounded" />
                    </div>
                  ))}
                </div>

                {/* Progress */}
                <div className="pt-6 border-t border-border/50 space-y-3">
                  <div className="flex justify-between items-end">
                    <div className="skeleton h-3 w-40 rounded" />
                    <div className="skeleton h-8 w-12 rounded" />
                  </div>
                  <div className="w-full h-3 bg-muted rounded-full overflow-hidden p-0.5 border border-border">
                    <div className="skeleton h-full w-1/3 rounded-full" />
                  </div>
                </div>
              </div>

              {/* Right: radar chart section (matches actual w-[300px] panel) */}
              <div className="w-full lg:w-[300px] shrink-0 flex flex-col items-center justify-center p-6 bg-primary/5 rounded-[32px] border border-primary/10 gap-4">
                <div className="skeleton h-3 w-28 rounded" />
                <div className="skeleton h-52 w-52 rounded-full" />
                <div className="skeleton h-10 w-full rounded-xl" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
