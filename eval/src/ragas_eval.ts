// RAG Retrieval Quality Evaluation (ragas_eval.ts)
// ================================================
//
// TypeScript port of ragas_eval.py. Runs the RAG pipeline over eval_dataset.json and
// scores it with the four RAGAS metrics (reimplemented in lib/ragas-metrics.ts), plus:
//
//   - Citation Coverage          : share of cases whose answer is backed by >= 1 source.
//   - Grounding / Citation Rate  : for reference-corpus-targeted cases, the share where a
//                                  doc_type == "reference" chunk was actually retrieved.
//
// Retrieval uses the same integrated-inference Pinecone index as the app's
// career-knowledge-base skill: the index embeds text server-side, so queries go through
// searchRecords({ query: { inputs: { text } } }), never a client-supplied vector.
//
// Run: pnpm --filter @readmycareer/eval ragas

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pinecone } from "@pinecone-database/pinecone";
import { loadRootEnv, googleApiKey } from "./lib/env";
import { GeminiClient, RAGAS_LLM_MODEL } from "./lib/gemini";
import { writeCsv } from "./lib/csv";
import { loadDataset, type DatasetCase } from "./lib/schema";
import { scoreRow, nanMean, type RagaRow, type RagaScores } from "./lib/ragas-metrics";

loadRootEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = resolve(HERE, "..");

const GOOGLE_API_KEY = googleApiKey();
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME;

const TEXT_FIELD = process.env.PINECONE_TEXT_FIELD ?? "text";
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE ?? "__default__";

const RAGAS_THRESHOLD = 0.7;
const REF_GROUNDING_THRESHOLD = 0.8;

interface MatchMeta {
  doc_type: string;
  title: string;
  tags: string[];
  score: number | null;
}

interface CitationRecord {
  question: string;
  category: string;
  expected_doc_type: string;
  grounded: boolean | null;
  num_sources: number;
  cited_sources: string;
  tag_overlap: boolean | null;
}

async function retrieveContexts(
  index: ReturnType<Pinecone["index"]>,
  query: string,
  docType: string | undefined,
  topK = 5
): Promise<{ contexts: string[]; matchesMeta: MatchMeta[] }> {
  const filter =
    docType === "jd" || docType === "reference" ? { doc_type: { $eq: docType } } : undefined;

  const response = await index.namespace(PINECONE_NAMESPACE).searchRecords({
    query: { topK, inputs: { text: query }, ...(filter ? { filter } : {}) },
    fields: [TEXT_FIELD, "doc_type", "title", "chunk_index", "tags"],
  });

  const hits = response.result?.hits ?? [];
  const contexts: string[] = [];
  const matchesMeta: MatchMeta[] = [];
  for (const hit of hits) {
    const f = (hit.fields ?? {}) as Record<string, unknown>;
    const text = f[TEXT_FIELD];
    if (typeof text === "string" && text) contexts.push(text);
    const rawTags = f["tags"];
    const tags =
      typeof rawTags === "string"
        ? rawTags.split(",").filter((t) => t)
        : Array.isArray(rawTags)
          ? (rawTags as string[])
          : [];
    // Read the score defensively: the SDK exposes _score, but the Python harness also
    // accepted the SDK-9 serialized `score_` key — mirror that dual-key fallback.
    const anyHit = hit as unknown as { _score?: number; score_?: number; score?: number };
    const rawScore = anyHit._score ?? anyHit.score_ ?? anyHit.score;
    matchesMeta.push({
      doc_type: typeof f["doc_type"] === "string" ? (f["doc_type"] as string) : "",
      title: typeof f["title"] === "string" ? (f["title"] as string) : "",
      tags,
      score: typeof rawScore === "number" ? rawScore : null,
    });
  }
  return { contexts, matchesMeta };
}

async function generateRagAnswer(
  client: GeminiClient,
  question: string,
  contexts: string[]
): Promise<string> {
  if (contexts.length === 0) return "No relevant information found.";
  const contextStr = contexts.join("\n---\n");
  const prompt = `Based on the following context, provide a clear and specific answer to the question.
Do not speculate on information not present in the context.

Context:
${contextStr}

Question: ${question}

Answer:`;
  return (await client.generateText(prompt)).trim();
}

async function buildEvalDataset(
  client: GeminiClient,
  index: ReturnType<Pinecone["index"]>,
  cases: DatasetCase[]
): Promise<{ rows: RagaRow[]; citationRecords: CitationRecord[] }> {
  console.log(`\nProcessing ${cases.length} test cases...`);

  const rows: RagaRow[] = [];
  const citationRecords: CitationRecord[] = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    console.log(`  [${i + 1}/${cases.length}] ${tc.question.slice(0, 50)}...`);

    const { contexts, matchesMeta } = await retrieveContexts(index, tc.contexts_query, tc.doc_type);
    const answer = await generateRagAnswer(client, tc.question, contexts);

    rows.push({
      question: tc.question,
      answer,
      contexts: contexts.length > 0 ? contexts : ["No context"],
      ground_truth: tc.ground_truth,
    });

    const expectedDocType = tc.expected_doc_type;
    const grounded = expectedDocType
      ? matchesMeta.some((m) => m.doc_type === expectedDocType)
      : null;
    const expectedTags = new Set(tc.expected_tags ?? []);
    const retrievedTags = new Set<string>();
    for (const m of matchesMeta) for (const t of m.tags) retrievedTags.add(t);
    const cited = matchesMeta.filter((m) => m.title);
    citationRecords.push({
      question: tc.question.slice(0, 60),
      category: tc.category ?? "",
      expected_doc_type: expectedDocType ?? "",
      grounded,
      num_sources: cited.length,
      cited_sources: cited
        .slice(0, 3)
        .map((m) => `${m.title} [${m.doc_type}|${(m.score ?? 0).toFixed(2)}]`)
        .join("; "),
      tag_overlap:
        expectedTags.size > 0
          ? [...expectedTags].some((t) => retrievedTags.has(t))
          : null,
    });
  }

  return { rows, citationRecords };
}

export async function main(): Promise<number> {
  // ── Environment variable validation ──────────────────────────────────────────
  const missing = Object.entries({
    GOOGLE_API_KEY,
    PINECONE_API_KEY,
    PINECONE_INDEX_NAME,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.log(`Error: The following environment variables are not set: ${missing.join(", ")}`);
    console.log("Please check your root .env file.");
    return 1;
  }

  console.log("=".repeat(60));
  console.log("readmycareer.com — RAGAS Retrieval Quality Evaluation");
  console.log("=".repeat(60));
  console.log(`Initializing clients (RAGAS LLM: ${RAGAS_LLM_MODEL})...`);

  const client = new GeminiClient(GOOGLE_API_KEY);
  const pc = new Pinecone({ apiKey: PINECONE_API_KEY! });
  const index = pc.index(PINECONE_INDEX_NAME!);

  const datasetPath = resolve(EVAL_DIR, "eval_dataset.json");
  const cases = loadDataset(datasetPath);
  const { rows, citationRecords } = await buildEvalDataset(client, index, cases);
  // Reference-targeted cases drive the grounding rate; all cases drive citation coverage.
  const groundingRecords = citationRecords.filter((r) => r.expected_doc_type);

  console.log("\nRunning RAGAS evaluation (using Gemini Flash)...");
  const perRow: RagaScores[] = [];
  for (let i = 0; i < rows.length; i++) {
    perRow.push(await scoreRow(client, rows[i]));
  }

  const aggregate = {
    faithfulness: nanMean(perRow.map((r) => r.faithfulness)),
    answer_relevancy: nanMean(perRow.map((r) => r.answer_relevancy)),
    context_precision: nanMean(perRow.map((r) => r.context_precision)),
    context_recall: nanMean(perRow.map((r) => r.context_recall)),
  };

  // ── Print results ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("Evaluation Results");
  console.log("=".repeat(60));

  const labelled: [string, number][] = [
    ["Faithfulness       (No Hallucination)", aggregate.faithfulness],
    ["Answer Relevancy   (Query Suitability)", aggregate.answer_relevancy],
    ["Context Precision  (No Noise)", aggregate.context_precision],
    ["Context Recall     (No Missing Info)", aggregate.context_recall],
  ];

  let allPass = true;
  for (const [name, score] of labelled) {
    const safeScore = Number.isNaN(score) ? 0 : score;
    const status = safeScore >= RAGAS_THRESHOLD ? "✅ PASS" : "❌ FAIL";
    if (safeScore < RAGAS_THRESHOLD) allPass = false;
    console.log(`  ${name}: ${safeScore.toFixed(4)}  ${status}`);
  }

  // ── Citation coverage (all cases) ──────────────────────────────────────────
  if (citationRecords.length > 0) {
    const cited = citationRecords.filter((r) => r.num_sources > 0).length;
    const citationRate = cited / citationRecords.length;
    console.log(
      `  Citation Coverage  (Answer has a source): ${citationRate.toFixed(4)}  ` +
        `[${cited}/${citationRecords.length} cases]`
    );
  }

  // ── Grounding / Citation Rate (reference-corpus targeted cases only) ────────
  if (groundingRecords.length > 0) {
    const grounded = groundingRecords.filter((r) => r.grounded).length;
    const groundingRate = grounded / groundingRecords.length;
    const status = groundingRate >= REF_GROUNDING_THRESHOLD ? "✅ PASS" : "❌ FAIL";
    if (groundingRate < REF_GROUNDING_THRESHOLD) allPass = false;
    console.log(
      `  Grounding / Citation Rate (Corpus Used): ${groundingRate.toFixed(4)}  ${status}` +
        `  [${grounded}/${groundingRecords.length} cases, threshold ${REF_GROUNDING_THRESHOLD}]`
    );
    for (const r of groundingRecords) {
      const tagNote =
        r.tag_overlap === null ? "" : r.tag_overlap ? " / tags ✓" : " / tags ✗";
      const src = r.cited_sources ? `  ← ${r.cited_sources}` : "";
      console.log(
        `      - ${r.category}: ${r.grounded ? "grounded" : "NOT grounded"}${tagNote}${src}`
      );
    }
  } else {
    console.log("  Grounding / Citation Rate: SKIP (no reference-targeted cases in dataset)");
  }

  console.log("-".repeat(60));
  console.log(
    `  Minimum Threshold: ${RAGAS_THRESHOLD} (RAGAS) / ${REF_GROUNDING_THRESHOLD} (Grounding / Citation)`
  );
  console.log(
    `  Overall Result: ${
      allPass
        ? "✅ ALL PASSED"
        : "❌ PARTIAL FAILURE — Improvements needed in chunking/embedding/prompting/corpus sync"
    }`
  );

  // ── Save CSVs ──────────────────────────────────────────────────────────────
  const ragasPath = resolve(EVAL_DIR, "ragas_results.csv");
  writeCsv(
    ragasPath,
    ["question", "answer", "contexts", "ground_truth", "faithfulness", "answer_relevancy", "context_precision", "context_recall"],
    rows.map((row, i) => ({
      question: row.question,
      answer: row.answer,
      contexts: row.contexts,
      ground_truth: row.ground_truth,
      faithfulness: perRow[i].faithfulness,
      answer_relevancy: perRow[i].answer_relevancy,
      context_precision: perRow[i].context_precision,
      context_recall: perRow[i].context_recall,
    }))
  );
  console.log(`\nDetailed results: ${ragasPath}`);

  const citationPath = resolve(EVAL_DIR, "grounding_results.csv");
  writeCsv(
    citationPath,
    ["question", "category", "expected_doc_type", "grounded", "num_sources", "cited_sources", "tag_overlap"],
    citationRecords as unknown as Record<string, unknown>[]
  );
  console.log(`Grounding / citation records: ${citationPath}`);

  return allPass ? 0 : 1;
}

const INVOKED_DIRECTLY = process.argv[1] === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main().then((code) => process.exit(code));
}
