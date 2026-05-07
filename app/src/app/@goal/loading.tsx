export default function GoalLoading() {
  return (
    <div className="flex items-center justify-center py-20">
      <div
        className="w-8 h-8 rounded-full"
        style={{
          background: "conic-gradient(transparent 30%, hsl(258, 66%, 53%))",
          animation: "synthetic-spin 0.9s linear infinite",
          WebkitMask: "radial-gradient(farthest-side,transparent calc(100% - 3px),#fff calc(100% - 2px))",
          mask: "radial-gradient(farthest-side,transparent calc(100% - 3px),#fff calc(100% - 2px))",
        }}
      />
    </div>
  );
}
