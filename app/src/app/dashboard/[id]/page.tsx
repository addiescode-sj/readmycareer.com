import { notFound, redirect } from "next/navigation";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { optimizedResumeKey } from "@/lib/query-keys";
import SavedPlanClient from "./SavedPlanClient";

interface RawStrength {
  category: string;
  item: string;
}

interface RawGap {
  category: string;
  item: string;
  priority: "high" | "medium" | "low";
  requirement_type?: "required" | "preferred";
  rationale?: string;
}

interface RawGapSummary {
  strengths?: RawStrength[];
  gaps?: RawGap[];
  overall_match_score?: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  skill: "Skill",
  experience: "Experience",
  certification: "Cert",
  portfolio: "Portfolio",
  keyword: "Keyword",
};

const ALL_CATEGORIES = ["skill", "experience", "certification", "portfolio", "keyword"] as const;

function isRequired(g: RawGap) {
  return g.requirement_type === "required" || (!g.requirement_type && g.priority === "high");
}

function deriveGapAnalysis(summary: RawGapSummary | null) {
  if (!summary) return null;
  const strengths = summary.strengths ?? [];
  const gaps = summary.gaps ?? [];
  if (strengths.length === 0 && gaps.length === 0) return null;

  const competencies = ALL_CATEGORIES.map((cat) => {
    const s = strengths.filter((x) => x.category === cat).length;
    const reqGaps = gaps.filter((x) => x.category === cat && isRequired(x)).length;
    const prefGaps = gaps.filter((x) => x.category === cat && !isRequired(x)).length;

    const reqTotal = s + reqGaps;
    const prefTotal = s + prefGaps;

    const requiredScore = reqTotal > 0 ? Math.round((s / reqTotal) * 100) : 100;
    const preferredScore = prefTotal > 0 ? Math.round((s / prefTotal) * 100) : 100;

    return { name: CATEGORY_LABELS[cat], requiredScore, preferredScore };
  });

  const findings = gaps.map((g) => ({
    text: g.rationale || g.item,
    priority: g.priority,
  }));

  return { competencies, findings, overall_match_score: summary.overall_match_score ?? null };
}

export default async function SavedPlanPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  // Fetch career plan + prefetch optimized resume in parallel
  const [planResult, queryClient] = await Promise.all([
    supabase
      .from("career_plans")
      .select(`
        id, title, target_role, target_company, jd_text, duration_weeks, start_date, end_date,
        gap_analyses(summary_json),
        roadmaps (
          summary,
          phases_json
        )
      `)
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single(),
    (async () => {
      const qc = new QueryClient();
      await qc.prefetchQuery({
        queryKey: optimizedResumeKey(params.id),
        queryFn: async () => {
          const { data } = await supabase
            .from("optimized_resumes")
            .select("id, resume_data, markdown, meta, locale, created_at")
            .eq("career_plan_id", params.id)
            .maybeSingle();
          return data ?? null;
        },
        // Never refetch — optimized resumes are immutable once created
        staleTime: Infinity,
      });
      return qc;
    })(),
  ]);

  const { data: plan, error } = planResult;
  if (error || !plan) {
    return notFound();
  }

  const roadmap = Array.isArray(plan.roadmaps) ? plan.roadmaps[0] : plan.roadmaps;
  const gapRaw = Array.isArray(plan.gap_analyses) ? plan.gap_analyses[0] : plan.gap_analyses;
  const gapSummary = (gapRaw?.summary_json as RawGapSummary | null) ?? null;

  const careerPlan = {
    plan_id: plan.id,
    title: plan.title ?? null,
    target_role: plan.target_role,
    target_company: plan.target_company ?? "",
    summary: roadmap?.summary ?? "",
    duration_weeks: plan.duration_weeks,
    start_date: plan.start_date,
    end_date: plan.end_date,
    weeks: Array.isArray(roadmap?.phases_json) ? roadmap!.phases_json : [],
    gap_analysis: deriveGapAnalysis(gapSummary),
  };

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SavedPlanClient careerPlan={careerPlan} planId={plan.id} />
    </HydrationBoundary>
  );
}
