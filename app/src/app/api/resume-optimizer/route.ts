import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { runResumeOptimizer } from "@readmycareer/agents/orchestrator";
import type { OptimizedResumeInput, TodoItem } from "@readmycareer/agents/types";

const RequestSchema = z.object({
  career_plan_id: z.string().uuid(),
});

function detectLocale(req: NextRequest): "ko" | "en" {
  const acceptLang = req.headers.get("accept-language") ?? "";
  return acceptLang.toLowerCase().startsWith("ko") ? "ko" : "en";
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { career_plan_id } = body;
  const locale = detectLocale(req);

  // ── Fetch all 4 sources in parallel (independent reads — was 4 sequential round trips). ──
  // Idempotency check still short-circuits below; we pay the (small) cost of the other 3
  // reads only on cache miss, but since they're concurrent they finish within the slowest one.
  const [
    { data: existing },
    { data: plan, error: planError },
    { data: roadmapRow },
    { data: gapRow },
  ] = await Promise.all([
    supabase
      .from("optimized_resumes")
      .select("id, resume_data, markdown, meta, locale, created_at")
      .eq("career_plan_id", career_plan_id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("career_plans")
      .select("id, target_role, target_company, jd_text, resume_json")
      .eq("id", career_plan_id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("roadmaps")
      .select("phases_json")
      .eq("career_plan_id", career_plan_id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("gap_analyses")
      .select("summary_json")
      .eq("career_plan_id", career_plan_id)
      .eq("user_id", user.id)
      .single(),
  ]);

  // ── Idempotency: return existing result if present and has projects data ──
  const existingHasProjects =
    existing &&
    Array.isArray((existing.resume_data as Record<string, unknown>)?.projects);

  if (existingHasProjects) {
    return NextResponse.json(existing);
  }

  // ── Verify career plan ownership ─────────────────────────────────────────
  if (planError || !plan) {
    return NextResponse.json({ error: "Career plan not found" }, { status: 404 });
  }

  // ── Load todos from roadmaps.phases_json (source of truth for completion) ──
  const allTodos: TodoItem[] = ((roadmapRow?.phases_json as Array<{ todos?: TodoItem[] }>) ?? [])
    .flatMap(phase => phase.todos ?? []);

  const incompleteTodos = allTodos.filter(t => !t.done && String(t.done) !== "true");
  if (incompleteTodos.length > 0) {
    return NextResponse.json(
      { error: "All checklist items must be completed before generating an optimized resume" },
      { status: 422 }
    );
  }

  const completedTodos = allTodos.filter(t => t.done || String(t.done) === "true");

  if (!gapRow?.summary_json) {
    return NextResponse.json({ error: "Gap analysis not found" }, { status: 404 });
  }

  if (!plan.resume_json) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const resumeJson = plan.resume_json as Record<string, unknown>;
  if (!resumeJson.personal) {
    return NextResponse.json(
      { error: "Resume is missing personal info. Please create a new career plan and try again." },
      { status: 422 }
    );
  }

  // ── Run optimizer ─────────────────────────────────────────────────────────
  const optimizerInput: OptimizedResumeInput = {
    resume_json: plan.resume_json as OptimizedResumeInput["resume_json"],
    gap_analysis: gapRow.summary_json as OptimizedResumeInput["gap_analysis"],
    completed_todos: completedTodos,
    target_jd: {
      title: plan.target_role,
      company: plan.target_company || null,
      jd_text: plan.jd_text,
    },
    locale,
  };

  let optimizerResult: Awaited<ReturnType<typeof runResumeOptimizer>>;
  try {
    optimizerResult = await runResumeOptimizer(optimizerInput);
  } catch (err: any) {
    console.error("[/api/resume-optimizer] runResumeOptimizer failed:", err?.message ?? err);
    return NextResponse.json(
      { error: "Resume generation failed. Please try again." },
      { status: 500 }
    );
  }

  // ── Persist to Supabase (upsert to handle re-generation of legacy rows) ──
  const upsertPayload = {
    career_plan_id,
    user_id: user.id,
    locale,
    resume_data: optimizerResult.resume_data,
    markdown: optimizerResult.markdown,
    meta: optimizerResult.meta,
  };

  const { data: upserted, error: upsertError } = await supabase
    .from("optimized_resumes")
    .upsert(upsertPayload, { onConflict: "career_plan_id" })
    .select("id, resume_data, markdown, meta, locale, created_at")
    .single();

  if (upsertError) {
    console.error("[/api/resume-optimizer] DB upsert failed:", upsertError);
    return NextResponse.json({ error: "Failed to save resume" }, { status: 500 });
  }

  return NextResponse.json(upserted, { status: 201 });
}
