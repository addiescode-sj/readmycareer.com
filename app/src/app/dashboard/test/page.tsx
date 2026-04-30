"use client";

import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default function TestDashboardPage() {
  // Mock profile and empty plans to trigger sync
  const profile = { display_name: "Test User", avatar_url: null };
  const initialPlans: any[] = [];

  return (
    <div className="p-8">
      <h1 className="text-xl mb-4 font-bold">E2E Test Dashboard</h1>
      <DashboardClient profile={profile} initialPlans={initialPlans} />
    </div>
  );
}
