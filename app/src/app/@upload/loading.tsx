import { Logo } from "@/components/ui/Logo";

export default function UploadLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-6">
        {/* Logo mark */}
        <Logo size={64} animate={true} className="rounded-3xl" />

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
