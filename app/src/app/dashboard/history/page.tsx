import { redirect } from "next/navigation";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { chatMessagesKey } from "@/lib/query-keys";
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

  const safePlans = (plans ?? []).map((p) => ({
    ...p,
    gap_analyses: Array.isArray(p.gap_analyses)
      ? (p.gap_analyses[0] ?? null)
      : p.gap_analyses,
  }));

  const firstPlanId = safePlans[0]?.id ?? null;

  // Prefetch the first plan's chat history so it renders without a loading flash
  const queryClient = new QueryClient();
  if (firstPlanId) {
    await queryClient.prefetchQuery({
      queryKey: chatMessagesKey(firstPlanId),
      queryFn: async () => {
        const { data } = await supabase
          .from("recent_chat_messages")
          .select("role, content")
          .eq("career_plan_id", firstPlanId)
          .order("sequence_number", { ascending: true });
        return data ?? [];
      },
      staleTime: 5 * 60 * 1000,
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ChatHistoryClient plans={safePlans} initialPlanId={firstPlanId} />
    </HydrationBoundary>
  );
}
