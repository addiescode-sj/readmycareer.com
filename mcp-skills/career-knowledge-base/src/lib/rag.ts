// ─── RAG Pipeline ─────────────────────────────────────────────────────────────
// Generates embeddings with Gemini gemini-embedding-001 and stores/queries them in Pinecone
// Supports hybrid search (Dense + BM25 RRF) and Pinecone Inference Reranking

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Pinecone } from "@pinecone-database/pinecone";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JdDocument {
  doc_id: string;
  doc_type: "jd" | "reference";
  title: string;
  chunk_index: number;
  text: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface RagSearchResult {
  doc_id: string;
  doc_type: "jd" | "reference";
  title: string;
  chunk_index: number;
  score: number;
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * Options controlling similaritySearch behavior
 * - hybrid: Dense + BM25 RRF hybrid search (default true)
 * - rerank: Apply Pinecone inference reranking (default true)
 * - candidateMultiplier: Candidate multiplier for hybrid mode (default 3)
 */
export interface SearchOptions {
  hybrid?: boolean;
  rerank?: boolean;
  candidateMultiplier?: number;
}

// ── Lazy-initialized clients ──────────────────────────────────────────────────

let _genai: GoogleGenerativeAI | null = null;
let _pc: Pinecone | null = null;

function getEmbeddingModel() {
  if (!_genai) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is not set.");
    _genai = new GoogleGenerativeAI(apiKey);
  }
  return _genai.getGenerativeModel({ model: "gemini-embedding-001" });
}

function getPineconeClient(): Pinecone {
  if (!_pc) {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) throw new Error("PINECONE_API_KEY environment variable is not set.");
    _pc = new Pinecone({ apiKey });
  }
  return _pc;
}

function getPineconeIndex() {
  const indexName = process.env.PINECONE_INDEX_NAME;
  if (!indexName) throw new Error("PINECONE_INDEX_NAME environment variable is not set.");
  return getPineconeClient().index(indexName);
}

// ── BM25 helpers ──────────────────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
  // Handles both English and Korean: splits on whitespace/special characters, removes tokens of length <= 1
  return text.toLowerCase().split(/[\s\W]+/).filter((t) => t.length > 1);
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  avgDocLen: number
): number {
  const docLen = docTokens.length;
  const tf: Record<string, number> = {};
  for (const t of docTokens) tf[t] = (tf[t] ?? 0) + 1;

  let score = 0;
  for (const term of queryTokens) {
    const f = tf[term] ?? 0;
    if (f === 0) continue;
    const numerator = f * (BM25_K1 + 1);
    const denominator =
      f + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen));
    score += numerator / denominator;
  }
  return score;
}

/**
 * Reciprocal Rank Fusion: merges multiple ranked lists into one
 * score = Σ 1 / (k + rank_i)
 */
function rrfFusion(
  rankMaps: Map<string, number>[],
  k = 60
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const rankMap of rankMaps) {
    for (const [id, rank] of rankMap) {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank));
    }
  }
  return fused;
}

// ── Reranking ─────────────────────────────────────────────────────────────────

/**
 * Reranks results using the Pinecone Inference API (bge-reranker-v2-m3)
 * Returns results in original order on failure (graceful degradation)
 */
async function applyReranking(
  query: string,
  results: RagSearchResult[],
  topN: number
): Promise<RagSearchResult[]> {
  if (results.length <= 1) return results;

  const pc = getPineconeClient();
  try {
    const rerankResult = await pc.inference.rerank(
      "bge-reranker-v2-m3",
      query,
      results.map((r) => ({ id: r.doc_id, text: r.text })),
      { topN, returnDocuments: false }
    );
    return rerankResult.data.map((item) => ({
      ...results[item.index],
      score: item.score,
    }));
  } catch (err) {
    console.warn("[RAG] Reranking failed, using original order:", err);
    return results.slice(0, topN);
  }
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Embeds text using Gemini gemini-embedding-001 (768 dims)
 */
export async function embedText(text: string): Promise<number[]> {
  const model = getEmbeddingModel();
  const result = await model.embedContent(text.replace(/\n+/g, " ").trim());
  return result.embedding.values;
}

/**
 * Embeds an array of JdDocuments and upserts them into Pinecone (in batches of 100)
 * - Overwrites existing entries with the same doc_id (supports Google Drive re-sync)
 */
export async function upsertDocuments(docs: JdDocument[]): Promise<void> {
  if (docs.length === 0) return;

  const index = getPineconeIndex();
  const BATCH = 100;

  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const embeddings = await Promise.all(batch.map((d) => embedText(d.text)));

    const vectors = batch.map((doc, j) => ({
      id: doc.doc_id,
      values: embeddings[j],
      metadata: {
        doc_type: doc.doc_type,
        title: doc.title,
        chunk_index: doc.chunk_index,
        text: doc.text,
        tags: (doc.tags ?? []).join(","),
        ...(doc.metadata ?? {}),
      },
    }));

    await index.upsert(vectors);
  }
}

/**
 * Dense vector query (internal use only)
 */
async function _denseQuery(
  queryEmbedding: number[],
  fetchK: number,
  filter?: { doc_type?: "jd" | "reference" | "all"; tags?: string[] }
): Promise<RagSearchResult[]> {
  const index = getPineconeIndex();

  const pineconeFilter: Record<string, unknown> = {};
  if (filter?.doc_type && filter.doc_type !== "all") {
    pineconeFilter["doc_type"] = { $eq: filter.doc_type };
  }

  const response = await index.query({
    vector: queryEmbedding,
    topK: fetchK,
    includeMetadata: true,
    filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
  });

  return (response.matches ?? []).map((match) => {
    const meta = (match.metadata ?? {}) as Record<string, unknown>;
    return {
      doc_id: match.id,
      doc_type: (meta["doc_type"] as "jd" | "reference") ?? "jd",
      title: (meta["title"] as string) ?? "",
      chunk_index: (meta["chunk_index"] as number) ?? 0,
      score: match.score ?? 0,
      text: (meta["text"] as string) ?? "",
      metadata: meta,
    };
  });
}

/**
 * Embeds a natural language query and searches Pinecone
 *
 * Defaults: hybrid search (Dense + BM25 RRF) + Pinecone Reranking both enabled
 *
 * @param query   Search query (JD keywords, skill names, etc.)
 * @param topK    Maximum number of chunks to return (default 5)
 * @param filter  doc_type filter ('jd' | 'reference' | 'all') and tag filter
 * @param options hybrid / rerank toggles and candidate multiplier
 */
export async function similaritySearch(
  query: string,
  topK: number = 5,
  filter?: {
    doc_type?: "jd" | "reference" | "all";
    tags?: string[];
  },
  options: SearchOptions = {}
): Promise<RagSearchResult[]> {
  const {
    hybrid = true,
    rerank = true,
    candidateMultiplier = 3,
  } = options;

  // Fetch more candidates in hybrid mode to enable RRF fusion
  const fetchK = hybrid ? topK * candidateMultiplier : topK;

  const queryEmbedding = await embedText(query);
  const candidates = await _denseQuery(queryEmbedding, fetchK, filter);

  let results: RagSearchResult[];

  if (hybrid && candidates.length > 1) {
    // ── BM25 scoring ──────────────────────────────────────────────────────────
    const queryTokens = tokenize(query);
    const docTokensList = candidates.map((c) => tokenize(c.text));
    const avgDocLen =
      docTokensList.reduce((s, d) => s + d.length, 0) / docTokensList.length || 1;

    const bm25Scores = candidates.map((c, i) => ({
      id: c.doc_id,
      score: bm25Score(queryTokens, docTokensList[i], avgDocLen),
    }));

    // ── RRF fusion ────────────────────────────────────────────────────────────
    // Dense: cosine similarity rank, BM25: keyword matching rank
    const denseRanks = new Map(candidates.map((c, i) => [c.doc_id, i + 1]));
    const bm25Sorted = [...bm25Scores].sort((a, b) => b.score - a.score);
    const bm25Ranks = new Map(bm25Sorted.map((s, i) => [s.id, i + 1]));

    const fused = rrfFusion([denseRanks, bm25Ranks]);
    const topFused = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    const candidateMap = new Map(candidates.map((c) => [c.doc_id, c]));
    results = topFused.map(([id, rrfScore]) => ({
      ...candidateMap.get(id)!,
      score: rrfScore,
    }));
  } else {
    results = candidates.slice(0, topK);
  }

  // ── Pinecone Inference Reranking ───────────────────────────────────────────
  if (rerank && results.length > 1) {
    results = await applyReranking(query, results, topK);
  }

  return results;
}