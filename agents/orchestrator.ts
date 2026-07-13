import { randomUUID } from "crypto";
import { getGapAnalyzerInstruction } from "./gap-analyzer/index.js";
import { PLANNER_INSTRUCTION } from "./planner/index.js";
import { runResumeOptimizer as _runResumeOptimizer } from "./resume-optimizer/index.js";
import {
  getModelAdapter,
  ModelAdapter,
  ModelProvider,
  LlmUsage,
  LlmResult,
  ZERO_USAGE,
} from "./lib/model-adapter.js";
import { AgentRunMetric, AgentStage, recordAgentRun } from "./lib/observability.js";
import { GEMINI_MODEL_REASONING } from "./lib/models.js";
import {
  ResumeJson,
  JdSearchResult,
  CareerPlanOutput,
  OptimizedResumeInput,
  OptimizedResumeOutput,
  omitPersonal,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────
// LLM provider details (model name, API retries, timeout, context-cache TTL) now live in
// the provider adapters under ./lib/adapters. The orchestrator stays provider-agnostic.

/** Applies the same thresholds as harness-eval.md at runtime */
const QUALITY_THRESHOLDS = {
  MIN_TODOS_PER_WEEK: 3,       // Plan Completeness ≥ 90%
  DATE_GAP_TOLERANCE_DAYS: 2,  // Date Consistency 100%
};

/** Max retry attempts when quality criteria are not met (total attempts = 1 + MAX_QUALITY_RETRIES) */
const MAX_QUALITY_RETRIES = 2;

// ── Quality validator ─────────────────────────────────────────────────────────
// Applies the same thresholds from harness-eval.md (Schema Compliance, Plan Completeness,
// Date Consistency) at runtime. The agent retries when criteria are not met.

function validateGapAnalysis(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Response is not a JSON object"] };
  }
  const d = data as Record<string, unknown>;

  if (!d.target_role || typeof d.target_role !== "string") errors.push("target_role(string) missing");
  if (!Array.isArray(d.strengths)) errors.push("strengths(array) missing");
  if (!Array.isArray(d.gaps) || d.gaps.length === 0) errors.push("gaps(array) empty or missing");
  if (!Array.isArray(d.priority_order)) errors.push("priority_order(array) missing");
  if (
    typeof d.overall_match_score !== "number" ||
    d.overall_match_score < 0 ||
    d.overall_match_score > 100
  ) {
    errors.push("overall_match_score must be a number between 0 and 100");
  }
  if (!d.summary || typeof d.summary !== "string") errors.push("summary(string) missing");

  // Check structure of each gap item
  if (Array.isArray(d.gaps)) {
    const VALID_CATEGORIES = new Set(["skill", "experience", "certification", "portfolio", "keyword"]);
    const VALID_PRIORITIES = new Set(["high", "medium", "low"]);
    for (const [i, gap] of (d.gaps as any[]).entries()) {
      if (!gap?.id) errors.push(`gaps[${i}].id missing`);

      const cat = (gap?.category || "").toLowerCase();
      const hasValidCat = [...VALID_CATEGORIES].some(v => cat.includes(v));
      if (!hasValidCat) errors.push(`gaps[${i}].category invalid: ${gap?.category}`);

      const prio = (gap?.priority || "").toLowerCase();
      if (!VALID_PRIORITIES.has(prio)) errors.push(`gaps[${i}].priority invalid: ${gap?.priority}`);

      if (!gap?.rationale) errors.push(`gaps[${i}].rationale missing`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateCareerPlan(
  data: unknown,
  expectedWeeks: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Response is not a JSON object"] };
  }

  // Orchestrator return structure: { ...normalizedPlan, career_plan, gap_analysis }
  const d = data as Record<string, unknown>;
  const raw = (d.career_plan ?? d) as Record<string, unknown>;
  const weeks = (raw.weeks ?? raw.weekly_schedule ?? []) as any[];

  if (!raw.summary) errors.push("summary missing");
  if (weeks.length === 0) {
    errors.push("weeks array is empty");
    return { valid: false, errors };
  }
  if (weeks.length < Math.ceil(expectedWeeks * 0.8)) {
    errors.push(`weeks count insufficient: ${weeks.length} (minimum ${Math.ceil(expectedWeeks * 0.8)} required)`);
  }

  // Plan Completeness: todos ≥ MIN_TODOS_PER_WEEK (as defined in harness-eval.md)
  for (const [i, w] of weeks.entries()) {
    const todos: unknown[] = w?.todos ?? [];
    if (todos.length < QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK) {
      errors.push(
        `week ${i + 1} todos insufficient: ${todos.length} (minimum ${QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK})`
      );
    }

    // Date Consistency: check date_range format and order
    if (!w?.date_range?.start || !w?.date_range?.end) {
      errors.push(`week ${i + 1} date_range missing`);
    } else {
      const start = Date.parse(w.date_range.start);
      const end = Date.parse(w.date_range.end);
      if (isNaN(start) || isNaN(end)) {
        errors.push(`week ${i + 1} date_range format invalid`);
      } else if (end < start) {
        errors.push(`week ${i + 1} end(${w.date_range.end}) < start(${w.date_range.start})`);
      } else if (i > 0) {
        const prevEnd = Date.parse(weeks[i - 1]?.date_range?.end ?? "");
        const gapDays = (start - prevEnd) / 86_400_000;
        if (gapDays > QUALITY_THRESHOLDS.DATE_GAP_TOLERANCE_DAYS) {
          errors.push(
            `week ${i} → week ${i + 1} date discontinuity (${Math.round(gapDays)}-day gap)`
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Quality gate retry loop ───────────────────────────────────────────────────
// Re-runs the agent until harness-eval.md thresholds are satisfied.
// On retry, the previous error list is injected into the prompt to guide self-correction.
// Token usage is accumulated across attempts so the caller can record honest cost telemetry.

interface QualityGateResult<T> {
  data: T;
  attempts: number;
  usage: LlmUsage;
}

/** Thrown when a stage fails all attempts; carries accumulated telemetry for failure metrics. */
class QualityGateError extends Error {
  attempts: number;
  usage: LlmUsage;
  constructor(message: string, attempts: number, usage: LlmUsage) {
    super(message);
    this.name = "QualityGateError";
    this.attempts = attempts;
    this.usage = usage;
  }
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
  };
}

async function runWithQualityGate<T>(
  callFn: (retryFeedback: string) => Promise<LlmResult>,
  validateFn: (parsed: unknown) => { valid: boolean; errors: string[] },
  label: string
): Promise<QualityGateResult<T>> {
  let lastErrors: string[] = [];
  let usage: LlmUsage = { ...ZERO_USAGE };
  let attempts = 0;

  for (let attempt = 0; attempt <= MAX_QUALITY_RETRIES; attempt++) {
    attempts = attempt + 1;
    if (attempt > 0) {
      const waitTime = 5000;
      console.log(`[QUALITY GATE][${label}] Waiting ${waitTime / 1000}s before attempt ${attempt + 1}...`);
      await new Promise(r => setTimeout(r, waitTime));
    }

    const retryFeedback =
      attempt === 0
        ? ""
        : `\n\n⚠️ Quality validation failed (errors from previous attempt):\n${lastErrors.map((e) => `- ${e}`).join("\n")}\nNote: "category" must be one of {skill, experience, certification, portfolio, keyword}, and "priority" must be one of {high, medium, low} in lowercase.`;

    const { text, usage: callUsage } = await callFn(retryFeedback);
    usage = addUsage(usage, callUsage);

    if (!text) {
      lastErrors = ["No LLM response (API error)"];
      console.warn(`[QUALITY GATE][${label}] Attempt ${attempt + 1}: no response`);
      continue;
    }

    // JSON parsing (Parse Error Rate metric)
    let parsed: unknown;
    try {
      // Remove ```json ... ``` markdown fence
      const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      lastErrors = [`JSON parse failed: ${e.message}`, `Response preview: ${text.slice(0, 200)}`];
      console.warn(`[QUALITY GATE][${label}] Attempt ${attempt + 1}: JSON parse error`);
      continue;
    }

    // Quality validation (Schema, Plan Completeness, Date Consistency)
    const { valid, errors } = validateFn(parsed);
    if (valid) {
      if (attempt > 0) {
        console.log(`[QUALITY GATE][${label}] Passed quality check on attempt ${attempt + 1}`);
      }
      return { data: parsed as T, attempts, usage };
    }

    lastErrors = errors;
    console.warn(`[QUALITY GATE][${label}] Attempt ${attempt + 1}/${MAX_QUALITY_RETRIES + 1} failed:`, errors);
  }

  throw new QualityGateError(
    `[QUALITY GATE][${label}] Quality criteria not met after ${MAX_QUALITY_RETRIES + 1} attempts.\nLast errors: ${lastErrors.join(" | ")}`,
    attempts,
    usage
  );
}

// ── Stage instrumentation ───────────────────────────────────────────────────
// Times a quality-gated stage, records a structured telemetry metric (on both the success and
// failure paths), forwards it to the optional onMetric sink (the API route persists to
// Supabase), and returns the stage value. This is the observability wrapper at the
// orchestrator boundary — agents themselves stay free of telemetry concerns.

function classifyError(err: any): string {
  if (err instanceof QualityGateError) return "QUALITY_GATE";
  const msg = String(err?.message ?? err);
  if (msg.includes("JSON")) return "JSON_PARSE";
  if (msg.toLowerCase().includes("timeout") || msg.includes("exceeded")) return "TIMEOUT";
  return "ERROR";
}

async function instrumentStage<T>(
  runId: string,
  stage: AgentStage,
  adapter: ModelAdapter,
  run: () => Promise<QualityGateResult<T>>,
  onMetric?: (m: AgentRunMetric) => void
): Promise<T> {
  const start = Date.now();
  const emit = (m: AgentRunMetric) => {
    recordAgentRun(m);
    onMetric?.(m);
  };

  try {
    const { data, attempts, usage } = await run();
    emit({
      runId,
      stage,
      provider: adapter.provider,
      model: adapter.model,
      latencyMs: Date.now() - start,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens,
      cacheHit: usage.cachedTokens > 0,
      retryCount: Math.max(0, attempts - 1),
      success: true,
    });
    return data;
  } catch (err: any) {
    const attempts = err instanceof QualityGateError ? err.attempts : MAX_QUALITY_RETRIES + 1;
    const usage: LlmUsage = err instanceof QualityGateError ? err.usage : { ...ZERO_USAGE };
    emit({
      runId,
      stage,
      provider: adapter.provider,
      model: adapter.model,
      latencyMs: Date.now() - start,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens,
      cacheHit: usage.cachedTokens > 0,
      retryCount: Math.max(0, attempts - 1),
      success: false,
      errorType: classifyError(err),
    });
    throw err;
  }
}

// ── Response normalization ────────────────────────────────────────────────────

function normalizePlan(
  careerPlanData: any,
  gapAnalysisData: any,
  durationWeeks: number,
  startDate: string
): CareerPlanOutput & { gap_analysis: any } {
  const rawPlan = careerPlanData.career_plan || careerPlanData;
  const deepPlan = rawPlan.career_plan || rawPlan;
  const rawWeeks = deepPlan.weeks || deepPlan.weekly_schedule || deepPlan.weekly_plan || [];

  const normalized: any = {
    plan_id: careerPlanData.plan_id || `plan_${Date.now()}`,
    created_at: careerPlanData.created_at || new Date().toISOString(),
    summary:
      deepPlan.summary ||
      deepPlan.plan_overview?.primary_objective ||
      "Weekly career growth plan.",
    start_date: careerPlanData.start_date || startDate,
    duration_weeks: careerPlanData.duration_weeks || durationWeeks,
    weeks: rawWeeks.map((w: any, idx: number) => ({
      week_number: w.week_number || w.week || idx + 1,
      date_range: w.date_range || { start: startDate, end: startDate },
      theme: w.theme || "Learning & Preparation",
      milestone: w.milestone || deepPlan.timeline_milestones?.[idx]?.milestone || null,
      todos: (w.todos || w.action_items || w.learning_objectives || []).map(
        (t: any, tIdx: number) => ({
          id: t.id || `todo_${idx + 1}_${tIdx}`,
          title: typeof t === "string" ? t : t.title || t.item || "Task",
          description: t.description || null,
          category: t.category || "skill",
          priority: t.priority || "medium",
          estimated_hours: t.estimated_hours || 2,
          done: t.done ?? false,
          resources: t.resources || [],
        })
      ),
    })),
    timeline: deepPlan.timeline || {
      milestones: (deepPlan.timeline_milestones || []).map((m: any, i: number) => ({
        week: i + 1,
        date: m.target_date || "",
        label: m.milestone || "",
      })),
      gantt_rows: [],
    },
    end_date: "",
    gap_analysis: gapAnalysisData,
  };

  if (normalized.weeks.length > 0) {
    normalized.end_date = normalized.weeks[normalized.weeks.length - 1].date_range.end;
  }

  return normalized;
}

// ── runCareerAnalysis ─────────────────────────────────────────────────────────
// Resume + raw JD text → gap analysis + career plan
// - Re-analysis of the same resume reduces input tokens via context caching.
// - Each stage output is automatically retried if it fails quality criteria.
// - Career trend reference documents from Vector DB supplement the planning step.
// - Progress is forwarded via the onProgress callback for SSE streaming.
// - Per-stage telemetry is recorded for observability and forwarded via onMetric so the API
//   route can persist it (agents never touch the DB).
// - The gap-analysis stage runs on the requested provider (default Gemini); planning stays on
//   Gemini to preserve the context-cache path and the 16k planner output.

export async function runCareerAnalysis(
  resumeJson: ResumeJson,
  jdText: string,
  // Accepts either resolved results or a pending Promise. When a Promise is passed, the
  // reference search runs in parallel with gap analysis and is awaited only when the
  // planner needs it — overlapping I/O with the longer gap-analysis Gemini call.
  referenceResults: JdSearchResult[] | Promise<JdSearchResult[]>,
  durationWeeks: number,
  startDate: string,
  targetRole: string,
  targetCompany: string,
  onProgress?: (step: string, detail?: string) => void,
  locale?: "ko" | "en",
  provider?: ModelProvider,
  onMetric?: (m: AgentRunMetric) => void,
  // Checkpoint hooks for durable-job resumption (see app/src/app/api/analyze/route.ts).
  // precomputedGapAnalysis skips Step 1 entirely when a caller already has a checkpointed
  // result for this run; onGapAnalysisComplete lets the caller checkpoint a freshly computed one.
  // onToken streams partial LLM output tokens to the caller for live UI rendering.
  checkpoint?: {
    precomputedGapAnalysis?: any;
    onGapAnalysisComplete?: (gapAnalysisData: any) => void;
    onToken?: (chunk: string) => void;
  }
): Promise<CareerPlanOutput & { gap_analysis: any }> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  // Planning + context caches always run on Gemini, so the Google key is required even when
  // gap analysis is delegated to another provider.
  if (!apiKey) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set.");

  const runId = randomUUID();

  // Resolve adapters. Gap analysis is the provider-swappable stage; planning stays on Gemini.
  // Building the gap adapter here surfaces a missing provider key (e.g. OPENAI_API_KEY) before
  // any work starts, so the failure is reported cleanly to the caller.
  const geminiAdapter = await getModelAdapter("gemini", apiKey); // planner stays flash-lite
  const gapAdapter =
    provider && provider !== "gemini"
      ? await getModelAdapter(provider)
      : await getModelAdapter("gemini", apiKey, GEMINI_MODEL_REASONING);

  // Declared as a leading directive so it appears before the JD text in every prompt.
  // Placing it after the JD risks the model matching the JD's language instead of the user's.
  const langDirective =
    locale === "en"
      ? "⚠️ OUTPUT LANGUAGE REQUIREMENT: You MUST write ALL natural-language text fields (rationale, summary, evidence, theme, milestone, todo titles/descriptions) in English regardless of the language of the Job Description or resume."
      : "⚠️ 출력 언어 요구사항: JD나 이력서의 언어에 관계없이, 모든 자연어 텍스트 필드(rationale, summary, evidence, theme, milestone, todo 제목/설명)를 반드시 한국어로 작성하세요.";

  // ── Step 0: Prepare resume caches in parallel ────────────────────────────
  // Strip personal contact info — not needed for analysis, reduces token usage.
  const resumeForAnalysis = omitPersonal(resumeJson);
  // Build locale-aware gap analyzer instruction so the language requirement is in the system
  // instruction itself — models follow system-instruction examples more strongly than user-prompt directives.
  const gapInstruction = getGapAnalyzerInstruction(locale ?? "ko");
  onProgress?.("cache");

  // Warm both caches concurrently. The planner cache used to be created lazily right before
  // step 2, blocking the planner on a cold cache create (~300ms). Doing both upfront overlaps
  // their cost with each other and keeps step 2 hot. The gap cache is only warmed when the
  // gap adapter supports context caching (Gemini); otherwise the resume is inlined.
  const [gapCacheName, planCacheName] = await Promise.all([
    gapAdapter.supportsContextCache && gapAdapter.getOrCreateCache
      ? gapAdapter.getOrCreateCache({ systemInstruction: gapInstruction, resumeJson: resumeForAnalysis })
      : Promise.resolve<string | null>(null),
    geminiAdapter.getOrCreateCache!({ systemInstruction: PLANNER_INSTRUCTION, resumeJson: resumeForAnalysis }),
  ]);

  // ── Step 1: Gap analysis (with quality gate) ─────────────────────────────
  // Uses the user-provided raw JD text directly for precise gap identification.
  // Skipped entirely when the caller already has a checkpointed result for this run
  // (durable-job resume — see the `checkpoint` param).
  let gapAnalysisData: any;
  if (checkpoint?.precomputedGapAnalysis) {
    gapAnalysisData = checkpoint.precomputedGapAnalysis;
    console.log("[ORCHESTRATOR] Step 1: Gap Analysis skipped (resumed from checkpoint)");
  } else {
    onProgress?.("gap_analysis");
    console.log(`[ORCHESTRATOR] Step 1: Gap Analysis started (provider=${gapAdapter.provider})...`);

    gapAnalysisData = await instrumentStage<any>(
      runId,
      "gap_analysis",
      gapAdapter,
      () =>
        runWithQualityGate<any>(
          (retryFeedback) => {
            // When no cache is available, include the full resume JSON inline so the model
            // always has the data it needs. With a cache, the resume is already in context.
            const resumeSection = gapCacheName
              ? "(Resume JSON is included in the context cache above — use it for all phase comparisons.)"
              : `## Resume JSON (use this for all phase comparisons):
${JSON.stringify(resumeForAnalysis, null, 2)}`;

            const prompt = `
${langDirective}

Follow ALL 8 phases in your instruction exactly. Work through each phase in order.
Do NOT skip Phase 3 (Skill-Level Matching) — iterate over EVERY item in JD_REQUIRED and JD_PREFERRED.
Output JSON only — no markdown, no prose.

## User-Specified Target (do NOT change)
- target_company: ${targetCompany}
- target_role: ${targetRole}

⚠️ The "target_role" field in the output JSON MUST be "${targetRole}".
⚠️ Evaluate ALL strengths and gaps in the context of the above target company/role.
⚠️ A skill that appears in BOTH the resume AND the JD MUST be listed in strengths[]. Never omit confirmed matches.

## Required output fields:
"target_role"(string), "strengths"(array), "gaps"(array, ≥1 item),
"priority_order"(array), "overall_match_score"(0–100 integer), "summary"(string)

## Valid value constraints:
- category: exactly one of {"skill", "experience", "certification", "portfolio", "keyword"}
- priority: exactly one of {"high", "medium", "low"} in lowercase

${resumeSection}

## Job Description:
${jdText}
${retryFeedback}
`.trim();

            return gapAdapter.generateContent({
              systemInstruction: gapInstruction,
              userPrompt: prompt,
              cachedContentName: gapCacheName,
              maxOutputTokens: 8192,
              temperature: 0.2,
              topP: 0.85,
              onToken: checkpoint?.onToken,
            });
          },
          validateGapAnalysis,
          "GapAnalysis"
        ),
      onMetric
    );

    console.log(
      `[ORCHESTRATOR] Step 1 complete — match_score=${gapAnalysisData.overall_match_score}, gaps=${gapAnalysisData.gaps?.length}`
    );
    checkpoint?.onGapAnalysisComplete?.(gapAnalysisData);
  }

  // ── Step 2: Career plan generation (with quality gate) ───────────────────
  // Uses gap analysis results + career trend reference documents from Vector DB.
  onProgress?.("planning");
  console.log("[ORCHESTRATOR] Step 2: Career Planning started...");

  // planCacheName is already warmed in parallel at step 0 — no extra round-trip here.

  // If the caller passed a pending reference-search Promise, await it now. Reference search
  // was kicked off before gap analysis so its latency is masked by the gap-analysis Gemini call.
  const resolvedReferenceResults: JdSearchResult[] = Array.isArray(referenceResults)
    ? referenceResults
    : await referenceResults.catch((err) => {
        console.warn("[ORCHESTRATOR] Reference search failed — proceeding without context:", err?.message ?? err);
        return [] as JdSearchResult[];
      });

  const existingProjects = resumeForAnalysis.projects ?? [];
  const existingProjectsSection =
    existingProjects.length > 0
      ? existingProjects
          .map(
            (p) =>
              `- ${p.name} [${p.tech_stack.join(", ")}]${p.url ? ` | URL: ${p.url}` : ""}${p.description ? `: ${p.description}` : ""}`
          )
          .join("\n")
      : "(No side projects in resume)";

  const careerPlanData = await instrumentStage<any>(
    runId,
    "planning",
    geminiAdapter,
    () =>
      runWithQualityGate<any>(
        (retryFeedback) => {
          const prompt = `
${langDirective}

Based on the target company/role, gap analysis, and career trend context below, output a ${durationWeeks}-week career plan as JSON only.

## User-Specified Target (do NOT change)
- target_company: ${targetCompany}
- target_role: ${targetRole}

⚠️ All weekly learning tasks must be designed in the context of preparing for "${targetCompany} ${targetRole}".

## Required structure:
{
  "summary": "plan summary",
  "weeks": [
    {
      "week_number": 1,
      "date_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
      "theme": "weekly theme",
      "milestone": "milestone or null",
      "todos": [
        { "id": "t1", "title": "task", "description": "description", "category": "skill",
          "priority": "high", "estimated_hours": 2, "done": false, "resources": [] }
      ]
    }
  ],
  "timeline": { "milestones": [], "gantt_rows": [] }
}

⚠️ Each week MUST have at least ${QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK} todos.
⚠️ date_range must be in YYYY-MM-DD format and dates must be consecutive across weeks.
⚠️ When portfolio-category gaps can be addressed by extending an existing side project listed below, PREFER that approach over building from scratch. Reference the project by name in the todo title/description.

## User's Existing Side Projects (leverage these to address gaps):
${existingProjectsSection}

## Gap Analysis Results:
${JSON.stringify(gapAnalysisData, null, 2)}

## Industry & Career Trend Context (supplementary reference):
${
  resolvedReferenceResults.length > 0
    ? JSON.stringify(resolvedReferenceResults, null, 2)
    : "(No reference data available — rely on general knowledge for career trends)"
}

Start date: ${startDate} / Duration: ${durationWeeks} weeks
${retryFeedback}
`.trim();

          return geminiAdapter.generateContent({
            systemInstruction: PLANNER_INSTRUCTION,
            userPrompt: prompt,
            cachedContentName: planCacheName,
            maxOutputTokens: 16384,
          });
        },
        (parsed) => validateCareerPlan(parsed, durationWeeks),
        "CareerPlan"
      ),
    onMetric
  );

  console.log(
    `[ORCHESTRATOR] Step 2 complete — weeks=${careerPlanData.weeks?.length ?? careerPlanData.career_plan?.weeks?.length}`
  );

  onProgress?.("done");

  return normalizePlan(careerPlanData, gapAnalysisData, durationWeeks, startDate);
}

// ── runResumeOptimizer ────────────────────────────────────────────────────────

export async function runResumeOptimizer(
  input: OptimizedResumeInput
): Promise<OptimizedResumeOutput> {
  return _runResumeOptimizer(input);
}
