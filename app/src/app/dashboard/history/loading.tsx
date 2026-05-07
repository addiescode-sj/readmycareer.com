export default function HistoryLoading() {
  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="space-y-2">
        <div className="skeleton h-8 w-52 rounded-lg" />
        <div className="skeleton h-4 w-64 rounded" />
      </div>

      <div className="glass-card rounded-2xl p-6 space-y-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`flex gap-3 ${i % 2 === 1 ? "flex-row-reverse" : ""}`}>
            <div className="skeleton h-9 w-9 rounded-full shrink-0" />
            <div className="space-y-1.5 max-w-sm">
              <div className="skeleton h-4 w-64 rounded-2xl" />
              <div className="skeleton h-4 w-48 rounded-2xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
