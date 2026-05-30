// ─── RAG Pipeline ─────────────────────────────────────────────────────────────
// Uses Pinecone INTEGRATED inference: text records are upserted as-is and Pinecone
// embeds them server-side with the index's hosted model (llama-text-embed-v2).
// Supports hybrid search (semantic + client-side BM25 RRF) and Pinecone reranking.

import { Pinecone } from "@pinecone-database/pinecone";

// ── Index contract ───────────────────────────────────────────────────────────
// The Pinecone index referenced by PINECONE_INDEX_NAME is an INTEGRATED-inference
// index (created "for a model", e.g. llama-text-embed-v2). Such indexes embed text
// server-side, so records are written with `upsertRecords()` (NOT `upsert()` with
// client vectors) and searched with `searchRecords({ query: { inputs: { text } } })`.
//
// Upserting client-supplied vectors into an integrated index is rejected, which is
// why the previous Gemini-embedding code left the index empty (record count 0).
//
// TEXT_FIELD must match the index's field map (the field Pinecone embeds). The
// `readmycareer` integrated index maps text -> "text" (verified via describeIndex),
// so that is the default. Override with PINECONE_TEXT_FIELD for a different index.
const TEXT_FIELD = process.env.PINECONE_TEXT_FIELD ?? "text";

// Hosted reranking model paired with searchRecords. Override via PINECONE_RERANK_MODEL.
const RERANK_MODEL = process.env.PINECONE_RERANK_MODEL ?? "bge-reranker-v2-m3";

// Pinecone caps integrated upsertRecords at 96 records per request.
const UPSERT_BATCH = 96;

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

let _pc: Pinecone | null = null;

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
      RERANK_MODEL,
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
 * Upserts JdDocuments into the integrated Pinecone index in batches.
 *
 * The text lives in TEXT_FIELD, which Pinecone embeds server-side (no client-side
 * embedding). All other fields are stored as record metadata. Re-syncing the same
 * doc_id overwrites the existing record, so Google Drive re-runs stay idempotent.
 */
export async function upsertDocuments(docs: JdDocument[]): Promise<void> {
  if (docs.length === 0) return;

  const index = getPineconeIndex();

  for (let i = 0; i < docs.length; i += UPSERT_BATCH) {
    const batch = docs.slice(i, i + UPSERT_BATCH);

    const records = batch.map((doc) => ({
      // Spread caller metadata first so the canonical fields below always win.
      ...(doc.metadata ?? {}),
      id: doc.doc_id,
      [TEXT_FIELD]: doc.text,
      doc_type: doc.doc_type,
      title: doc.title,
      chunk_index: doc.chunk_index,
      tags: (doc.tags ?? []).join(","),
    }));

    await index.upsertRecords(
      records as Parameters<typeof index.upsertRecords>[0]
    );
  }
}

/**
 * Semantic search against the integrated index (internal use only).
 * Pinecone embeds the query text server-side with the index's hosted model.
 */
async function _integratedSearch(
  query: string,
  fetchK: number,
  filter?: { doc_type?: "jd" | "reference" | "all"; tags?: string[] }
): Promise<RagSearchResult[]> {
  const index = getPineconeIndex();

  const pineconeFilter: Record<string, unknown> = {};
  if (filter?.doc_type && filter.doc_type !== "all") {
    pineconeFilter["doc_type"] = { $eq: filter.doc_type };
  }

  const response = await index.searchRecords({
    query: {
      topK: fetchK,
      inputs: { text: query },
      filter: Object.keys(pineconeFilter).length > 0 ? pineconeFilter : undefined,
    },
    fields: [TEXT_FIELD, "doc_type", "title", "chunk_index", "tags"],
  });

  const hits = response.result?.hits ?? [];
  return hits.map((hit) => {
    const f = (hit.fields ?? {}) as Record<string, unknown>;
    return {
      doc_id: hit._id,
      doc_type: (f["doc_type"] as "jd" | "reference") ?? "jd",
      title: (f["title"] as string) ?? "",
      chunk_index: Number(f["chunk_index"] ?? 0),
      score: hit._score ?? 0,
      text: (f[TEXT_FIELD] as string) ?? "",
      metadata: f,
    };
  });
}

/**
 * Searches the integrated Pinecone index for a natural language query.
 *
 * Defaults: hybrid search (semantic + BM25 RRF) + Pinecone Reranking both enabled
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

  // Pinecone embeds the query server-side (integrated inference).
  const candidates = await _integratedSearch(query, fetchK, filter);

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