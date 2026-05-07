export default function PlanLoading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-xl">
      <div className="flex flex-col items-center gap-8">
        <div
          className="w-16 h-16 rounded-full"
          style={{
            background: "conic-gradient(transparent 30%, hsl(258, 66%, 53%))",
            animation: "synthetic-spin 0.9s linear infinite",
            WebkitMask: "radial-gradient(farthest-side,transparent calc(100% - 4px),#fff calc(100% - 2px))",
            mask: "radial-gradient(farthest-side,transparent calc(100% - 4px),#fff calc(100% - 2px))",
          }}
        />
        <p className="text-base text-muted-foreground font-semibold tracking-wide animate-pulse">
          Preparing your career plan…
        </p>
      </div>
    </div>
  );
}
