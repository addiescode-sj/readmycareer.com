import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";
import { z } from "zod";

const AnalyzeSchema = z.object({
  resumeJson: z.record(z.unknown()),
  targetRole: z.string().min(1).max(200),
  targetCompany: z.string().max(200).default(""),
  jdText: z.string().min(50).max(10000),
  durationWeeks: z.number().int().min(1).max(24),
  startDate: z.string().min(1).max(30),
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

const KB_SKILL_PATH = resolve(
  process.cwd(),
  "../mcp-skills/career-knowledge-base/dist/index.js"
);

// Searches the career knowledge base MCP.
// Default filter is "jd"; pass { doc_type: "reference" } for career trend/industry documents.
async function searchJdFromMcp(
  query: string,
  filter: { doc_type: "jd" | "reference" } = { doc_type: "jd" }
) {
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
    arguments: { query, top_k: 5, filter },
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
      JSON.stringify({ error: "Request payload too large." }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }

  const locale = detectLocale(req.headers.get("accept-language"));

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

  const { resumeJson, targetRole, targetCompany, jdText, durationWeeks, startDate } = body;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(sseChunk(event, data));

      try {
        // 1. Fetch career trend reference documents from Vector DB (supplementary context for planner).
        //    JD gap analysis now uses the raw jdText provided directly by the user.
        send("progress", { step: "reference_search" });
        let referenceResults: any[] = [];

        try {
          referenceResults = await searchJdFromMcp(
            `${targetRole} ${targetCompany}`.trim(),
            { doc_type: "reference" }
          );
        } catch (mcpErr: any) {
          console.warn("[/api/analyze] Reference search failed — proceeding without supplementary context:", mcpErr?.message ?? mcpErr);
          referenceResults = [];
        }

        send("progress", { step: "reference_search_done" });

        // 2. Run agent pipeline (gap analysis uses jdText directly; planner uses referenceResults)
        const { runCareerAnalysis } = await import(
          "@readmycareer/agents/orchestrator"
        ) as {
          runCareerAnalysis: (
            resumeJson: unknown,
            jdText: string,
            referenceResults: unknown[],
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
          referenceResults,
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
