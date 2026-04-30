import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";
import { z } from "zod";
import { searchJdFromGoogle } from "@/lib/externalJdSearch";

const ChatSchema = z.object({
  message: z.string().min(1).max(5000),
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

const MAX_BODY_BYTES = 200_000; // 200 KB (no resume_json)

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

  // 1. Embed query
  const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const embedModel = genai.getGenerativeModel({ model: "gemini-embedding-001" });
  const embedResult = await withTimeout(
    embedModel.embedContent(query.replace(/\n+/g, " ")),
    10_000,
    "임베딩"
  );
  const embedding = embedResult.embedding.values;

  // 2. Dense vector search (fetch more candidates for hybrid)
  const index = getPineconeIndex();
  const denseResults = await withTimeout(
    index.query({ vector: embedding, topK: fetchK, includeMetadata: true }),
    10_000,
    "Pinecone 검색"
  );

  const candidates = (denseResults.matches ?? []).filter((m) => m.metadata?.["text"]);
  if (candidates.length === 0) return [];

  // 3. BM25 scoring
  const queryTokens = tokenize(query);
  const docTokensList = candidates.map((m) => tokenize((m.metadata!["text"] as string) ?? ""));
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
        topCandidates.map((m) => ({ text: (m.metadata!["text"] as string) ?? "" })),
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
    .map((m) => (m.metadata?.["text"] as string) ?? "")
    .filter(Boolean);
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

  const { message, targetRole, targetCompany, sessionContext } = parsed;

  // Top-level body fields take precedence; fall back to sessionContext if absent
  const effectiveTargetRole =
    targetRole ||
    sessionContext?.target_role ||
    (sessionContext?.gap_analysis?.["target_role"] as string | undefined) ||
    "";
  const effectiveTargetCompany =
    targetCompany || sessionContext?.target_company || "";

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  // Execute streaming asynchronously
  (async () => {
    try {
      // RAG hybrid search: Vector DB → Google Search fallback when results are insufficient.
      // Prepend target company/role context to the query to narrow the search scope.
      const scopedQuery = [effectiveTargetCompany, effectiveTargetRole, message]
        .filter(Boolean)
        .join(" ");

      let ragContexts: string[] = [];
      let ragQuotaExceeded = false;
      try {
        ragContexts = await searchRag(scopedQuery, 5);
      } catch (ragErr: any) {
        const msg: string = ragErr?.message ?? "";
        if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
          ragQuotaExceeded = true;
          console.warn("[/api/chat] RAG 임베딩 API 할당량 초과 — 폴백 생략");
        } else {
          console.warn("[/api/chat] Vector DB RAG 실패:", msg);
        }
        ragContexts = [];
      }

      if (
        !ragQuotaExceeded &&
        ragContexts.length < CHAT_RAG_FALLBACK_THRESHOLD &&
        effectiveTargetRole &&
        effectiveTargetCompany
      ) {
        console.log("[/api/chat] 벡터DB 결과 부족 — Google Search 폴백");
        try {
          const externalResults = await Promise.race([
            searchJdFromGoogle(effectiveTargetRole, effectiveTargetCompany),
            new Promise<[]>((resolve) => setTimeout(() => resolve([]), 25_000)),
          ]);
          ragContexts = [
            ...ragContexts,
            ...externalResults.map((r) => r.text),
          ];
        } catch (fallbackErr: any) {
          const msg: string = fallbackErr?.message ?? "";
          if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
            console.warn("[/api/chat] Google Search 폴백 할당량 초과 — 건너뜀");
            throw new Error(
              "현재 AI 서비스 일일 사용량이 초과되었습니다. 내일 다시 시도해주세요."
            );
          }
          console.warn("[/api/chat] Google Search 폴백 실패:", msg);
        }
      }

      const ragText = ragContexts.join("\n---\n");

      // Gemini Flash streaming
      const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
      const model = genai.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

      const systemPrompt = `당신은 readmycareer.com의 커리어 코칭 AI입니다.
사용자의 개인 커리어 데이터와 JD 데이터베이스를 기반으로 구체적이고 실행 가능한 조언을 제공합니다.

## 사용자의 목표 (모든 답변은 이 목표 맥락에서 작성)
- target_company: ${effectiveTargetCompany || "(미지정)"}
- target_role: ${effectiveTargetRole || "(미지정)"}

## 사용자 컨텍스트
${sessionContext?.gap_analysis ? `갭 분석 결과: ${JSON.stringify(sessionContext.gap_analysis, null, 2).slice(0, 2000)}` : "갭 분석 없음"}
${sessionContext?.career_plan ? `커리어 플랜: ${JSON.stringify(sessionContext.career_plan, null, 2).slice(0, 2000)}` : "커리어 플랜 없음"}

## 관련 JD/레퍼런스 자료 (RAG — Vector DB + Google Search 하이브리드)
${ragText || "관련 자료 없음"}

위 컨텍스트를 바탕으로 사용자 질문에 답변하세요. 마크다운 형식으로 답변해도 됩니다.
⚠️ 답변 시 target_company/target_role을 절대 임의로 변경하지 마세요.
${locale === "en" ? "⚠️ LANGUAGE: Always respond in English regardless of the language of the context or question." : "⚠️ LANGUAGE: 항상 한국어로 답변하세요. JD나 질문이 영어로 작성되어 있어도 반드시 한국어로 답변하세요."}`;

      const GENERATION_TIMEOUT = 30_000;
      const result = await Promise.race([
        model.generateContentStream([
          { text: systemPrompt },
          { text: `사용자 질문: ${message}` },
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("응답 생성 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.")),
            GENERATION_TIMEOUT
          )
        ),
      ]);

      const CHUNK_TIMEOUT = 15_000;
      const streamIter = result.stream[Symbol.asyncIterator]();
      while (true) {
        let chunkTimer: ReturnType<typeof setTimeout>;
        const next = await Promise.race([
          streamIter.next().then((r) => { clearTimeout(chunkTimer!); return r; }),
          new Promise<never>((_, reject) => {
            chunkTimer = setTimeout(
              () => reject(new Error("스트림 응답이 지연되고 있습니다. 다시 시도해주세요.")),
              CHUNK_TIMEOUT
            );
          }),
        ]);
        if (next.done) break;
        const text = next.value.text();
        if (text) {
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
          );
        }
      }

      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (err) {
      const raw = err instanceof Error ? err.message : "알 수 없는 오류";
      const isQuota =
        raw.includes("429") ||
        raw.toLowerCase().includes("quota") ||
        raw.toLowerCase().includes("too many requests");
      const errMsg = isQuota
        ? "현재 AI 서비스 일일 사용량이 초과되었습니다. 내일 다시 시도해주세요."
        : raw;
      await writer.write(
        encoder.encode(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
      );
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
