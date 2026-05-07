export default function UploadLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-6">
        {/* Logo mark */}
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center border border-primary/20 animate-pulse">
          <span className="text-primary font-black text-2xl tracking-tighter">SI</span>
        </div>

        {/* Synthetic spinner */}
        <div
          className="w-10 h-10 rounded-full"
          style={{
            background: "conic-gradient(transparent 30%, hsl(258, 66%, 53%))",
            animation: "synthetic-spin 0.9s linear infinite",
            WebkitMask: "radial-gradient(farthest-side,transparent calc(100% - 3px),#fff calc(100% - 2px))",
            mask: "radial-gradient(farthest-side,transparent calc(100% - 3px),#fff calc(100% - 2px))",
          }}
        />

        <p className="text-sm text-muted-foreground font-medium animate-pulse">Loading workspace…</p>
      </div>
    </div>
  );
}
