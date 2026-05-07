export default function RoadmapLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="skeleton h-8 w-56 rounded-lg" />
        <div className="skeleton h-4 w-72 rounded" />
      </div>
      <div className="flex gap-4 overflow-hidden">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="glass-card rounded-2xl p-5 space-y-3 shrink-0 w-52"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="skeleton h-4 w-16 rounded" />
            <div className="skeleton h-6 w-full rounded" />
            <div className="skeleton h-2 w-full rounded-full" />
            <div className="skeleton h-3 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
