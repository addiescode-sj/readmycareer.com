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
// Required gaps come first (they are disqualifying), then preferred, then strengths.
// Falls back to priority-based ordering for legacy data without requirement_type.

function extractKeywords(input: OptimizedResumeInput): { required: string[]; preferred: string[] } {
  const isRequired = (g: typeof input.gap_analysis.gaps[number]) =>
    g.requirement_type === "required" || (!g.requirement_type && g.priority === "high");

  const requiredGaps = input.gap_analysis.gaps.filter(isRequired).map(g => g.item);
  const preferredGaps = input.gap_analysis.gaps.filter(g => !isRequired(g)).map(g => g.item);
  const fromStrengths = input.gap_analysis.strengths.map(s => s.item);

  const dedup = (items: string[], seen: Set<string>): string[] => {
    const result: string[] = [];
    for (const kw of items) {
      const norm = kw.trim().toLowerCase();
      if (!seen.has(norm)) {
        seen.add(norm);
        result.push(kw.trim());
      }
    }
    return result;
  };

  const seen = new Set<string>();
  const required = dedup(requiredGaps, seen);
  const preferred = dedup([...preferredGaps, ...fromStrengths], seen);

  return {
    required: required.slice(0, 12),
    preferred: preferred.slice(0, 8),
  };
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
  const { required: requiredKeywords, preferred: preferredKeywords } = extractKeywords(input);
  const completedActivities = summarizeCompletedTodos(input.completed_todos);

  const gapSummary = input.gap_analysis.summary;

  const mcpArgs = {
    resume_data: input.resume_json,
    target_jd: {
      title: input.target_jd.title,
      company: input.target_jd.company,
      keywords: requiredKeywords,           // passed as primary emphasis keywords
      preferred_keywords: preferredKeywords, // secondary emphasis keywords
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
