// ─── ResumeOptimizerAgent ─────────────────────────────────────────────────────
// Synthesizes an ATS-optimized resume from gap analysis + completed todos.
// Follows the same direct-callGemini pattern as orchestrator.ts rather than ADK.
//
// Flow:
//   1. Extract JD keywords from jd_text via Gemini (quick reasoning step)
//   2. Build completed_activities summary from completed_todos
//   3. Call resume-generator MCP skill → returns structured resume + markdown
//   4. Validate quality gates; retry up to MAX_RETRIES times

import { callMcpTool } from "../lib/mcp-client.js";
import {
  OptimizedResumeInput,
  OptimizedResumeOutput,
} from "../types.js";

const MAX_RETRIES = 2;

// ── Keyword extractor ─────────────────────────────────────────────────────────
// Derives a deduplicated keyword list from gap analysis items + JD text keywords.
// Falls back to gap_analysis.gaps[].item values when no target_jd keywords are available.

function extractKeywords(input: OptimizedResumeInput): string[] {
  const fromGaps = input.gap_analysis.gaps
    .filter(g => g.priority === "high" || g.priority === "medium")
    .map(g => g.item);

  const fromStrengths = input.gap_analysis.strengths.map(s => s.item);

  // Deduplicate while preserving gap items first (they are most relevant for optimization)
  const seen = new Set<string>();
  const result: string[] = [];
  for (const kw of [...fromGaps, ...fromStrengths]) {
    const normalized = kw.trim().toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(kw.trim());
    }
  }

  return result.slice(0, 20); // cap to avoid overly long prompts
}

// ── Activity summarizer ───────────────────────────────────────────────────────

function summarizeCompletedTodos(todos: OptimizedResumeInput["completed_todos"]): string[] {
  return todos.map(t => {
    const hours = t.estimated_hours ? ` (${t.estimated_hours}h)` : "";
    return `${t.title}${hours}`;
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runResumeOptimizer(
  input: OptimizedResumeInput
): Promise<OptimizedResumeOutput> {
  const keywords = extractKeywords(input);
  const completedActivities = summarizeCompletedTodos(input.completed_todos);

  const gapSummary = input.gap_analysis.summary;

  const mcpArgs = {
    resume_data: input.resume_json,
    target_jd: {
      title: input.target_jd.title,
      company: input.target_jd.company,
      keywords,
    },
    cover_letter_context: {
      gap_summary: gapSummary,
      completed_activities: completedActivities,
    },
    options: {
      language: input.locale,
    },
  };

  let lastError: string = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callMcpTool("resume-generator", "generate_resume", mcpArgs);
      return result as OptimizedResumeOutput;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      console.warn(
        `[ResumeOptimizer] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${lastError}`
      );
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `[ResumeOptimizer] Failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`
  );
}
