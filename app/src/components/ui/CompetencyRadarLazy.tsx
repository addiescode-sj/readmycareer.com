"use client";

import dynamic from "next/dynamic";

// Defers ~60KB of recharts JS out of the initial route bundle.
// The chart fades in once recharts hydrates; the skeleton preserves layout to avoid CLS.
export const CompetencyRadar = dynamic(
  () => import("./CompetencyRadar").then((m) => m.CompetencyRadar),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full animate-pulse rounded-2xl bg-muted/40"
        style={{ minHeight: 220 }}
        aria-hidden
      />
    ),
  }
);
