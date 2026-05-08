import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { RoadmapTimelineClient } from "@/components/dashboard/RoadmapTimelineClient";

interface RoadmapPageProps {
  searchParams: Promise<{ planId?: string }>;
}

export default async function RoadmapPage({ searchParams }: RoadmapPageProps) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const t = await getTranslations("DashboardRoadmap");
  const resolvedParams = await searchParams;
  const selectedPlanId = resolvedParams.planId;

  const { data: plans } = await supabase
    .from("career_plans")
    .select("id, title, target_role, target_company, created_at, roadmaps(phases_json, week_count), gap_analyses(summary_json)")
    .eq("user_id", user.id)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(3);

  const safePlans = plans ?? [];

  const plan = selectedPlanId
    ? (safePlans.find((p) => p.id === selectedPlanId) ?? safePlans[0] ?? null)
    : (safePlans[0] ?? null);

  const planOptions = safePlans.map((p) => ({
    id: p.id,
    label: p.target_role,
    createdAt: p.created_at,
  }));

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center text-3xl">🗺️</div>
        <h2 className="text-headline-md font-bold text-foreground">{t("emptyState")}</h2>
        <p className="text-body-md text-muted-foreground">{t("emptyStateAction")}</p>
        <a
          href="/?new=true"
          className="mt-2 px-6 py-3 bg-primary text-primary-foreground font-bold rounded-xl text-sm hover:opacity-90 transition-opacity"
        >
          {t("emptyStateAction")}
        </a>
      </div>
    );
  }

  const roadmap = Array.isArray(plan.roadmaps) ? plan.roadmaps[0] : plan.roadmaps;
  const gapRaw = Array.isArray(plan.gap_analyses) ? plan.gap_analyses[0] : plan.gap_analyses;

  type WeekRow = { week_number: number; theme: string; date_range?: { start: string; end: string }; todos: { done: boolean; title?: string; text?: string; priority?: string; estimated_hours?: number }[] };
  const weeks = (Array.isArray(roadmap?.phases_json) ? (roadmap!.phases_json as WeekRow[]) : []).filter(Boolean);

  return (
    <RoadmapTimelineClient
      weeks={weeks}
      planTitle={plan.title ?? plan.target_role}
      planId={plan.id}
      targetRole={plan.target_role}
      targetCompany={plan.target_company ?? null}
      gapAnalysis={gapRaw?.summary_json as Record<string, unknown> | null ?? null}
      planOptions={planOptions}
      selectedPlanId={plan.id}
    />
  );
}
