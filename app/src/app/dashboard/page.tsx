import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const [profileResult, plansResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .single(),
    supabase
      .from("career_plans")
      .select(
        "id, title, target_role, target_company, status, start_date, duration_weeks, created_at, gap_analyses(summary_json), roadmaps(summary, week_count, phases_json)"
      )
      .eq("user_id", user.id)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <DashboardClient
      profile={profileResult.data}
      initialPlans={plansResult.data ?? []}
    />
  );
}
