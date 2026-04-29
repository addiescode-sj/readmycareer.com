import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import SavedPlanClient from "./SavedPlanClient";

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

  const careerPlan = {
    plan_id: plan.id,
    summary: roadmap?.summary ?? "",
    target_jd_title: plan.title ?? plan.target_role,
    duration_weeks: plan.duration_weeks,
    start_date: plan.start_date,
    end_date: plan.end_date,
    weeks: roadmap?.phases_json ?? [],
  };

  return <SavedPlanClient careerPlan={careerPlan} planId={plan.id} />;
}
