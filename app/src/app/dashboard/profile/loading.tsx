export default function ProfileLoading() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div className="space-y-2">
        <div className="skeleton h-8 w-48 rounded-lg" />
        <div className="skeleton h-4 w-64 rounded" />
      </div>

      {/* Profile card */}
      <div className="glass-card rounded-2xl p-8 flex items-center gap-6">
        <div className="skeleton h-16 w-16 rounded-full shrink-0" />
        <div className="space-y-2 flex-1">
          <div className="skeleton h-6 w-40 rounded" />
          <div className="skeleton h-4 w-56 rounded" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Radar skeleton */}
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <div className="skeleton h-5 w-36 rounded" />
          <div className="skeleton h-52 w-52 rounded-full mx-auto" />
        </div>

        {/* Findings skeleton */}
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <div className="skeleton h-5 w-48 rounded" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-2 items-start">
              <div className="skeleton h-5 w-16 rounded-full shrink-0" />
              <div className="skeleton h-4 flex-1 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
