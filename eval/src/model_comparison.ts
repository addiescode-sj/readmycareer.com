// Cross-model comparison harness (model_comparison.ts)
// ====================================================
//
// TypeScript port of model_comparison.py. Runs the agent fixtures against
// POST /api/analyze once per LLM provider and compares output quality, latency, and
// cost side by side. The same fixtures, the same scorers, different providers — the
// provider override is injected via the `provider` field the analyze route accepts.
//
// A provider whose API key is absent is reported as SKIPPED (no key); no numbers are
// fabricated.
//
// Run the dev server first (pnpm dev), then:
//   pnpm --filter @readmycareer/eval compare-models
//   pnpm --filter @readmycareer/eval compare-models -- --providers gemini,openai --skip-llm-judge

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./lib/env";
import { writeCsvRows } from "./lib/csv";
import { GeminiClient } from "./lib/gemini";
import { hasFlag, getOption, getIntOption } from "./lib/args";
import { loadFixtures, type Fixture } from "./lib/schema";
import {
  GOOGLE_API_KEY,
  computeMetrics,
  estimateCost,
  judgeContextualDepth,
  judgeGapFaithfulness,
  runFixture,
  type FixtureResult,
  type Metrics,
} from "./agent_harness";

loadRootEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = resolve(HERE, "..");

// Provider → environment variables that must be present for a live run.
const PROVIDER_KEY_ENV: Record<string, string[]> = {
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
};

function providerKeyAvailable(provider: string): boolean {
  return (PROVIDER_KEY_ENV[provider] ?? []).some((env) => process.env[env]);
}

async function runProvider(
  provider: string,
  fixtures: Fixture[],
  endpoint: string,
  timeoutMs: number,
  client: GeminiClient | null
): Promise<Metrics | null> {
  if (!providerKeyAvailable(provider)) {
    const keys = (PROVIDER_KEY_ENV[provider] ?? ["?"]).join(" / ");
    console.log(`\n[${provider}] SKIPPED — none of [${keys}] is set in the environment.`);
    return null;
  }

  console.log(`\n===== Provider: ${provider} =====`);
  const results: FixtureResult[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    console.log(`  [${i + 1}/${fixtures.length}] ${fixture.id}`);
    // Inject the provider override into the request body.
    const fx: Fixture = {
      ...fixture,
      request: { ...fixture.request, provider },
    };
    const result = await runFixture(fx, endpoint, timeoutMs);

    if (result.error) {
      console.log(`    ✗ ${result.error}`);
    } else if (result.json_parse_ok && client !== null) {
      result.gap_faithfulness = await judgeGapFaithfulness(
        fx,
        result.response_json as Record<string, unknown>,
        client
      );
      result.contextual_depth = await judgeContextualDepth(
        fx,
        result.response_json as Record<string, unknown>,
        client
      );
    }

    const [pt, ct, cost] = estimateCost(fx, result.response_json);
    result.prompt_tokens = pt;
    result.completion_tokens = ct;
    result.cost_usd = cost;
    results.push(result);
  }

  return computeMetrics(results);
}

type FmtKind = "pct2" | "f3" | "f1" | "f4";

function fmt(metrics: Metrics | null, key: string, kind: FmtKind): string {
  if (metrics === null) return "SKIPPED (no key)";
  const v = metrics[key];
  if (v === undefined || Number.isNaN(v)) return "N/A";
  switch (kind) {
    case "pct2":
      return `${(v * 100).toFixed(2)}%`;
    case "f3":
      return v.toFixed(3);
    case "f1":
      return v.toFixed(1);
    case "f4":
      return v.toFixed(4);
  }
}

export async function main(argv: string[]): Promise<number> {
  const baseUrl = getOption(argv, "--base-url", "http://localhost:3000");
  const timeout = getIntOption(argv, "--timeout", 90);
  const providersArg = getOption(argv, "--providers", "gemini,openai");
  const fixturesArg = getOption(argv, "--fixtures", resolve(EVAL_DIR, "fixtures", "agent_fixtures.json"));
  const skipLlmJudge = hasFlag(argv, "--skip-llm-judge");

  const endpoint = `${baseUrl}/api/analyze`;
  const timeoutMs = timeout * 1000;
  const providers = providersArg
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p);

  const fixtures = loadFixtures(fixturesArg);

  // Optional LLM judge (shared across providers for a fair faithfulness comparison).
  let client: GeminiClient | null = null;
  if (!skipLlmJudge) {
    if (!GOOGLE_API_KEY) {
      console.log("WARN: GOOGLE_API_KEY not set — running comparison without the LLM judge.");
    } else {
      client = new GeminiClient(GOOGLE_API_KEY);
    }
  }

  console.log("=".repeat(72));
  console.log("  readmycareer.com — Cross-Model Comparison");
  console.log(`  Providers: ${providers.join(", ")} | Endpoint: ${endpoint}`);
  console.log("=".repeat(72));

  const perProvider: Record<string, Metrics | null> = {};
  for (const provider of providers) {
    perProvider[provider] = await runProvider(provider, fixtures, endpoint, timeoutMs, client);
  }

  // ── Comparison table ────────────────────────────────────────────────────────
  const cols: [string, string, FmtKind][] = [
    ["Gap Recall", "gap_recall", "pct2"],
    ["Gap Faithfulness", "gap_faithfulness", "f3"],
    ["Schema Compliance", "schema_compliance_rate", "pct2"],
    ["p95 Latency (s)", "p95_latency_s", "f1"],
    ["Avg Cost (USD)", "avg_cost_usd", "f4"],
  ];

  console.log("\n" + "=".repeat(72));
  console.log("  Comparison");
  console.log("=".repeat(72));
  const header = "Metric".padEnd(22) + providers.map((p) => p.padEnd(20)).join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const [label, key, kind] of cols) {
    const row =
      label.padEnd(22) + providers.map((p) => fmt(perProvider[p], key, kind).padEnd(20)).join("");
    console.log(row);
  }
  console.log("=".repeat(72));

  // ── CSV ──────────────────────────────────────────────────────────────────────
  const outPath = resolve(EVAL_DIR, "model_comparison.csv");
  const csvRows: string[][] = [["metric", ...providers]];
  for (const [label, key, kind] of cols) {
    csvRows.push([label, ...providers.map((p) => fmt(perProvider[p], key, kind))]);
  }
  writeCsvRows(outPath, csvRows);
  console.log(`\nComparison written to: ${outPath}`);

  const skipped = Object.entries(perProvider)
    .filter(([, m]) => m === null)
    .map(([p]) => p);
  if (skipped.length) {
    console.log(`Note: skipped providers (no key): ${skipped.join(", ")}`);
  }

  return 0;
}

const INVOKED_DIRECTLY = process.argv[1] === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
