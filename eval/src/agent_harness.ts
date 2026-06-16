// Agent Output Quality Evaluation Harness (agent_harness.ts)
// =========================================================
//
// TypeScript port of agent_harness.py. Calls POST /api/analyze and measures:
//
//   1. Schema Compliance Rate   — CareerPlanOutput schema compliance (Zod, see lib/schema.ts)
//   2. JSON Parse Error Rate    — rate of responses that never produced a result frame
//   3. Gap Faithfulness         — gap analysis grounded in JD evidence (LLM-as-judge)
//   4. Plan Completeness Rate   — every week has >= 3 todos
//   5. Date Consistency Rate    — weekly date continuity (no gaps)
//   6. p50 / p95 Latency        — percentile response times
//   7. Avg Cost / Request       — estimated cost from config/model-pricing.json (gemini rates)
//   8. Hidden Expectation Coverage — gap analysis surfaces >= 1 implicit expectation (gap area #2)
//   9. Prerequisite Ordering    — foundational gaps not ranked below dependants (gap area #5)
//  10. Contextual Depth (LLM)   — depth beyond keyword matching (gap areas #1/#3/#4)
//
// Run the dev server first (pnpm dev), then: pnpm --filter @readmycareer/eval agent-harness

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { loadRootEnv, googleApiKey } from "./lib/env";
import { PRICE_INPUT_PER_1M, PRICE_OUTPUT_PER_1M } from "./lib/pricing";
import { pyJsonDumps } from "./lib/pyjson";
import { writeCsv, pyFloatRepr } from "./lib/csv";
import { tabulate } from "./lib/table";
import { GeminiClient, JUDGE_MODEL } from "./lib/gemini";
import { callAnalyze } from "./lib/sse";
import { validateCareerPlan, loadFixtures, type Fixture } from "./lib/schema";
import { hasFlag, getOption, getIntOption } from "./lib/args";

loadRootEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = resolve(HERE, "..");
const ROOT_DIR = resolve(HERE, "..", "..");

export { JUDGE_MODEL };
export const GOOGLE_API_KEY = googleApiKey();

// ── Thresholds ────────────────────────────────────────────────────────────────

export const THRESHOLDS: Record<string, number> = {
  schema_compliance_rate: 0.95,
  json_parse_error_rate: 0.05, // must be below this value to PASS
  gap_faithfulness: 0.7,
  plan_completeness_rate: 0.9,
  date_consistency_rate: 1.0,
  p95_latency_s: 30.0, // must be below this value to PASS
  avg_cost_usd: 0.01, // must be below this value to PASS
  match_score_in_range_rate: 0.8,
  category_diversity_rate: 1.0,
  // Content-accuracy vs labeled gaps. Gated leniently; gap_precision is INFO-only.
  gap_recall: 0.5,
  project_portfolio_strength_rate: 0.8,
  project_plan_integration_rate: 0.7,
  // RAG-grounding thresholds (reference corpus must be seeded).
  hidden_expectation_coverage_rate: 0.66,
  prerequisite_ordering_rate: 1.0,
  contextual_depth: 0.7,
};

// Priority ranking weights — lower number == higher priority (ranked earlier).
const PRIORITY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 };

// ── Result shape (keys ordered to match the Python CSV columns) ────────────────

export interface FixtureResult {
  fixture_id: string;
  run_index: number;
  latency_s: number | null;
  status_code: number | null;
  json_parse_ok: boolean;
  schema_valid: boolean;
  schema_errors: string[];
  gap_faithfulness: number | null;
  contextual_depth: number | null;
  gap_recall: number | null;
  gap_precision: number | null;
  plan_completeness: boolean;
  date_consistent: boolean;
  match_score_in_range: boolean;
  category_diversity_ok: boolean;
  project_portfolio_strength: boolean;
  project_plan_integration: boolean;
  hidden_expectation_coverage: boolean;
  prerequisite_ordering_ok: boolean;
  overall_match_score: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  response_json: Record<string, unknown> | null;
  error: string | null;
}

function newResult(fixtureId: string): FixtureResult {
  return {
    fixture_id: fixtureId,
    run_index: 0,
    latency_s: null,
    status_code: null,
    json_parse_ok: false,
    schema_valid: false,
    schema_errors: [],
    gap_faithfulness: null,
    contextual_depth: null,
    gap_recall: null,
    gap_precision: null,
    plan_completeness: false,
    date_consistent: false,
    match_score_in_range: false,
    category_diversity_ok: false,
    project_portfolio_strength: false,
    project_plan_integration: false,
    hidden_expectation_coverage: false,
    prerequisite_ordering_ok: false,
    overall_match_score: null,
    prompt_tokens: 0,
    completion_tokens: 0,
    cost_usd: 0.0,
    response_json: null,
    error: null,
  };
}

// ── Small helpers ──────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Python str(float): always shows a decimal point (30.0 → "30.0", 0.7 → "0.7"). */
function pyFloatStr(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

function parseDate(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const dt = new Date(ms);
  // Reject impossible dates (e.g. 2026-13-40) the way strptime would.
  if (dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return ms;
}

const ONE_DAY = 86_400_000;

// ── Structural validation ─────────────────────────────────────────────────────

function checkPlanCompleteness(data: Json): boolean {
  const weeks = asArr(data.weeks);
  if (weeks.length === 0) return false;
  return weeks.every((w) => asArr(asObj(w).todos).length >= 3);
}

function checkDateConsistency(data: Json): boolean {
  const weeks = asArr(data.weeks);
  if (weeks.length === 0) return false;
  for (let i = 0; i < weeks.length; i++) {
    const dr = asObj(asObj(weeks[i]).date_range);
    const start = parseDate(dr.start);
    const end = parseDate(dr.end);
    if (start === null || end === null) return false;
    if (end < start) return false;
    if (i > 0) {
      const prevEnd = parseDate(asObj(asObj(weeks[i - 1]).date_range).end);
      if (prevEnd === null) return false;
      // Discontinuous if next week start is more than 2 days after previous week end.
      if (start > prevEnd + 2 * ONE_DAY) return false;
    }
  }
  return true;
}

function checkPortfolioStrengths(data: Json): boolean {
  const strengths = asArr(asObj(data.gap_analysis).strengths);
  return strengths.some((s) => asObj(s).category === "portfolio");
}

function checkProjectPlanIntegration(data: Json, fixture: Fixture): boolean {
  const projects = asArr(asObj(asObj(fixture.request).resumeJson).projects);
  const projectNames = projects
    .map((p) => str(asObj(p).name).toLowerCase())
    .filter((n) => n.length > 0);
  if (projectNames.length === 0) return true; // no projects in fixture — skip check

  for (const week of asArr(data.weeks)) {
    for (const todo of asArr(asObj(week).todos)) {
      const t = asObj(todo);
      const text = (str(t.title) + " " + str(t.description)).toLowerCase();
      if (projectNames.some((name) => text.includes(name))) return true;
    }
  }
  return false;
}

// ── RAG-grounding structural checks (fixture-driven; N/A → pass) ────────────────

function checkHiddenExpectations(data: Json, fixture: Fixture): boolean {
  const expected = (fixture.expected_hidden_expectations ?? []).map((e) => e.toLowerCase());
  if (expected.length === 0) return true; // not applicable
  const blob = pyJsonDumps(asObj(data.gap_analysis)).toLowerCase();
  return expected.some((e) => blob.includes(e));
}

function tupleGt(a: [number, number], b: [number, number]): boolean {
  return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
}

function checkPrerequisiteOrdering(data: Json, fixture: Fixture): boolean {
  const pairs = fixture.expected_prerequisite_pairs ?? [];
  if (pairs.length === 0) return true; // not applicable
  const gaps = asArr(asObj(data.gap_analysis).gaps);
  if (gaps.length === 0) return false;

  const rankOf = (term: string): [number, number] | null => {
    const t = term.toLowerCase();
    for (let idx = 0; idx < gaps.length; idx++) {
      const g = asObj(gaps[idx]);
      const text = (str(g.item) + " " + str(g.rationale)).toLowerCase();
      if (text.includes(t)) {
        return [PRIORITY_WEIGHT[str(g.priority)] ?? 1, idx];
      }
    }
    return null;
  };

  for (const [before, after] of pairs) {
    const rb = rankOf(before);
    const ra = rankOf(after);
    if (rb === null || ra === null) continue; // cannot compare — skip
    if (tupleGt(rb, ra)) return false; // prerequisite ranked below dependant → violation
  }
  return true;
}

function scoreGapRecallPrecision(
  data: Json,
  fixture: Fixture
): [number | null, number | null] {
  const expected = (fixture.expected_gaps_keywords ?? []).map((k) => k.toLowerCase());
  if (expected.length === 0) return [null, null];

  const gaps = asArr(asObj(data.gap_analysis).gaps);
  const gapTexts = gaps.map((g) => {
    const o = asObj(g);
    return (str(o.item) + " " + str(o.rationale)).toLowerCase();
  });

  const matchedKeywords = expected.filter((kw) => gapTexts.some((t) => t.includes(kw))).length;
  const recall = matchedKeywords / expected.length;

  let precision: number;
  if (gapTexts.length > 0) {
    const relevant = gapTexts.filter((t) => expected.some((kw) => t.includes(kw))).length;
    precision = relevant / gapTexts.length;
  } else {
    precision = 0.0;
  }
  return [recall, precision];
}

// ── LLM-as-judge ───────────────────────────────────────────────────────────────

function clamp01(score: number): number {
  return Math.max(0.0, Math.min(1.0, score));
}

/** Parses a judge "score" field; a non-numeric/missing score falls back to 0.0,
 * mirroring Python's `float(parsed.get("score", 0.0))` inside its try/except. */
function parseScore(raw: unknown): number {
  const s = Number(raw ?? 0.0);
  return Number.isFinite(s) ? clamp01(s) : 0.0;
}

export async function judgeContextualDepth(
  fixture: Fixture,
  responseJson: Json,
  client: GeminiClient
): Promise<number> {
  const gapAnalysis = asObj(responseJson.gap_analysis);
  if (asArr(gapAnalysis.gaps).length === 0) return 0.0;

  const targetRole = str(asObj(fixture.request).targetRole);
  const targetCompany = str(asObj(fixture.request).targetCompany);
  const analysisText = pyJsonDumps({
    summary: str(gapAnalysis.summary),
    strengths: asArr(gapAnalysis.strengths)
      .slice(0, 6)
      .map((s) => ({ item: str(asObj(s).item), evidence: str(asObj(s).evidence) })),
    gaps: asArr(gapAnalysis.gaps)
      .slice(0, 6)
      .map((g) => ({ item: str(asObj(g).item), rationale: str(asObj(g).rationale) })),
  });

  const prompt = `You are an expert evaluator of AI career-coaching output.

Score, from 0.0 to 1.0, how much CONTEXTUAL DEPTH the gap analysis below shows
BEYOND naive keyword matching, for a candidate targeting the role
"${targetRole}" at "${targetCompany}".

Award credit for any of these (the more, the higher the score):
- Skill transferability / synonym resolution (recognising that existing skills
  map to required ones, e.g. AWS ECS ↔ GCP Cloud Run, Python ↔ Node.js paradigm).
- Company stage & tier fit (startup generalist vs. big-tech specialist expectations).
- Market relevance (prioritising currently in-demand skills, deprioritising legacy).

Scoring guide:
- 1.0: Rich, role/tier-aware reasoning across multiple dimensions above.
- 0.7: Some genuine contextual reasoning, not just restating JD keywords.
- 0.4: Mostly keyword restatement with little added context.
- 0.0: Pure keyword matching, no contextual reasoning.

Output ONLY this JSON: {"score": 0.8, "reasoning": "one sentence"}

[Gap Analysis]
${analysisText}
`;

  try {
    const parsed = asObj(await client.generateJson(prompt, { maxOutputTokens: 256 }));
    return parseScore(parsed.score);
  } catch (exc) {
    console.log(`  [WARN] LLM contextual-depth judge error: ${(exc as Error).message}`);
    return 0.0;
  }
}

export async function judgeGapFaithfulness(
  fixture: Fixture,
  responseJson: Json,
  client: GeminiClient
): Promise<number> {
  const gaps = asArr(asObj(responseJson.gap_analysis).gaps);
  if (gaps.length === 0) return 0.0;

  const jdContext =
    "Core required skills: " + (fixture.expected_gaps_keywords ?? []).join(", ");
  const gapsSample = gaps.slice(0, 6);
  const gapsText = pyJsonDumps(
    gapsSample.map((g) => ({ item: str(asObj(g).item), rationale: str(asObj(g).rationale) }))
  );

  const prompt = `You are an AI output evaluation expert.

Compare the [JD Context] and [Gap Analysis Result] below,
and evaluate how faithfully the gap analysis reflects the JD context on a score of 0.0 to 1.0.

Criteria:
- 1.0: All gap items have a clear association with the JD context and the rationale is specific.
- 0.7: Most gaps are JD-related, but some evidence is ambiguous.
- 0.4: Less than half of the gaps are JD-related.
- 0.0: Most gaps are unrelated to the JD or no rationale is provided.

You must output only in the following JSON format:
{"score": 0.8, "reasoning": "Reason within one sentence"}

[JD Context]
${jdContext}

[Gap Analysis Result]
${gapsText}
`;

  try {
    const parsed = asObj(await client.generateJson(prompt, { maxOutputTokens: 256 }));
    return parseScore(parsed.score);
  } catch (exc) {
    console.log(`  [WARN] LLM judge error: ${(exc as Error).message}`);
    return 0.0;
  }
}

// ── Cost estimation ───────────────────────────────────────────────────────────

export function estimateCost(
  fixture: Fixture,
  responseJson: Json | null
): [number, number, number] {
  const CHARS_PER_TOKEN = 4;
  const SYSTEM_OVERHEAD = 2000; // combined system prompts for both agents

  // Count Unicode code points (Python len()), not UTF-16 units, so astral characters
  // (emoji, CJK extensions) do not inflate the count vs. the Python harness.
  const codePoints = (s: string): number => {
    let count = 0;
    for (const _ of s) count++;
    return count;
  };
  const reqChars = codePoints(pyJsonDumps(fixture.request)) + SYSTEM_OVERHEAD;
  // Two LLM calls (gap analysis prompt + planning prompt).
  const promptTokens = Math.trunc(reqChars / CHARS_PER_TOKEN) * 2;
  const completionChars = responseJson ? codePoints(pyJsonDumps(responseJson)) : 0;
  const completionTokens = Math.trunc(completionChars / CHARS_PER_TOKEN);

  const cost =
    (promptTokens / 1_000_000) * PRICE_INPUT_PER_1M +
    (completionTokens / 1_000_000) * PRICE_OUTPUT_PER_1M;
  return [promptTokens, completionTokens, cost];
}

// ── Fixture execution ─────────────────────────────────────────────────────────

export async function runFixture(
  fixture: Fixture,
  endpoint: string,
  timeoutMs: number
): Promise<FixtureResult> {
  const result = newResult(fixture.id);

  const t0 = performance.now();
  const resp = await callAnalyze(endpoint, fixture.request, timeoutMs);
  result.latency_s = (performance.now() - t0) / 1000;
  result.status_code = resp.statusCode;

  if (resp.error || resp.data === null) {
    result.error = resp.error ?? "No `event: result` frame received from SSE stream";
    return result;
  }

  const data = asObj(resp.data);
  result.json_parse_ok = true;
  result.response_json = data;

  // Schema validation (Zod mirror of CAREER_PLAN_SCHEMA).
  const validation = validateCareerPlan(data);
  result.schema_valid = validation.valid;
  result.schema_errors = validation.errors;

  // Structural checks.
  const matchScore = asObj(data.gap_analysis).overall_match_score;
  result.overall_match_score = typeof matchScore === "number" ? matchScore : null;
  result.plan_completeness = checkPlanCompleteness(data);
  result.date_consistent = checkDateConsistency(data);

  // Match score range check.
  const expectedRange = fixture.expected_match_score_range;
  if (expectedRange && result.overall_match_score !== null) {
    const [lo, hi] = expectedRange;
    result.match_score_in_range =
      lo <= result.overall_match_score && result.overall_match_score <= hi;
  }

  // Category diversity: >=3 distinct categories across gaps + strengths,
  // and all expected_categories present if specified.
  const gapAnalysis = asObj(data.gap_analysis);
  const allCategories = new Set<string>();
  for (const item of asArr(gapAnalysis.gaps)) {
    const cat = str(asObj(item).category);
    if (cat) allCategories.add(cat);
  }
  for (const item of asArr(gapAnalysis.strengths)) {
    const cat = str(asObj(item).category);
    if (cat) allCategories.add(cat);
  }
  const expectedCats = fixture.expected_categories ?? [];
  result.category_diversity_ok =
    allCategories.size >= 3 && expectedCats.every((c) => allCategories.has(c));

  // Project integration checks (only when resume has projects).
  const resumeProjects = asArr(asObj(asObj(fixture.request).resumeJson).projects);
  if (resumeProjects.length > 0) {
    result.project_portfolio_strength = checkPortfolioStrengths(data);
    result.project_plan_integration = checkProjectPlanIntegration(data, fixture);
  } else {
    result.project_portfolio_strength = true;
    result.project_plan_integration = true;
  }

  // RAG-grounding structural checks (fixture-driven; N/A → pass).
  result.hidden_expectation_coverage = checkHiddenExpectations(data, fixture);
  result.prerequisite_ordering_ok = checkPrerequisiteOrdering(data, fixture);

  // Content-accuracy vs labeled gaps.
  const [recall, precision] = scoreGapRecallPrecision(data, fixture);
  result.gap_recall = recall;
  result.gap_precision = precision;

  return result;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

export interface Metrics {
  [key: string]: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.max(0, Math.min(Math.trunc((sorted.length * p) / 100), sorted.length - 1));
  return sorted[idx];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

export function computeMetrics(results: FixtureResult[]): Metrics {
  const n = results.length;
  if (n === 0) return {};

  const successful = results.filter((r) => r.json_parse_ok);
  const latencies = results
    .filter((r) => r.latency_s !== null)
    .map((r) => r.latency_s as number)
    .sort((a, b) => a - b);

  const faithfulnessScores = successful
    .filter((r) => r.gap_faithfulness !== null)
    .map((r) => r.gap_faithfulness as number);
  const depthScores = successful
    .filter((r) => r.contextual_depth !== null)
    .map((r) => r.contextual_depth as number);
  const recallScores = successful
    .filter((r) => r.gap_recall !== null)
    .map((r) => r.gap_recall as number);
  const precisionScores = successful
    .filter((r) => r.gap_precision !== null)
    .map((r) => r.gap_precision as number);

  const rateOver = (pred: (r: FixtureResult) => boolean): number =>
    successful.length ? successful.filter(pred).length / successful.length : 0.0;

  return {
    schema_compliance_rate: successful.filter((r) => r.schema_valid).length / n,
    json_parse_error_rate: 1 - successful.length / n,
    gap_faithfulness: faithfulnessScores.length ? mean(faithfulnessScores) : NaN,
    plan_completeness_rate: rateOver((r) => r.plan_completeness),
    date_consistency_rate: rateOver((r) => r.date_consistent),
    p50_latency_s: percentile(latencies, 50),
    p95_latency_s: percentile(latencies, 95),
    avg_cost_usd: results.reduce((a, r) => a + r.cost_usd, 0) / n,
    match_score_in_range_rate: rateOver((r) => r.match_score_in_range),
    gap_recall: recallScores.length ? mean(recallScores) : NaN,
    gap_precision: precisionScores.length ? mean(precisionScores) : NaN,
    category_diversity_rate: rateOver((r) => r.category_diversity_ok),
    project_portfolio_strength_rate: rateOver((r) => r.project_portfolio_strength),
    project_plan_integration_rate: rateOver((r) => r.project_plan_integration),
    hidden_expectation_coverage_rate: rateOver((r) => r.hidden_expectation_coverage),
    prerequisite_ordering_rate: rateOver((r) => r.prerequisite_ordering_ok),
    contextual_depth: depthScores.length ? mean(depthScores) : NaN,
    total_fixtures: n,
    successful_fixtures: successful.length,
  };
}

// ── Output formatting ──────────────────────────────────────────────────────────

function passFail(condition: boolean): string {
  return condition ? "PASS" : "FAIL";
}

function fmtNan(v: number, digits: number): string {
  return Number.isNaN(v) ? "N/A (--skip-llm-judge)" : v.toFixed(digits);
}

function pctOrNa(v: number): string {
  return Number.isNaN(v) ? "N/A" : `${(v * 100).toFixed(2)}%`;
}

function pct2(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function pct0(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

/** Shared [Metric, Score, Threshold, Status] rows for the console summary and Markdown report. */
function summaryRows(m: Metrics): string[][] {
  return [
    [
      "Schema Compliance Rate",
      pct2(m.schema_compliance_rate),
      `>= ${pct0(THRESHOLDS.schema_compliance_rate)}`,
      passFail(m.schema_compliance_rate >= THRESHOLDS.schema_compliance_rate),
    ],
    [
      "JSON Parse Error Rate",
      pct2(m.json_parse_error_rate),
      `<  ${pct0(THRESHOLDS.json_parse_error_rate)}`,
      passFail(m.json_parse_error_rate <= THRESHOLDS.json_parse_error_rate),
    ],
    [
      "Gap Faithfulness (LLM-judge)",
      fmtNan(m.gap_faithfulness, 4),
      `>= ${pyFloatStr(THRESHOLDS.gap_faithfulness)}`,
      Number.isNaN(m.gap_faithfulness)
        ? "SKIP"
        : passFail(m.gap_faithfulness >= THRESHOLDS.gap_faithfulness),
    ],
    [
      "Plan Completeness Rate",
      pct2(m.plan_completeness_rate),
      `>= ${pct0(THRESHOLDS.plan_completeness_rate)}`,
      passFail(m.plan_completeness_rate >= THRESHOLDS.plan_completeness_rate),
    ],
    [
      "Date Consistency Rate",
      pct2(m.date_consistency_rate),
      "= 100%",
      passFail(m.date_consistency_rate >= THRESHOLDS.date_consistency_rate),
    ],
    ["p50 Latency", `${m.p50_latency_s.toFixed(1)}s`, "—", "INFO"],
    [
      "p95 Latency",
      `${m.p95_latency_s.toFixed(1)}s`,
      `< ${pyFloatStr(THRESHOLDS.p95_latency_s)}s`,
      passFail(m.p95_latency_s <= THRESHOLDS.p95_latency_s),
    ],
    [
      "Avg Cost / Request",
      `$${m.avg_cost_usd.toFixed(4)}`,
      `< $${THRESHOLDS.avg_cost_usd}`,
      passFail(m.avg_cost_usd <= THRESHOLDS.avg_cost_usd),
    ],
    [
      "Match Score In Range",
      pct2(m.match_score_in_range_rate),
      `>= ${pct0(THRESHOLDS.match_score_in_range_rate)}`,
      passFail(m.match_score_in_range_rate >= THRESHOLDS.match_score_in_range_rate),
    ],
    [
      "Gap Recall (vs labels)",
      pctOrNa(m.gap_recall),
      `>= ${pct0(THRESHOLDS.gap_recall)}`,
      Number.isNaN(m.gap_recall) ? "SKIP" : passFail(m.gap_recall >= THRESHOLDS.gap_recall),
    ],
    ["Gap Precision (INFO)", pctOrNa(m.gap_precision), "—", "INFO"],
    [
      "Category Diversity (>=3 dims)",
      pct2(m.category_diversity_rate),
      "= 100%",
      passFail(m.category_diversity_rate >= THRESHOLDS.category_diversity_rate),
    ],
    [
      "Project Portfolio Strength",
      pct2(m.project_portfolio_strength_rate),
      `>= ${pct0(THRESHOLDS.project_portfolio_strength_rate)}`,
      passFail(m.project_portfolio_strength_rate >= THRESHOLDS.project_portfolio_strength_rate),
    ],
    [
      "Project Plan Integration",
      pct2(m.project_plan_integration_rate),
      `>= ${pct0(THRESHOLDS.project_plan_integration_rate)}`,
      passFail(m.project_plan_integration_rate >= THRESHOLDS.project_plan_integration_rate),
    ],
    [
      "Hidden Expectation Coverage",
      pct2(m.hidden_expectation_coverage_rate),
      `>= ${pct0(THRESHOLDS.hidden_expectation_coverage_rate)}`,
      passFail(m.hidden_expectation_coverage_rate >= THRESHOLDS.hidden_expectation_coverage_rate),
    ],
    [
      "Prerequisite Ordering",
      pct2(m.prerequisite_ordering_rate),
      "= 100%",
      passFail(m.prerequisite_ordering_rate >= THRESHOLDS.prerequisite_ordering_rate),
    ],
    [
      "Contextual Depth (LLM-judge)",
      fmtNan(m.contextual_depth, 4),
      `>= ${pyFloatStr(THRESHOLDS.contextual_depth)}`,
      Number.isNaN(m.contextual_depth)
        ? "SKIP"
        : passFail(m.contextual_depth >= THRESHOLDS.contextual_depth),
    ],
  ];
}

function printSummary(m: Metrics, allPass: boolean): void {
  console.log();
  console.log("=".repeat(72));
  console.log("  readmycareer.com — Agent Output Quality Evaluation");
  console.log("=".repeat(72));
  console.log(tabulate(["Metric", "Score", "Threshold", "Status"], summaryRows(m), "simple"));
  console.log("-".repeat(72));
  console.log(`Fixtures: ${m.successful_fixtures}/${m.total_fixtures} successful`);
  console.log(
    `Overall:  ${
      allPass ? "PASS — all thresholds met" : "FAIL — one or more metrics below threshold"
    }`
  );
  console.log("=".repeat(72));
}

// ── CSV export ────────────────────────────────────────────────────────────────

const CSV_FIELDS: (keyof FixtureResult)[] = [
  "fixture_id",
  "run_index",
  "latency_s",
  "status_code",
  "json_parse_ok",
  "schema_valid",
  "schema_errors",
  "gap_faithfulness",
  "contextual_depth",
  "gap_recall",
  "gap_precision",
  "plan_completeness",
  "date_consistent",
  "match_score_in_range",
  "category_diversity_ok",
  "project_portfolio_strength",
  "project_plan_integration",
  "hidden_expectation_coverage",
  "prerequisite_ordering_ok",
  "overall_match_score",
  "prompt_tokens",
  "completion_tokens",
  "cost_usd",
  "error",
];

// Columns the Python harness holds as Python floats — these must serialise via
// Python's str(float) (e.g. 0.0 -> "0.0"), unlike the integer columns (token counts,
// run_index, status_code) and overall_match_score (preserved as the JSON value).
const FLOAT_FIELDS = new Set<keyof FixtureResult>([
  "latency_s",
  "gap_faithfulness",
  "contextual_depth",
  "gap_recall",
  "gap_precision",
  "cost_usd",
]);

function saveCsv(results: FixtureResult[], outputPath: string): void {
  if (results.length === 0) return;
  const rows = results.map((r) => {
    const row: Record<string, unknown> = {};
    for (const field of CSV_FIELDS) {
      const v = r[field];
      row[field] =
        FLOAT_FIELDS.has(field) && typeof v === "number" ? pyFloatRepr(v) : v;
    }
    return row;
  });
  writeCsv(outputPath, CSV_FIELDS as string[], rows);
}

// ── Markdown report ─────────────────────────────────────────────────────────

const KO_METRIC_LABELS: Record<string, string> = {
  "Schema Compliance Rate": "스키마 준수율",
  "JSON Parse Error Rate": "JSON 파싱 오류율",
  "Gap Faithfulness (LLM-judge)": "갭 충실도 (LLM 심사)",
  "Plan Completeness Rate": "플랜 완성도",
  "Date Consistency Rate": "날짜 연속성",
  "p50 Latency": "p50 지연시간",
  "p95 Latency": "p95 지연시간",
  "Avg Cost / Request": "요청당 평균 비용",
  "Match Score In Range": "적합도 점수 범위 적중",
  "Gap Recall (vs labels)": "갭 재현율 (라벨 대비)",
  "Gap Precision (INFO)": "갭 정밀도 (INFO)",
  "Category Diversity (>=3 dims)": "카테고리 다양성 (≥3)",
  "Project Portfolio Strength": "프로젝트 포트폴리오 강점",
  "Project Plan Integration": "프로젝트-플랜 연계",
  "Hidden Expectation Coverage": "숨은 기대 커버리지",
  "Prerequisite Ordering": "선수(prerequisite) 순서",
  "Contextual Depth (LLM-judge)": "맥락 깊이 (LLM 심사)",
};

const METRIC_GLOSSARY = `| 지표 | 기준 | 의미 |
| --- | --- | --- |
| **스키마 준수율** (Schema Compliance) | ≥ 95% | 응답 JSON이 \`CareerPlanOutput\` 스키마(\`gap_analysis\` + \`weeks\`, 필수 필드 포함)를 통과한 비율. 에이전트 출력의 구조적 유효성. |
| **JSON 파싱 오류율** (JSON Parse Error) | < 5% | 응답 본문을 JSON으로 아예 파싱하지 못한 비율(\`1 − 성공/전체\`). 낮을수록 좋음. |
| **갭 충실도** (Gap Faithfulness, LLM 심사) | ≥ 0.70 | 각 갭이 JD/이력서 근거에 기반했는지(환각이 아닌지)를 LLM 심사가 0–1로 채점. \`--skip-llm-judge\` 시 \`SKIP\`. |
| **플랜 완성도** (Plan Completeness) | ≥ 90% | 모든 주차가 todo를 3개 이상 가진 플랜의 비율. |
| **날짜 연속성** (Date Consistency) | = 100% | 주차별 날짜 구간이 시간순으로 연속(end ≥ start, 다음 주 시작이 이전 주 종료 +2일 이내)인 플랜 비율. |
| **지연시간** (p50 / p95 Latency) | p95 < 30s | \`/api/analyze\` 응답 시간의 중앙값 / 95퍼센타일. p50은 참고(INFO). |
| **요청당 평균 비용** (Avg Cost / Request) | < $0.01 | 요청당 추정 비용(USD). prompt+completion 토큰 × 단가(\`config/model-pricing.json\`). |
| **적합도 점수 범위 적중** (Match Score In Range) | ≥ 80% | \`overall_match_score\`가 fixture의 기대 범위 안에 든 비율 — 모델이 적합도를 과대/과소 평가하는지 점검. |
| **갭 재현율** (Gap Recall, 라벨 대비) | ≥ 50% | fixture에 라벨된 갭 키워드(\`expected_gaps_keywords\`) 중 분석이 실제로 짚어낸 비율(각 갭 \`item\`+\`rationale\`에 대소문자 무시 부분일치). 골든셋 대비 내용 정확도. |
| **갭 정밀도** (Gap Precision) | INFO | 모델이 제시한 갭 중 라벨 키워드를 1개 이상 맞춘 비율. 라벨이 비포괄적이라(라벨 밖의 정당한 갭은 오탐처럼 보임) 게이트 없이 참고용. |
| **카테고리 다양성** (Category Diversity, ≥3) | = 100% | 갭+강점이 3개 이상 카테고리(\`skill\`/\`experience\`/\`certification\`/\`portfolio\`/\`keyword\`)에 걸치는지(+fixture가 명시한 카테고리 포함). 단조로운 분석 방지. |
| **프로젝트 포트폴리오 강점** (Project Portfolio Strength) | ≥ 80% | 이력서에 프로젝트가 있는 fixture에서 \`portfolio\` 카테고리 강점을 1개 이상 짚었는지(프로젝트 없으면 자동 통과). |
| **프로젝트-플랜 연계** (Project Plan Integration) | ≥ 70% | 프로젝트가 있는 fixture에서 주간 todo 1개 이상이 기존 프로젝트명을 참조하는지(부분일치). 보유 자산 위에 플랜을 쌓는지. |
| **숨은 기대 커버리지** (Hidden Expectation Coverage) | ≥ 66% | JD에 문자 그대로 없지만 reference 코퍼스가 직무/티어에 연결하는 *암묵적* 기대를 1개 이상 표면화했는지(README 갭 영역 #2). RAG grounding 지표 — reference 코퍼스 시딩 필요. |
| **선수(prerequisite) 순서** (Prerequisite Ordering) | = 100% | fixture가 선언한 \`[before, after]\` 쌍마다, 의존 대상보다 기초 갭이 더 낮게 랭크되지 않는지(랭크 = 우선순위 가중치 → 배열 인덱스 순). README 갭 영역 #5. |
| **맥락 깊이** (Contextual Depth, LLM 심사) | ≥ 0.70 | 키워드 매칭을 넘어선 종합 깊이 — 스킬 전이성, 회사 단계/티어 적합, 시장 적합성(README 갭 영역 #1/#3/#4)을 LLM 심사가 0–1로 채점. \`--skip-llm-judge\` 시 \`SKIP\`. |

**상태 범례:** \`PASS\` / \`FAIL\` = 기준 충족 / 미달 · \`INFO\` = 측정만 하고 게이트 없음 · \`SKIP\` = LLM 심사 미수행(\`--skip-llm-judge\`).

> 비용 산출 상세 기준은 [비용 산출 기준](./cost-calculation.ko.md) 문서를 참고하세요.
`;

type CellKind = "bool" | "latency" | "cost" | "float" | "raw";

function fmtCell(value: unknown, kind: CellKind): string {
  if (value === null || value === undefined) return "—";
  if (kind === "bool") return value ? "✓" : "✗";
  if (kind === "latency") return `${Number(value).toFixed(1)}s`;
  if (kind === "cost") return `$${Number(value).toFixed(4)}`;
  if (kind === "float") return Number(value).toFixed(2);
  return String(value);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function nowStamp(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

function saveMarkdownReport(
  results: FixtureResult[],
  m: Metrics,
  allPass: boolean,
  mdPath: string
): void {
  if (results.length === 0) return;

  const summaryRowsKo = summaryRows(m).map((row) => [
    KO_METRIC_LABELS[row[0]] ?? row[0],
    ...row.slice(1),
  ]);
  const summaryMd = tabulate(["지표", "점수", "기준", "상태"], summaryRowsKo, "github");

  const perFixtureHeaders = [
    "케이스",
    "지연",
    "스키마",
    "충실도",
    "깊이",
    "재현율",
    "todo≥3",
    "날짜",
    "숨은기대",
    "적합도",
    "비용",
  ];
  const perFixtureRows = results.map((r) => [
    r.fixture_id ?? "—",
    fmtCell(r.latency_s, "latency"),
    fmtCell(r.schema_valid, "bool"),
    fmtCell(r.gap_faithfulness, "float"),
    fmtCell(r.contextual_depth, "float"),
    fmtCell(r.gap_recall, "float"),
    fmtCell(r.plan_completeness, "bool"),
    fmtCell(r.date_consistent, "bool"),
    fmtCell(r.hidden_expectation_coverage, "bool"),
    fmtCell(r.overall_match_score, "raw"),
    fmtCell(r.cost_usd, "cost"),
  ]);
  const perFixtureMd = tabulate(perFixtureHeaders, perFixtureRows, "github");

  const generated = nowStamp();
  const overall = allPass
    ? "✅ **PASS** — 모든 게이트 기준 충족"
    : "❌ **FAIL** — 일부 게이트 지표가 기준 미달";

  const content = `# 에이전트 출력 품질 리포트

> \`eval/agent_harness.ts\`가 매 실행마다 **자동 생성** — 직접 수정하지 마세요.
> 원본 케이스별 수치: [\`eval/agent_harness_results.csv\`](../eval/agent_harness_results.csv).
> 갱신 방법: \`pnpm dev\` 실행 후 \`pnpm eval:agents\`(또는 \`pnpm eval\`).

- **생성 시각:** ${generated}
- **결과:** ${overall}
- **케이스:** ${m.successful_fixtures}/${m.total_fixtures} 성공
- **LLM 심사 모델:** \`${JUDGE_MODEL}\`

## 종합 지표

${summaryMd}

## 케이스별 점수

${perFixtureMd}

범례: ✓ / ✗ = 케이스별 통과 / 실패 · 충실도·깊이 = LLM 심사 (0–1) ·
재현율 = 라벨 대비 (0–1) · 적합도 = \`overall_match_score\` (0–100).

## 지표 설명

${METRIC_GLOSSARY}
`;

  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, content, "utf8");
}

// ── Overall pass/fail judgment ────────────────────────────────────────────────

export function allThresholdsMet(m: Metrics): boolean {
  const checks: boolean[] = [
    m.schema_compliance_rate >= THRESHOLDS.schema_compliance_rate,
    m.json_parse_error_rate <= THRESHOLDS.json_parse_error_rate,
    m.plan_completeness_rate >= THRESHOLDS.plan_completeness_rate,
    m.date_consistency_rate >= THRESHOLDS.date_consistency_rate,
    m.p95_latency_s <= THRESHOLDS.p95_latency_s,
    m.avg_cost_usd <= THRESHOLDS.avg_cost_usd,
    m.match_score_in_range_rate >= THRESHOLDS.match_score_in_range_rate,
    m.category_diversity_rate >= THRESHOLDS.category_diversity_rate,
    m.project_portfolio_strength_rate >= THRESHOLDS.project_portfolio_strength_rate,
    m.project_plan_integration_rate >= THRESHOLDS.project_plan_integration_rate,
    m.hidden_expectation_coverage_rate >= THRESHOLDS.hidden_expectation_coverage_rate,
    m.prerequisite_ordering_rate >= THRESHOLDS.prerequisite_ordering_rate,
  ];
  // gap_recall is NaN only when no fixture declares labels; skip the gate in that case.
  if (!Number.isNaN(m.gap_recall)) checks.push(m.gap_recall >= THRESHOLDS.gap_recall);
  // LLM-judge metrics: skip check if NaN (judge was skipped).
  if (!Number.isNaN(m.gap_faithfulness))
    checks.push(m.gap_faithfulness >= THRESHOLDS.gap_faithfulness);
  if (!Number.isNaN(m.contextual_depth))
    checks.push(m.contextual_depth >= THRESHOLDS.contextual_depth);
  return checks.every(Boolean);
}

// ── Consistency / variance ────────────────────────────────────────────────────

interface ConsistencyRow {
  fixture_id: string;
  runs: number;
  match_score_stdev: number;
  gap_faithfulness_stdev: number;
  gap_recall_stdev: number;
  latency_stdev: number;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0.0;
  const mu = values.reduce((a, b) => a + b, 0) / values.length;
  // Sample standard deviation (statistics.stdev → n-1 denominator).
  const variance = values.reduce((a, v) => a + (v - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeConsistency(results: FixtureResult[]): ConsistencyRow[] {
  const byFixture = new Map<string, FixtureResult[]>();
  for (const r of results) {
    const arr = byFixture.get(r.fixture_id) ?? [];
    arr.push(r);
    byFixture.set(r.fixture_id, arr);
  }

  const rows: ConsistencyRow[] = [];
  for (const [fid, runs] of byFixture) {
    if (runs.length < 2) continue;
    const stdevOf = (key: keyof FixtureResult): number => {
      const vals = runs
        .map((r) => r[key])
        .filter((v): v is number => typeof v === "number");
      return vals.length >= 2 ? stdev(vals) : 0.0;
    };
    rows.push({
      fixture_id: fid,
      runs: runs.length,
      match_score_stdev: stdevOf("overall_match_score"),
      gap_faithfulness_stdev: stdevOf("gap_faithfulness"),
      gap_recall_stdev: stdevOf("gap_recall"),
      latency_stdev: stdevOf("latency_s"),
    });
  }
  return rows;
}

function printConsistency(rows: ConsistencyRow[]): void {
  if (rows.length === 0) return;
  console.log("\n" + "=".repeat(72));
  console.log("  Consistency / Variance (stdev across repeated runs)");
  console.log("=".repeat(72));
  const table = rows.map((r) => [
    r.fixture_id,
    String(r.runs),
    r.match_score_stdev.toFixed(2),
    r.gap_faithfulness_stdev.toFixed(3),
    r.gap_recall_stdev.toFixed(3),
    `${r.latency_stdev.toFixed(2)}s`,
  ]);
  console.log(
    tabulate(
      ["Fixture", "Runs", "MatchScore σ", "Faithfulness σ", "Recall σ", "Latency σ"],
      table,
      "simple"
    )
  );
  console.log("=".repeat(72));
}

// ── Regression baseline + diff ──────────────────────────────────────────────────

const BASELINE_PATH = resolve(EVAL_DIR, "baseline.json");

// (metric_key, higher_is_better)
const BASELINE_METRICS: [string, boolean][] = [
  ["schema_compliance_rate", true],
  ["json_parse_error_rate", false],
  ["gap_faithfulness", true],
  ["gap_recall", true],
  ["plan_completeness_rate", true],
  ["date_consistency_rate", true],
  ["p95_latency_s", false],
  ["avg_cost_usd", false],
  ["match_score_in_range_rate", true],
  ["hidden_expectation_coverage_rate", true],
  ["prerequisite_ordering_rate", true],
  ["contextual_depth", true],
];

const REGRESSION_ABS_TOL = 0.05; // absolute tolerance for rate/score metrics (0–1)
const REGRESSION_REL_TOL = 0.2; // relative tolerance for latency / cost metrics

function baselineValue(v: number | undefined): number | null {
  if (v === undefined || Number.isNaN(v)) return null;
  return v;
}

/** Local-time ISO stamp to seconds (mirrors Python datetime.now().isoformat(timespec="seconds")). */
function localIsoStamp(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

function saveBaseline(m: Metrics, path: string): void {
  const snapshot = {
    generated_at: localIsoStamp(),
    metrics: Object.fromEntries(
      BASELINE_METRICS.map(([k]) => [k, baselineValue(m[k])])
    ),
  };
  writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`\n[baseline] Saved baseline snapshot → ${path}`);
}

function fmtVal(v: number | null): string {
  if (v === null) return "—";
  return v.toFixed(4);
}

function compareBaseline(m: Metrics, path: string): boolean {
  if (!existsSync(path)) {
    console.log(`\n[baseline] No baseline at ${path} — run with --save-baseline first.`);
    return true;
  }
  const baseline = JSON.parse(readFileSync(path, "utf8")) as {
    generated_at?: string;
    metrics?: Record<string, number | null>;
  };
  const baseMetrics = baseline.metrics ?? {};
  const rows: string[][] = [];
  let regressed = false;

  for (const [key, higherIsBetter] of BASELINE_METRICS) {
    const cur = m[key];
    const base = baseMetrics[key];
    if (cur === undefined || Number.isNaN(cur) || base === null || base === undefined) {
      rows.push([key, fmtVal(base ?? null), fmtVal(cur ?? null), "—", "SKIP"]);
      continue;
    }
    const delta = cur - base;
    const tol =
      key === "p95_latency_s" || key === "avg_cost_usd"
        ? Math.abs(base) * REGRESSION_REL_TOL
        : REGRESSION_ABS_TOL;
    const isRegression = higherIsBetter ? delta < -tol : delta > tol;
    const improved = higherIsBetter ? delta > tol : delta < -tol;
    const status = isRegression ? "REGRESSED" : improved ? "improved" : "ok";
    if (isRegression) regressed = true;
    rows.push([key, fmtVal(base), fmtVal(cur), `${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`, status]);
  }

  console.log("\n" + "=".repeat(72));
  console.log(`  Regression diff vs baseline (${baseline.generated_at ?? "?"})`);
  console.log("=".repeat(72));
  console.log(tabulate(["Metric", "Baseline", "Current", "Δ", "Status"], rows, "simple"));
  console.log("=".repeat(72));
  console.log(
    regressed
      ? "REGRESSION DETECTED — one or more metrics dropped beyond tolerance."
      : "No regressions beyond tolerance."
  );
  return !regressed;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  const baseUrl = getOption(argv, "--base-url", "http://localhost:3000");
  const timeout = getIntOption(argv, "--timeout", 90);
  const skipLlmJudge = hasFlag(argv, "--skip-llm-judge");
  const fixturesArg = getOption(argv, "--fixtures", resolve(EVAL_DIR, "fixtures", "agent_fixtures.json"));
  const repeat = Math.max(1, getIntOption(argv, "--repeat", 1));
  const doSaveBaseline = hasFlag(argv, "--save-baseline");
  const doCompareBaseline = hasFlag(argv, "--compare-baseline");

  const endpoint = `${baseUrl}/api/analyze`;
  const timeoutMs = timeout * 1000;

  // Initialize LLM judge.
  let client: GeminiClient | null = null;
  if (!skipLlmJudge) {
    if (!GOOGLE_API_KEY) {
      console.log(
        "ERROR: GOOGLE_API_KEY is not set.\n" +
          "       Use --skip-llm-judge to skip the LLM judge."
      );
      return 1;
    }
    client = new GeminiClient(GOOGLE_API_KEY);
  }

  // Load + Zod-validate fixtures.
  if (!existsSync(fixturesArg)) {
    console.log(`ERROR: Fixture file not found: ${fixturesArg}`);
    return 1;
  }
  let fixtures: Fixture[];
  try {
    fixtures = loadFixtures(fixturesArg);
  } catch (exc) {
    console.log(`ERROR: ${(exc as Error).message}`);
    return 1;
  }

  console.log(`\nLoaded ${fixtures.length} fixtures: ${fixturesArg}`);
  console.log(`Endpoint: ${endpoint}`);
  const judgeStatus = skipLlmJudge ? "OFF" : `ON (${JUDGE_MODEL})`;
  console.log(`Timeout: ${timeout}s | LLM judge: ${judgeStatus}`);
  console.log();

  const results: FixtureResult[] = [];

  const processOne = async (fixture: Fixture, i: number): Promise<FixtureResult> => {
    console.log(`[${i}/${fixtures.length}] ${fixture.id}`);
    console.log(`  → ${fixture.description}`);

    const result = await runFixture(fixture, endpoint, timeoutMs);

    if (result.error) {
      console.log(`  ✗ Error: ${result.error}`);
    } else {
      const statusIcon = result.json_parse_ok ? "✓" : "✗";
      const schemaStatus = result.schema_valid
        ? "Valid"
        : `Error (${result.schema_errors.length} errors)`;
      console.log(
        `  ${statusIcon} HTTP ${result.status_code} | ` +
          `${(result.latency_s ?? 0).toFixed(1)}s | ` +
          `Schema: ${schemaStatus} | ` +
          `todos/week>=3: ${result.plan_completeness} | ` +
          `Date continuity: ${result.date_consistent} | ` +
          `Score in range: ${result.match_score_in_range} | ` +
          `Gap recall: ${result.gap_recall ?? "N/A"}`
      );

      if (result.json_parse_ok && client !== null) {
        process.stdout.write("  → LLM judging faithfulness...");
        result.gap_faithfulness = await judgeGapFaithfulness(
          fixture,
          result.response_json as Json,
          client
        );
        console.log(` ${result.gap_faithfulness.toFixed(2)}`);
        process.stdout.write("  → LLM judging contextual depth...");
        result.contextual_depth = await judgeContextualDepth(
          fixture,
          result.response_json as Json,
          client
        );
        console.log(` ${result.contextual_depth.toFixed(2)}`);
      }
    }

    const [pt, ct, cost] = estimateCost(fixture, result.response_json);
    result.prompt_tokens = pt;
    result.completion_tokens = ct;
    result.cost_usd = cost;
    console.log();
    return result;
  };

  for (let runIdx = 0; runIdx < repeat; runIdx++) {
    if (repeat > 1) console.log(`\n────── Repeat run ${runIdx + 1}/${repeat} ──────`);
    for (let i = 0; i < fixtures.length; i++) {
      const result = await processOne(fixtures[i], i + 1);
      result.run_index = runIdx;
      results.push(result);
    }
  }

  const metrics = computeMetrics(results);
  const passed = allThresholdsMet(metrics);
  printSummary(metrics, passed);

  if (repeat > 1) printConsistency(computeConsistency(results));

  const outputPath = resolve(EVAL_DIR, "agent_harness_results.csv");
  saveCsv(results, outputPath);
  console.log(`\nDetailed results saved to: ${outputPath}`);

  const reportPath = resolve(ROOT_DIR, "documents", "agent-eval-report.md");
  saveMarkdownReport(results, metrics, passed, reportPath);
  console.log(`Markdown report saved to:   ${reportPath}`);

  if (doSaveBaseline) saveBaseline(metrics, BASELINE_PATH);
  let noRegression = true;
  if (doCompareBaseline) noRegression = compareBaseline(metrics, BASELINE_PATH);

  return passed && noRegression ? 0 : 1;
}

// Run only when invoked directly (not when imported by model_comparison.ts).
const INVOKED_DIRECTLY = process.argv[1] === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
