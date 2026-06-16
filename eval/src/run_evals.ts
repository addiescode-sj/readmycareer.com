// Integrated Eval Execution (run_evals.ts)
// ========================================
//
// TypeScript port of run_evals.sh. Runs the RAG eval (ragas_eval.ts) and the agent
// harness (agent_harness.ts) in-process and prints a combined PASS/FAIL summary.
//
// Usage:
//   pnpm eval                                  # Full (RAG + Agent)
//   pnpm eval:agents      (--skip-rag)         # Skip RAG eval (Pinecone not required)
//   pnpm eval:fast        (--skip-rag --skip-llm-judge)
//
// Prerequisites:
//   - GOOGLE_API_KEY set in .env (for the agent harness LLM judge / RAG)
//   - For RAG eval: PINECONE_API_KEY, PINECONE_INDEX_NAME
//   - Before the agent harness: the dev server must be running (pnpm dev)

import { fileURLToPath } from "node:url";
import { loadRootEnv } from "./lib/env";
import { hasFlag, getOption } from "./lib/args";
import { main as agentMain } from "./agent_harness";
import { main as ragasMain } from "./ragas_eval";

loadRootEnv();

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

async function serverResponding(baseUrl: string): Promise<boolean> {
  for (const endpoint of [`${baseUrl}/api/analyze`, baseUrl]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const resp = await fetch(endpoint, { signal: controller.signal });
        if (resp.ok) return true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // try next endpoint
    }
  }
  return false;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const skipRag = hasFlag(argv, "--skip-rag");
  const skipLlmJudge = hasFlag(argv, "--skip-llm-judge");
  const baseUrl = getOption(argv, "--base-url", "http://localhost:3000");

  console.log("=".repeat(72));
  console.log("  readmycareer.com — Evaluation Suite");
  console.log(`  ${timestamp()}`);
  console.log(`  Options: skip-rag=${skipRag}, skip-llm-judge=${skipLlmJudge}`);
  console.log("=".repeat(72));

  let exitRag = 0;
  let exitAgent = 0;

  // ── [1/2] RAG Retrieval Quality ─────────────────────────────────────────────
  if (!skipRag) {
    console.log("");
    console.log("─".repeat(68));
    console.log("  [1/2] RAG Retrieval Quality Evaluation (ragas_eval.ts)");
    console.log("─".repeat(68));
    try {
      exitRag = await ragasMain();
    } catch (exc) {
      console.error(`  RAG eval crashed: ${(exc as Error).message}`);
      exitRag = 1;
    }
    console.log("");
    console.log(exitRag === 0 ? "  [1/2] RAG eval: PASS" : `  [1/2] RAG eval: FAIL (exit ${exitRag})`);
  } else {
    console.log("");
    console.log("  [1/2] RAG eval skipped (--skip-rag)");
    exitRag = 0;
  }

  // ── [2/2] Agent Output Quality ──────────────────────────────────────────────
  console.log("");
  console.log("─".repeat(68));
  console.log("  [2/2] Agent Output Quality Evaluation (agent_harness.ts)");
  console.log("─".repeat(68));

  if (!(await serverResponding(baseUrl))) {
    console.log(`  WARNING: Server is not responding at (${baseUrl})`);
    console.log("           Please run 'pnpm dev' first and try again.");
    console.log("  [2/2] Agent eval: SKIP (Server not running)");
    exitAgent = 1;
  } else {
    const harnessArgs = ["--base-url", baseUrl];
    if (skipLlmJudge) harnessArgs.push("--skip-llm-judge");
    try {
      exitAgent = await agentMain(harnessArgs);
    } catch (exc) {
      console.error(`  Agent eval crashed: ${(exc as Error).message}`);
      exitAgent = 1;
    }
    console.log("");
    console.log(
      exitAgent === 0 ? "  [2/2] Agent eval: PASS" : `  [2/2] Agent eval: FAIL (exit ${exitAgent})`
    );
  }

  // ── Final Summary ───────────────────────────────────────────────────────────
  console.log("");
  console.log("=".repeat(72));
  console.log("  COMBINED RESULTS");
  console.log("=".repeat(72));
  const ragStatus = skipRag ? "SKIP" : exitRag === 0 ? "PASS" : "FAIL";
  console.log(`  ${"RAG Retrieval Quality (ragas_eval.ts):".padEnd(40)} ${ragStatus}`);
  console.log(
    `  ${"Agent Output Quality (agent_harness.ts):".padEnd(40)} ${exitAgent === 0 ? "PASS" : "FAIL"}`
  );
  console.log("-".repeat(72));

  let finalExit = 0;
  if (exitRag !== 0 || exitAgent !== 0) {
    finalExit = 1;
    console.log("  Overall: FAIL — One or more evaluations fell below threshold");
  } else {
    console.log("  Overall: PASS");
  }
  console.log("=".repeat(72));
  console.log("  Criteria:      eval/QUALITY_CRITERIA.md (metric definitions & thresholds)");

  return finalExit;
}

const INVOKED_DIRECTLY = process.argv[1] === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  main().then((code) => process.exit(code));
}
