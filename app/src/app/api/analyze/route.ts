import { NextRequest } from "next/server";
import { callMcpTool } from "@readmycareer/agents/mcp-client";
import { z } from "zod";

const AnalyzeSchema = z.object({
  resumeJson: z.record(z.unknown()),
  targetRole: z.string().min(1).max(200),
  targetCompany: z.string().max(200).default(""),
  jdText: z.string().min(50).max(10000),
  durationWeeks: z.number().int().min(1).max(24),
  startDate: z.string().min(1).max(30),
  locale: z.enum(["ko", "en"]).optional(),
});

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

  const { resumeJson, targetRole, targetCompany, jdText, durationWeeks, startDate } = body;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(sseChunk(event, data));

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
            locale?: "ko" | "en"
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
          locale
        );

        // 3. Send result
        send("result", careerPlan);
      } catch (err: unknown) {
        console.error("[/api/analyze]", err);
        send("error", { message: "An error occurred during analysis." });
      } finally {
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
