import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { callMcpTool } from "@readmycareer/agents/mcp-client";
import type { AgentRunMetric } from "@readmycareer/agents/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { z } from "zod";

// Extend Vercel serverless function timeout to 60 seconds (Pro tier max without Enterprise).
export const maxDuration = 60;

const AnalyzeSchema = z.object({
  resumeJson: z.record(z.unknown()),
  targetRole: z.string().min(1).max(200),
  targetCompany: z.string().max(200).default(""),
  jdText: z.string().min(50).max(10000),
  durationWeeks: z.number().int().min(1).max(24),
  startDate: z.string().min(1).max(30),
  locale: z.enum(["ko", "en"]).optional(),
  // Optional LLM provider override for the gap-analysis stage (default: gemini).
  provider: z.enum(["gemini", "openai"]).optional(),
  // Set when retrying a run that already returned a `job` event — lets the pipeline skip
  // stages already checkpointed in career_plan_jobs. See runCareerAnalysis's `checkpoint` param.
  resumeJobId: z.string().uuid().optional(),
});

type CareerPlanJobRow = {
  id: string;
  status: "pending" | "gap_analysis_done" | "completed" | "error";
  gap_analysis_result: unknown;
  career_plan_result: unknown;
  input_fingerprint: string | null;
};

/**
 * Fingerprints the request inputs a checkpointed job is bound to, so a resumed/replayed job
 * can never be served against a different resume/JD/role/duration/date/provider than the one
 * it was actually computed for (e.g. a retry that edited the JD after receiving a jobId).
 */
function computeInputFingerprint(input: {
  resumeJson: unknown;
  jdText: string;
  targetRole: string;
  targetCompany: string;
  durationWeeks: number;
  startDate: string;
  locale: "ko" | "en";
  provider?: "gemini" | "openai";
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/**
 * Durable-job checkpointing for the analyze pipeline (client-reconnect resumability only —
 * see supabase/migrations/20260713000000_add_career_plan_jobs.sql). Anonymous requests
 * (userId === null) are not checkpointed; every helper here is a no-op for them.
 */
async function createCareerPlanJob(userId: string | null, inputFingerprint: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("career_plan_jobs")
      .insert({ user_id: userId, input_fingerprint: inputFingerprint })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  } catch (err: any) {
    console.warn("[/api/analyze] career_plan_jobs insert failed:", err?.message ?? err);
    return null;
  }
}

async function fetchCareerPlanJob(jobId: string, userId: string | null): Promise<CareerPlanJobRow | null> {
  if (!userId) return null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("career_plan_jobs")
      .select("id, status, gap_analysis_result, career_plan_result, input_fingerprint")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data as CareerPlanJobRow | null;
  } catch (err: any) {
    console.warn("[/api/analyze] career_plan_jobs fetch failed:", err?.message ?? err);
    return null;
  }
}

async function updateCareerPlanJob(
  jobId: string | null,
  patch: { status: CareerPlanJobRow["status"]; gap_analysis_result?: unknown; career_plan_result?: unknown; error_message?: string },
  label: string
): Promise<void> {
  if (!jobId) return;
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.from("career_plan_jobs").update(patch).eq("id", jobId);
    if (error) throw error;
  } catch (err: any) {
    console.warn(`[/api/analyze] career_plan_jobs ${label} checkpoint failed:`, err?.message ?? err);
  }
}

const checkpointGapAnalysis = (jobId: string | null, gapAnalysisData: unknown) =>
  updateCareerPlanJob(jobId, { status: "gap_analysis_done", gap_analysis_result: gapAnalysisData }, "gap-analysis");

const completeCareerPlanJob = (jobId: string | null, careerPlan: unknown) =>
  updateCareerPlanJob(jobId, { status: "completed", career_plan_result: careerPlan }, "completion");

const failCareerPlanJob = (jobId: string | null, errorMessage: string) =>
  updateCareerPlanJob(jobId, { status: "error", error_message: errorMessage }, "error");

/**
 * Persists per-stage agent telemetry to Supabase. Best-effort and non-blocking: a failure here
 * must never break the analysis response. Agents emit metrics; the API route owns DB I/O.
 */
async function persistAgentRuns(
  metrics: AgentRunMetric[],
  userId: string | null
): Promise<void> {
  if (metrics.length === 0) return;
  try {
    const supabase = await createServerSupabaseClient();
    const rows = metrics.map((m) => ({
      run_id: m.runId,
      user_id: userId,
      stage: m.stage,
      provider: m.provider,
      model: m.model,
      latency_ms: Math.round(m.latencyMs),
      prompt_tokens: m.promptTokens,
      completion_tokens: m.completionTokens,
      cached_tokens: m.cachedTokens,
      cache_hit: m.cacheHit,
      retry_count: m.retryCount,
      success: m.success,
      error_type: m.errorType ?? null,
    }));
    const { error } = await supabase.from("agent_runs").insert(rows);
    if (error) {
      console.warn("[/api/analyze] agent_runs insert failed:", error.message);
    }
  } catch (err: any) {
    console.warn("[/api/analyze] agent_runs persistence error:", err?.message ?? err);
  }
}

const MAX_BODY_BYTES = 500_000; // 500 KB — covers resumeJson + jdText + metadata

function detectLocale(acceptLanguage: string | null): "ko" | "en" {
  if (!acceptLanguage) return "ko";
  const langs = acceptLanguage
    .split(",")
    .map((l) => l.split(";")[0].trim().toLowerCase());
  for (const lang of langs) {
    if (lang.startsWith("ko")) return "ko";
    if (lang.startsWith("en")) return "en";
  }
  return "ko";
}

// Searches the career knowledge base MCP via the pooled client (no per-call subprocess spawn).
// Default filter is "jd"; pass { doc_type: "reference" } for career trend/industry documents.
async function searchJdFromMcp(
  query: string,
  filter: { doc_type: "jd" | "reference" } = { doc_type: "jd" }
): Promise<unknown[]> {
  const parsed = (await callMcpTool("career-knowledge-base", "search", {
    query,
    top_k: 5,
    filter,
  })) as { results?: unknown[] };
  return parsed.results ?? [];
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseChunk(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

// ── POST handler (SSE streaming) ──────────────────────────────────────────────
//
// Response format: text/event-stream (Server-Sent Events)
//
// Event order:
//   event: progress  →  { step: string, message: string }
//   event: result    →  CareerPlanOutput (includes gap_analysis)
//   event: error     →  { message: string }
//   event: done      →  {}
//
// Frontend usage example:
//   const es = new EventSource('/api/analyze', { method: 'POST', ... })
//   es.addEventListener('progress', e => setStatus(JSON.parse(e.data).message))
//   es.addEventListener('result', e => setPlan(JSON.parse(e.data)))

export async function POST(req: NextRequest) {
  // Payload size limit
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(
      JSON.stringify({ error: "Request payload too large." }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: z.infer<typeof AnalyzeSchema>;
  try {
    const raw = await req.json();
    body = AnalyzeSchema.parse(raw);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid input." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Body locale takes precedence — it reflects the app's active UI language selected by the user.
  // Accept-Language is only used as a fallback for clients that don't send the locale field.
  const locale = body.locale ?? detectLocale(req.headers.get("accept-language"));

  const { resumeJson, targetRole, targetCompany, jdText, durationWeeks, startDate, provider, resumeJobId } = body;

  // Resolve the user (if any) up front, in request scope, for telemetry attribution.
  // The analyze endpoint also serves anonymous visitors, so userId may be null.
  let userId: string | null = null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // Anonymous / no session — telemetry rows are stored with a null user_id.
  }

  const inputFingerprint = computeInputFingerprint({
    resumeJson, jdText, targetRole, targetCompany, durationWeeks, startDate, locale, provider,
  });

  // Durable-job lookup: only meaningful for authenticated retries carrying a jobId from a
  // prior `job` event. Anonymous requests and fresh runs fall through with existingJob = null.
  const fetchedJob = resumeJobId ? await fetchCareerPlanJob(resumeJobId, userId) : null;
  // A checkpointed job is only resumable/replayable for the exact inputs it was computed for —
  // otherwise a retry after editing the JD/resume/role could replay or splice in stale data.
  if (fetchedJob && fetchedJob.input_fingerprint !== inputFingerprint) {
    console.warn(`[/api/analyze] job ${fetchedJob.id} input fingerprint mismatch — ignoring checkpoint`);
  }
  const existingJob = fetchedJob && fetchedJob.input_fingerprint === inputFingerprint ? fetchedJob : null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(sseChunk(event, data));

      // Full replay: this exact job already finished — skip the pipeline entirely.
      if (existingJob?.status === "completed" && existingJob.career_plan_result) {
        send("job", { jobId: existingJob.id });
        send("result", existingJob.career_plan_result);
        send("done", {});
        controller.close();
        return;
      }

      const jobId = existingJob?.id ?? (await createCareerPlanJob(userId, inputFingerprint));
      if (jobId) send("job", { jobId });
      const precomputedGapAnalysis = existingJob?.gap_analysis_result ?? undefined;

      // Per-stage telemetry collected from the orchestrator and persisted after the run.
      const metrics: AgentRunMetric[] = [];

      try {
        // 1. Kick off reference search + orchestrator import in PARALLEL with the rest of
        //    the pipeline. Reference data is only consumed by the planner (step 2), so its
        //    ~500ms latency is fully masked by the gap-analysis Gemini call.
        send("progress", { step: "reference_search" });

        const referenceResultsPromise = searchJdFromMcp(
          `${targetRole} ${targetCompany}`.trim(),
          { doc_type: "reference" }
        )
          .then((r) => {
            send("progress", { step: "reference_search_done" });
            return r as unknown[];
          })
          .catch((mcpErr: any) => {
            console.warn(
              "[/api/analyze] Reference search failed — proceeding without supplementary context:",
              mcpErr?.message ?? mcpErr
            );
            send("progress", { step: "reference_search_done" });
            return [] as unknown[];
          });

        // 2. Run agent pipeline (gap analysis uses jdText directly; planner awaits referenceResults)
        const { runCareerAnalysis } = await import(
          "@readmycareer/agents/orchestrator"
        ) as {
          runCareerAnalysis: (
            resumeJson: unknown,
            jdText: string,
            referenceResults: unknown[] | Promise<unknown[]>,
            durationWeeks: number,
            startDate: string,
            targetRole: string,
            targetCompany: string,
            onProgress?: (step: string, detail?: string) => void,
            locale?: "ko" | "en",
            provider?: "gemini" | "openai",
            onMetric?: (m: AgentRunMetric) => void,
            checkpoint?: {
              precomputedGapAnalysis?: unknown;
              onGapAnalysisComplete?: (gapAnalysisData: unknown) => void;
              onToken?: (chunk: string) => void;
            }
          ) => Promise<unknown>;
        };

        const careerPlan = await runCareerAnalysis(
          resumeJson,
          jdText,
          referenceResultsPromise,
          durationWeeks,
          startDate,
          targetRole,
          targetCompany,
          // onProgress → forward step key as SSE progress event; client translates
          (step) => send("progress", { step }),
          locale,
          provider,
          // onMetric → collect per-stage telemetry for post-run persistence
          (m) => metrics.push(m),
          {
            precomputedGapAnalysis,
            // Fire-and-forget: checkpointGapAnalysis swallows its own errors, so this never
            // throws into the orchestrator's control flow.
            onGapAnalysisComplete: (data) => void checkpointGapAnalysis(jobId, data),
            // Stream partial LLM tokens to the client for live reasoning display.
            onToken: (chunk) => send("token", { text: chunk }),
          }
        );

        // 3. Send result
        await completeCareerPlanJob(jobId, careerPlan);
        send("result", careerPlan);
      } catch (err: unknown) {
        console.error("[/api/analyze]", err);
        await failCareerPlanJob(jobId, err instanceof Error ? err.message : "Unknown error");
        send("error", { message: "An error occurred during analysis." });
      } finally {
        // Persist telemetry (best-effort) before closing the stream.
        await persistAgentRuns(metrics, userId);
        send("done", {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering
    },
  });
}
