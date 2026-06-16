// Faithful TypeScript reimplementation of the four RAGAS 0.1.x retrieval-quality
// metrics the Python harness used (via the `ragas` library, which has no JS port):
//
//   - faithfulness      : decompose the answer into standalone statements, then NLI
//                         each against the retrieved context; score = supported / total.
//   - answer_relevancy  : generate N questions from the answer, embed them and the
//                         original question, take mean cosine similarity; zero it out
//                         if the answer is noncommittal ("I don't know").
//   - context_precision : per-context usefulness verdict vs. ground_truth, then the
//                         mean of precision@k over the relevant positions (average precision).
//   - context_recall    : split ground_truth into sentences, classify each as
//                         attributable to the context; score = attributed / total.
//
// Each metric is computed per row and averaged across rows (as ragas.evaluate does).
// The algorithms mirror RAGAS semantics; the prompts are independent but request the
// same judgements. NaN is returned when a metric is undefined for a row (e.g. no
// statements), and NaN rows are dropped from the average — matching ragas.

import { GeminiClient, cosineSimilarity } from "./gemini";

export interface RagaRow {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth: string;
}

const NO_CONTEXT_SENTINEL = "No context";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function toVerdict(v: unknown): number {
  // Accept 1/0, true/false, "1"/"0".
  if (typeof v === "number") return v >= 0.5 ? 1 : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return v.trim() === "1" || v.trim().toLowerCase() === "true" ? 1 : 0;
  return 0;
}

function joinContexts(contexts: string[]): string {
  return contexts.join("\n---\n");
}

function hasUsableContext(contexts: string[]): boolean {
  return contexts.length > 0 && !(contexts.length === 1 && contexts[0] === NO_CONTEXT_SENTINEL);
}

// ── Faithfulness ────────────────────────────────────────────────────────────────

export async function faithfulness(client: GeminiClient, row: RagaRow): Promise<number> {
  if (!row.answer.trim()) return NaN;

  const stmtPrompt = `Break the ANSWER into a list of fully understandable, standalone statements.
Resolve every pronoun to the entity it refers to. Do not add information not in the answer.

QUESTION: ${row.question}
ANSWER: ${row.answer}

Output ONLY JSON: {"statements": ["statement 1", "statement 2"]}`;

  const stmtParsed = asObj(await client.generateJson(stmtPrompt, { maxOutputTokens: 1024 }));
  const statements = asArr(stmtParsed.statements).map((s) => String(s)).filter((s) => s.trim());
  if (statements.length === 0) return NaN;

  const context = hasUsableContext(row.contexts) ? joinContexts(row.contexts) : "";
  const numbered = statements.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const nliPrompt = `For each numbered statement, decide whether it can be directly inferred from the CONTEXT.
Use verdict 1 if the statement is supported by the context, 0 otherwise.

CONTEXT:
${context}

STATEMENTS:
${numbered}

Output ONLY JSON: {"verdicts": [{"statement": "...", "verdict": 1}, ...]} with one entry per statement, in order.`;

  const nliParsed = asObj(await client.generateJson(nliPrompt, { maxOutputTokens: 1024 }));
  const verdicts = asArr(nliParsed.verdicts).map((v) => toVerdict(asObj(v).verdict));
  // An empty/failed NLI response yields no scorable row — return NaN so nanMean drops it,
  // matching ragas's NaN-drop semantics (rather than counting it as a faithful-zero row).
  if (verdicts.length === 0) return NaN;
  const supported = verdicts.reduce((a, b) => a + b, 0);
  return supported / statements.length;
}

// ── Answer relevancy ─────────────────────────────────────────────────────────────

const ANSWER_RELEVANCY_N = 3;

export async function answerRelevancy(client: GeminiClient, row: RagaRow): Promise<number> {
  if (!row.answer.trim()) return NaN;

  const context = hasUsableContext(row.contexts) ? joinContexts(row.contexts) : "";
  const genPrompt = `Generate ${ANSWER_RELEVANCY_N} different questions that the ANSWER below would correctly answer.
Also decide if the answer is "noncommittal" — evasive, vague, or saying it cannot answer
(e.g. "I don't know", "the context does not provide..."). noncommittal = 1 if so, else 0.

ANSWER: ${row.answer}
CONTEXT:
${context}

Output ONLY JSON: {"questions": ["q1", "q2", "q3"], "noncommittal": 0}`;

  const parsed = asObj(await client.generateJson(genPrompt, { maxOutputTokens: 512 }));
  const noncommittal = toVerdict(parsed.noncommittal);
  if (noncommittal === 1) return 0.0;

  const questions = asArr(parsed.questions).map((q) => String(q)).filter((q) => q.trim());
  if (questions.length === 0) return 0.0;

  const originalVec = await client.embed(row.question);
  const sims: number[] = [];
  for (const q of questions) {
    const vec = await client.embed(q);
    sims.push(cosineSimilarity(originalVec, vec));
  }
  return sims.reduce((a, b) => a + b, 0) / sims.length;
}

// ── Context precision ────────────────────────────────────────────────────────────

export async function contextPrecision(client: GeminiClient, row: RagaRow): Promise<number> {
  if (!hasUsableContext(row.contexts)) return 0.0;

  const verdicts: number[] = [];
  for (const ctx of row.contexts) {
    const prompt = `Decide whether the CONTEXT below was useful in arriving at the given ANSWER
for the QUESTION. Use verdict 1 if it contains information that helps produce the answer, else 0.

QUESTION: ${row.question}
ANSWER: ${row.ground_truth}
CONTEXT: ${ctx}

Output ONLY JSON: {"verdict": 1, "reason": "one sentence"}`;
    const parsed = asObj(await client.generateJson(prompt, { maxOutputTokens: 256 }));
    verdicts.push(toVerdict(parsed.verdict));
  }

  // Average precision: mean of precision@k taken at each relevant position.
  const denominator = verdicts.reduce((a, b) => a + b, 0);
  if (denominator === 0) return 0.0;
  let relevantSoFar = 0;
  let numerator = 0;
  for (let k = 0; k < verdicts.length; k++) {
    if (verdicts[k] === 1) {
      relevantSoFar += 1;
      numerator += relevantSoFar / (k + 1); // precision@(k+1) at this relevant hit
    }
  }
  return numerator / denominator;
}

// ── Context recall ───────────────────────────────────────────────────────────────

export async function contextRecall(client: GeminiClient, row: RagaRow): Promise<number> {
  if (!row.ground_truth.trim()) return NaN;
  const context = hasUsableContext(row.contexts) ? joinContexts(row.contexts) : "";

  const prompt = `Split the ANSWER (ground truth) into individual sentences. For each sentence,
classify whether it can be attributed to the CONTEXT (attributed 1) or not (0).

CONTEXT:
${context}

ANSWER: ${row.ground_truth}

Output ONLY JSON: {"classifications": [{"statement": "...", "attributed": 1}, ...]}`;

  const parsed = asObj(await client.generateJson(prompt, { maxOutputTokens: 1024 }));
  const classifications = asArr(parsed.classifications);
  if (classifications.length === 0) return NaN;
  const attributed = classifications.reduce<number>(
    (a, c) => a + toVerdict(asObj(c).attributed),
    0
  );
  return attributed / classifications.length;
}

// ── Aggregate ────────────────────────────────────────────────────────────────────

export interface RagaScores {
  faithfulness: number;
  answer_relevancy: number;
  context_precision: number;
  context_recall: number;
}

/** Scores one row across all four metrics. */
export async function scoreRow(client: GeminiClient, row: RagaRow): Promise<RagaScores> {
  const [f, ar, cp, cr] = await Promise.all([
    safe(() => faithfulness(client, row)),
    safe(() => answerRelevancy(client, row)),
    safe(() => contextPrecision(client, row)),
    safe(() => contextRecall(client, row)),
  ]);
  return { faithfulness: f, answer_relevancy: ar, context_precision: cp, context_recall: cr };
}

async function safe(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch (exc) {
    console.log(`  [WARN] RAGAS metric error: ${(exc as Error).message}`);
    return NaN;
  }
}

/** Mean over the non-NaN values (ragas drops NaN rows from the per-metric average). */
export function nanMean(values: number[]): number {
  const present = values.filter((v) => !Number.isNaN(v));
  if (present.length === 0) return NaN;
  return present.reduce((a, b) => a + b, 0) / present.length;
}
