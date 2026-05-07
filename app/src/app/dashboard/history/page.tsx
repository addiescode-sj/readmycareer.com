import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ChatHistoryClient } from "@/components/dashboard/ChatHistoryClient";

export default async function HistoryPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const { data: plans } = await supabase
    .from("career_plans")
    .select("id, title, target_role, target_company, created_at, gap_analyses(summary_json)")
    .eq("user_id", user.id)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(10);

  const safeePlans = (plans ?? []).map((p) => ({
    ...p,
    gap_analyses: Array.isArray(p.gap_analyses)
      ? (p.gap_analyses[0] ?? null)
      : p.gap_analyses,
  }));

  const initialPlanId = safeePlans[0]?.id ?? null;

  return (
    <ChatHistoryClient
      plans={safeePlans}
      initialPlanId={initialPlanId}
    />
  );
}
