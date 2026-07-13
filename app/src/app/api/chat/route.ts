import { NextRequest } from "next/server";
import { streamText, convertToModelMessages, stepCountIs, tool, type UIMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { Pinecone } from "@pinecone-database/pinecone";
import { z } from "zod";
import { GEMINI_MODEL } from "@readmycareer/agents/models";
import { searchJdFromGoogle } from "@/lib/externalJdSearch";

// role is restricted to user/assistant (excludes "system", which UIMessage otherwise allows) —
// the client never sends system messages, and accepting one here would let a crafted request
// inject a second, client-controlled system-priority instruction alongside ours.
const chatUIMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.unknown()),
});

const ChatSchema = z.object({
  messages: z.array(chatUIMessageSchema).min(1),
  targetRole: z.string().max(200).nullish(),
  targetCompany: z.string().max(200).nullish(),
  sessionContext: z
    .object({
      gap_analysis: z.record(z.unknown()).nullish(),
      career_plan: z.record(z.unknown()).nullish(),
      target_role: z.string().max(200).nullish(),
      target_company: z.string().max(200).nullish(),
    })
    .optional(),
});

// useChat resends the full message history every turn (no server-side session state),
// so the cap has to fit a whole conversation rather than a single message.
const MAX_BODY_BYTES = 400_000; // 400 KB

/** Hybrid fallback threshold for Chat RAG */
const CHAT_RAG_FALLBACK_THRESHOLD = 1; // Fall back to Google Search when Vector DB returns fewer than this many results

// ── Lazy-initialized clients ──────────────────────────────────────────────────

let _pc: Pinecone | null = null;

function getPineconeClient(): Pinecone {
  if (!_pc) {
    _pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  }
  return _pc;
}

function getPineconeIndex() {
  return getPineconeClient().index(process.env.PINECONE_INDEX_NAME!);
}

// Field Pinecone embeds for the integrated index. Must match the career-knowledge-base
// sync (TEXT_FIELD there) and the index field map (readmycareer maps text -> "text").
// Override via PINECONE_TEXT_FIELD.
const TEXT_FIELD = process.env.PINECONE_TEXT_FIELD ?? "text";

// ── BM25 helpers ──────────────────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[\s\W]+/).filter((t) => t.length > 1);
}

function bm25Score(queryTokens: string[], docTokens: string[], avgDocLen: number): number {
  const docLen = docTokens.length;
  const tf: Record<string, number> = {};
  for (const t of docTokens) tf[t] = (tf[t] ?? 0) + 1;
  let score = 0;
  for (const term of queryTokens) {
    const f = tf[term] ?? 0;
    if (f === 0) continue;
    score += (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen)));
  }
  return score;
}

// ── RAG search with hybrid + reranking ───────────────────────────────────────

async function searchRag(query: string, topK = 5): Promise<string[]> {
  const CANDIDATE_MULTIPLIER = 3;
  const fetchK = topK * CANDIDATE_MULTIPLIER;

  const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms / 1000}s)`)), ms)
      ),
    ]);

  // 1. Semantic search via Pinecone integrated inference (query embedded server-side)
  const index = getPineconeIndex();
  const searchResp = await withTimeout(
    index.searchRecords({
      query: { topK: fetchK, inputs: { text: query.replace(/\n+/g, " ") } },
      fields: [TEXT_FIELD],
    }),
    10_000,
    "Pinecone 검색"
  );

  const candidates = (searchResp.result?.hits ?? [])
    .map((h) => ({ id: h._id, text: String((h.fields as Record<string, unknown>)?.[TEXT_FIELD] ?? "") }))
    .filter((c) => c.text);
  if (candidates.length === 0) return [];

  // 2. BM25 scoring
  const queryTokens = tokenize(query);
  const docTokensList = candidates.map((m) => tokenize(m.text));
  const avgDocLen = docTokensList.reduce((s, d) => s + d.length, 0) / docTokensList.length || 1;
  const bm25Scores = candidates.map((m, i) => ({
    id: m.id,
    score: bm25Score(queryTokens, docTokensList[i], avgDocLen),
  }));

  // 4. RRF fusion (Dense rank + BM25 rank)
  const K_RRF = 60;
  const denseRankMap = new Map(candidates.map((m, i) => [m.id, i + 1]));
  const bm25RankMap = new Map(
    [...bm25Scores].sort((a, b) => b.score - a.score).map((s, i) => [s.id, i + 1])
  );
  const rrfScores = new Map<string, number>();
  Array.from(denseRankMap.entries()).forEach(([id, rank]) => {
    rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (K_RRF + rank));
  });
  Array.from(bm25RankMap.entries()).forEach(([id, rank]) => {
    rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (K_RRF + rank));
  });

  const topIds = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => id);

  const candidateMap = new Map(candidates.map((m) => [m.id, m]));
  let topCandidates = topIds.map((id) => candidateMap.get(id)!);

  // 5. Pinecone Inference Reranking
  try {
    const pc = getPineconeClient();
    const rerankResult = await withTimeout(
      pc.inference.rerank(
        "bge-reranker-v2-m3",
        query,
        topCandidates.map((m) => ({ text: m.text })),
        { topN: topK, returnDocuments: false }
      ),
      8_000,
      "Pinecone 리랭킹"
    );
    topCandidates = rerankResult.data.map((item) => topCandidates[item.index]);
  } catch (err) {
    console.warn("[RAG] Reranking 실패, RRF 순서 사용:", err);
  }

  return topCandidates
    .map((m) => m.text)
    .filter(Boolean);
}

function toFriendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "알 수 없는 오류";
  const isQuota =
    raw.includes("429") ||
    raw.toLowerCase().includes("quota") ||
    raw.toLowerCase().includes("too many requests");
  const isServerBusy =
    raw.includes("503") ||
    raw.toLowerCase().includes("service unavailable") ||
    raw.toLowerCase().includes("high demand");
  if (isQuota) return "현재 AI 서비스 일일 사용량이 초과되었습니다. 내일 다시 시도해주세요.";
  if (isServerBusy) return "AI 서비스가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.";
  return "AI 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

export async function POST(req: NextRequest) {
  // Payload size limit
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(
      JSON.stringify({ error: "요청 데이터가 너무 큽니다." }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }

  const acceptLanguage = req.headers.get("accept-language");
  const locale = (() => {
    if (!acceptLanguage) return "ko" as const;
    const langs = acceptLanguage.split(",").map((l) => l.split(";")[0].trim().toLowerCase());
    for (const lang of langs) {
      if (lang.startsWith("ko")) return "ko" as const;
      if (lang.startsWith("en")) return "en" as const;
    }
    return "ko" as const;
  })();

  let parsed: z.infer<typeof ChatSchema>;
  try {
    parsed = ChatSchema.parse(await req.json());
  } catch {
    return new Response(
      JSON.stringify({ error: "입력값이 올바르지 않습니다." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { messages, targetRole, targetCompany, sessionContext } = parsed;

  // Top-level body fields take precedence; fall back to sessionContext if absent
  const effectiveTargetRole =
    targetRole ||
    sessionContext?.target_role ||
    (sessionContext?.gap_analysis?.["target_role"] as string | undefined) ||
    "";
  const effectiveTargetCompany =
    targetCompany || sessionContext?.target_company || "";

  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY! });

  const systemPrompt = `당신은 readmycareer.com의 커리어 코칭 AI입니다.
사용자의 개인 커리어 데이터와 JD 데이터베이스를 기반으로 구체적이고 실행 가능한 조언을 제공합니다.

## 사용자의 목표 (모든 답변은 이 목표 맥락에서 작성)
- target_company: ${effectiveTargetCompany || "(미지정)"}
- target_role: ${effectiveTargetRole || "(미지정)"}

## 사용자 컨텍스트
${sessionContext?.gap_analysis ? `갭 분석 결과: ${JSON.stringify(sessionContext.gap_analysis, null, 2).slice(0, 2000)}` : "갭 분석 없음"}
${sessionContext?.career_plan ? `커리어 플랜: ${JSON.stringify(sessionContext.career_plan, null, 2).slice(0, 2000)}` : "커리어 플랜 없음"}

## 도구 사용 지침
특정 채용공고(JD)나 업계 레퍼런스 자료가 필요한 질문에는 search_reference 도구를 호출해 관련 자료를 찾은 후 답변하세요.
확실히 알고 있는 일반 커리어 조언에는 도구 호출 없이 바로 답변해도 됩니다.

위 컨텍스트를 바탕으로 사용자 질문에 답변하세요. 마크다운 형식으로 답변해도 됩니다.
⚠️ 답변 시 target_company/target_role을 절대 임의로 변경하지 마세요.
${locale === "en" ? "⚠️ LANGUAGE: Always respond in English regardless of the language of the context or question." : "⚠️ LANGUAGE: 항상 한국어로 답변하세요. JD나 질문이 영어로 작성되어 있어도 반드시 한국어로 답변하세요."}`;

  const searchReferenceTool = tool({
    description:
      "채용공고(JD) 및 업계 레퍼런스 자료를 검색합니다 (Vector DB + Google Search 하이브리드). 특정 회사/직무의 요구사항이나 트렌드에 대한 질문에 사용하세요.",
    inputSchema: z.object({
      query: z.string().describe("검색할 질의 (예: '백엔드 시니어 요구 역량')"),
    }),
    execute: async ({ query }) => {
      // Prepend target company/role context to the query to narrow the search scope.
      const scopedQuery = [effectiveTargetCompany, effectiveTargetRole, query]
        .filter(Boolean)
        .join(" ");

      let contexts: string[] = [];
      let ragQuotaExceeded = false;
      try {
        contexts = await searchRag(scopedQuery, 5);
      } catch (ragErr: any) {
        const msg: string = ragErr?.message ?? "";
        if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
          ragQuotaExceeded = true;
          console.warn("[/api/chat] RAG 임베딩 API 할당량 초과 — 폴백 생략");
        } else {
          console.warn("[/api/chat] Vector DB RAG 실패:", msg);
        }
      }

      if (
        !ragQuotaExceeded &&
        contexts.length < CHAT_RAG_FALLBACK_THRESHOLD &&
        effectiveTargetRole &&
        effectiveTargetCompany
      ) {
        console.log("[/api/chat] 벡터DB 결과 부족 — Google Search 폴백");
        try {
          const externalResults = await Promise.race([
            searchJdFromGoogle(effectiveTargetRole, effectiveTargetCompany),
            new Promise<[]>((resolve) => setTimeout(() => resolve([]), 25_000)),
          ]);
          contexts = [...contexts, ...externalResults.map((r) => r.text)];
        } catch (fallbackErr: any) {
          console.warn("[/api/chat] Google Search 폴백 실패:", fallbackErr?.message ?? fallbackErr);
        }
      }

      return {
        results: contexts.map((text) => ({
          title: effectiveTargetCompany || effectiveTargetRole || "Reference",
          snippet: text.slice(0, 400),
        })),
      };
    },
  });

  try {
    const modelMessages = await convertToModelMessages(messages as UIMessage[]);

    const result = streamText({
      model: google(GEMINI_MODEL),
      system: systemPrompt,
      messages: modelMessages,
      tools: { search_reference: searchReferenceTool },
      // Allow one tool round-trip (search) plus the final answer step.
      stopWhen: stepCountIs(4),
      timeout: { totalMs: 45_000, chunkMs: 15_000 },
      providerOptions: {
        google: {
          thinkingConfig: { includeThoughts: true, thinkingBudget: 1024 },
        },
      },
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages as UIMessage[],
      onError: toFriendlyErrorMessage,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: toFriendlyErrorMessage(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
