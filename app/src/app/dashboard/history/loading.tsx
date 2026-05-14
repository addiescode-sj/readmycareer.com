export default function HistoryLoading() {
  return (
    <div className="flex flex-col lg:flex-row h-[calc(100dvh-3.5rem)] lg:h-[calc(100vh-theme(spacing.32))] min-h-0 lg:rounded-2xl overflow-hidden border-none lg:border lg:border-border/50 bg-background lg:shadow-sm -m-6 lg:m-0">
      {/* Left: conversations list */}
      <div className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-border/50 flex flex-col bg-surface-container-low/50 order-1">
        <div className="px-4 py-3 lg:py-4 border-b border-border/50 space-y-1.5">
          <div className="skeleton h-3 w-28 rounded" />
          <div className="skeleton h-2.5 w-20 rounded" />
        </div>
        <div className="flex flex-col py-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-4 py-3 space-y-1.5">
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-2.5 w-3/4 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Center: chat panel */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col order-3 lg:order-2">
        <div className="px-4 py-3 border-b border-border/50 space-y-1">
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-2.5 w-32 rounded" />
        </div>
        <div className="flex-1 p-5 flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`flex ${i % 2 === 1 ? "justify-end" : "justify-start"}`}>
              <div
                className={`skeleton rounded-2xl ${i % 2 === 1 ? "w-48 rounded-br-sm" : "w-64 rounded-bl-sm"}`}
                style={{ height: "3rem" }}
              />
            </div>
          ))}
        </div>
        <div className="border-t border-border/50 px-4 py-3">
          <div className="skeleton h-10 w-full rounded-xl" />
        </div>
      </div>

      {/* Right: context panel (desktop only) */}
      <div className="hidden lg:flex lg:flex-col w-60 shrink-0 border-l border-border/50 order-3">
        <div className="px-4 py-4 border-b border-border/50 space-y-1.5">
          <div className="skeleton h-3 w-28 rounded" />
          <div className="skeleton h-2.5 w-36 rounded" />
        </div>
        <div className="p-4 space-y-4">
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="space-y-2">
            <div className="skeleton h-2.5 w-24 rounded" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1">
                <div className="skeleton h-2.5 w-full rounded" />
                <div className="skeleton h-1 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
