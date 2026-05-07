import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import SavedPlanClient from "./SavedPlanClient";

interface RawStrength {
  category: string;
  item: string;
}

interface RawGap {
  category: string;
  item: string;
  priority: "high" | "medium" | "low";
  rationale?: string;
}

interface RawGapSummary {
  strengths?: RawStrength[];
  gaps?: RawGap[];
}

const CATEGORY_LABELS: Record<string, string> = {
  skill: "Skill",
  experience: "Experience",
  certification: "Cert",
  portfolio: "Portfolio",
  keyword: "Keyword",
};

const ALL_CATEGORIES = ["skill", "experience", "certification", "portfolio", "keyword"] as const;

function deriveGapAnalysis(summary: RawGapSummary | null) {
  if (!summary) return null;
  const strengths = summary.strengths ?? [];
  const gaps = summary.gaps ?? [];
  if (strengths.length === 0 && gaps.length === 0) return null;

  const competencies = ALL_CATEGORIES.map((cat) => {
    const s = strengths.filter((x) => x.category === cat).length;
    const g = gaps.filter((x) => x.category === cat).length;
    const total = s + g;
    const score = total > 0 ? Math.round((s / total) * 100) : 0;
    return { name: CATEGORY_LABELS[cat], score };
  });

  const findings = gaps.map((g) => ({
    text: g.rationale || g.item,
    priority: g.priority,
  }));

  return { competencies, findings };
}

export default async function SavedPlanPage({ params }: { params: { id: string } }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: plan, error } = await supabase
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
    .single();

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

  return <SavedPlanClient careerPlan={careerPlan} planId={plan.id} />;
}
