import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { careerPlansKey } from "@/lib/query-keys";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const [profileResult, queryClient] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .single(),
    (async () => {
      const qc = new QueryClient();
      await qc.prefetchQuery({
        queryKey: careerPlansKey(),
        queryFn: async () => {
          const { data } = await supabase
            .from("career_plans")
            .select(
              "id, title, target_role, target_company, status, start_date, duration_weeks, created_at, gap_analyses(summary_json), roadmaps(summary, week_count, phases_json)"
            )
            .eq("user_id", user.id)
            .neq("status", "archived")
            .order("created_at", { ascending: false });
          return data ?? [];
        },
        staleTime: 60 * 1000,
      });
      return qc;
    })(),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardClient profile={profileResult.data} />
    </HydrationBoundary>
  );
}
