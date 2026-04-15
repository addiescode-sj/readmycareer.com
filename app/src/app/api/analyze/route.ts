import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";
import { z } from "zod";
import { searchJdFromGoogle } from "@/lib/externalJdSearch";

const AnalyzeSchema = z.object({
  resumeJson: z.record(z.unknown()),
  targetRole: z.string().min(1).max(200),
  targetCompany: z.string().max(200).default(""),
  durationWeeks: z.number().int().min(1).max(52),
  startDate: z.string().min(1).max(30),
});

const MAX_BODY_BYTES = 500_000; // 500 KB

/** Minimum score cutoff for Vector DB — falls back to Google Search if below this threshold */
const VECTOR_SCORE_THRESHOLD = 0.35;

const KB_SKILL_PATH = resolve(
  process.cwd(),
  "../mcp-skills/career-knowledge-base/dist/index.js"
);

async function searchJdFromMcp(query: string) {
  // Pass only the env vars required by the career-knowledge-base MCP
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    NODE_ENV: process.env.NODE_ENV ?? "production",
    ...(process.env.GOOGLE_API_KEY && { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY }),
    ...(process.env.GOOGLE_GENAI_API_KEY && { GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY }),
    ...(process.env.GEMINI_API_KEY && { GEMINI_API_KEY: process.env.GEMINI_API_KEY }),
    ...(process.env.PINECONE_API_KEY && { PINECONE_API_KEY: process.env.PINECONE_API_KEY }),
    ...(process.env.PINECONE_INDEX_NAME && { PINECONE_INDEX_NAME: process.env.PINECONE_INDEX_NAME }),
  };

  const transport = new StdioClientTransport({
    command: "node",
    args: [KB_SKILL_PATH],
    env,
  });
  const client = new Client({ name: "next-api", version: "1.0.0" });
  await client.connect(transport);

  const result = await client.callTool({
    name: "search",
    arguments: { query, top_k: 5, filter: { doc_type: "jd" } },
  });

  await client.close();

  const contentArr = result.content as Array<{ type: string; text?: string }>;
  const text = contentArr.find((c) => c.type === "text")?.text ?? "{}";

  if (result.isError) {
    throw new Error(`MCP Error: ${text}`);
  }

  const parsed = JSON.parse(text) as { results?: unknown[] };
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
      JSON.stringify({ error: "요청 데이터가 너무 큽니다." }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: z.infer<typeof AnalyzeSchema>;
  try {
    const raw = await req.json();
    body = AnalyzeSchema.parse(raw);
  } catch {
    return new Response(
      JSON.stringify({ error: "입력값이 올바르지 않습니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { resumeJson, targetRole, targetCompany, durationWeeks, startDate } = body;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(sseChunk(event, data));

      try {
        // 1. JD hybrid search: ① Vector DB → ② (0 hits or low score) Google Search fallback
        send("progress", { step: "jd_search", message: "벡터DB에서 관련 JD 검색 중..." });
        let jdResults: any[] = [];
        let jdSource: "vector_db" | "google_search" | "vector_db+google_search" = "vector_db";

        try {
          jdResults = await searchJdFromMcp(
            `${targetRole} ${targetCompany}`.trim()
          );
        } catch (mcpErr: any) {
          console.warn("[/api/analyze] Vector DB 검색 실패 — 폴백으로 진행:", mcpErr?.message ?? mcpErr);
          jdResults = [];
        }

        const topScore = jdResults.reduce(
          (max: number, r: any) => Math.max(max, Number(r?.score ?? 0)),
          0
        );
        const needsFallback = jdResults.length === 0 || topScore < VECTOR_SCORE_THRESHOLD;

        if (needsFallback) {
          send("progress", {
            step: "jd_fallback",
            message:
              jdResults.length === 0
                ? "벡터DB에 관련 JD 없음 — Google 웹 검색으로 폴백..."
                : `벡터DB 최고 점수 ${topScore.toFixed(2)} < ${VECTOR_SCORE_THRESHOLD} — Google 웹 검색으로 보강...`,
          });

          const externalResults = await searchJdFromGoogle(targetRole, targetCompany);

          if (externalResults.length > 0) {
            jdResults = [...jdResults, ...externalResults];
            jdSource = jdResults.length > externalResults.length
              ? "vector_db+google_search"
              : "google_search";
          }
        }

        send("progress", {
          step: "jd_search_done",
          message: `JD ${jdResults.length}건 확보 (source: ${jdSource})`,
        });

        // 2. Run agent pipeline
        const { runCareerAnalysis } = await import(
          "@readmycareer/agents/orchestrator"
        ) as {
          runCareerAnalysis: (
            resumeJson: unknown,
            jdResults: unknown[],
            durationWeeks: number,
            startDate: string,
            targetRole: string,
            targetCompany: string,
            onProgress?: (step: string, detail?: string) => void
          ) => Promise<unknown>;
        };

        const careerPlan = await runCareerAnalysis(
          resumeJson,
          jdResults,
          durationWeeks,
          startDate,
          targetRole,
          targetCompany,
          // onProgress → forward as SSE progress event
          (step, detail) => send("progress", { step, message: detail ?? step })
        );

        // 3. Send result
        send("result", careerPlan);
      } catch (err: unknown) {
        console.error("[/api/analyze]", err);
        send("error", { message: "분석 중 오류가 발생했습니다." });
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
