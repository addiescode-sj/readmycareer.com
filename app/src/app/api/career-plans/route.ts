import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const TodoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  category: z.string(),
  priority: z.string(),
  estimated_hours: z.number(),
  done: z.boolean(),
  resources: z.array(z.unknown()).default([]),
});

const WeekPlanSchema = z.object({
  week_number: z.number().int().positive(),
  date_range: z.object({ start: z.string(), end: z.string() }),
  theme: z.string(),
  milestone: z.string().nullable().optional(),
  todos: z.array(TodoItemSchema),
});

const CareerPlanSaveSchema = z.object({
  targetRole: z.string().min(1).max(200),
  targetCompany: z.string().max(200).default(""),
  jdText: z.string().min(50).max(10000),
  resumeJson: z.record(z.unknown()).optional(),
  careerPlan: z.object({
    plan_id: z.string(),
    summary: z.string(),
    start_date: z.string(),
    end_date: z.string(),
    duration_weeks: z.number().int().positive(),
    target_jd_title: z.string().optional(),
    weeks: z.array(WeekPlanSchema),
  }),
  gapAnalysis: z.object({
    target_role: z.string(),
    overall_match_score: z.number().min(0).max(100),
    strengths: z.array(z.unknown()).default([]),
    gaps: z.array(z.unknown()).default([]),
    priority_order: z.array(z.string()).default([]),
    summary: z.string(),
  }),
});

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("career_plans")
    .select("id, title, target_role, target_company, status, start_date, duration_weeks, created_at, roadmaps(summary, week_count)")
    .eq("user_id", user.id)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch career plans" }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CareerPlanSaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  const { targetRole, targetCompany, jdText, resumeJson, careerPlan, gapAnalysis } = parsed.data;

  // 1. Insert career_plans
  const formattedDate = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const defaultTitle = `${formattedDate}에 저장된 ${careerPlan.target_jd_title ?? targetRole}`;

  const { data: plan, error: planError } = await supabase
    .from("career_plans")
    .insert({
      user_id: user.id,
      title: defaultTitle,
      target_role: targetRole,
      target_company: targetCompany,
      jd_text: jdText,
      resume_json: resumeJson ?? null,
      duration_weeks: careerPlan.duration_weeks,
      start_date: careerPlan.start_date,
      end_date: careerPlan.end_date,
      status: "active",
    })
    .select("id")
    .single();

  if (planError) {
    // Trigger violation: career plan limit reached (check_violation = 23514)
    if (
      planError.code === "23514" ||
      planError.message?.toLowerCase().includes("career plan limit")
    ) {
      return NextResponse.json({ error: "plan_limit_reached" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to save career plan" }, { status: 500 });
  }

  // 2. Insert gap_analyses
  const { data: gap } = await supabase
    .from("gap_analyses")
    .insert({
      career_plan_id: plan.id,
      user_id: user.id,
      target_role: gapAnalysis.target_role,
      overall_match_score: gapAnalysis.overall_match_score,
      current_skills: gapAnalysis.strengths,  // strengths maps to current_skills in DB
      missing_skills: gapAnalysis.gaps,        // gaps maps to missing_skills in DB
      priorities: gapAnalysis.priority_order,
      summary: gapAnalysis.summary,
      summary_json: gapAnalysis,
    })
    .select("id")
    .single();

  // 3. Insert roadmaps
  const { data: roadmap } = await supabase
    .from("roadmaps")
    .insert({
      career_plan_id: plan.id,
      user_id: user.id,
      gap_analysis_id: gap?.id ?? null,
      summary: careerPlan.summary,
      week_count: careerPlan.weeks.length,
      phases_json: careerPlan.weeks,
      timeline_json: { milestones: [], gantt_rows: [] },
    })
    .select("id")
    .single();

  // 4. Bulk insert weekly_tasks
  if (roadmap) {
    const weeklyTaskRows = careerPlan.weeks.map((week) => ({
      roadmap_id: roadmap.id,
      user_id: user.id,
      week_number: week.week_number,
      date_start: week.date_range.start,
      date_end: week.date_range.end,
      theme: week.theme,
      milestone: week.milestone ?? null,
      action_items: week.todos,
    }));

    await supabase.from("weekly_tasks").insert(weeklyTaskRows);
  }

  return NextResponse.json({ career_plan_id: plan.id }, { status: 201 });
}
