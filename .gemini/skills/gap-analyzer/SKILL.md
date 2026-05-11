---
name: gap-analyzer
description: Expertise in developing and modifying the GapAnalyzerAgent. Use when the user asks to update, debug, extend, or fix the gap analysis logic, chain-of-thought prompt phases, GapAnalysisOutput schema, quality gate thresholds, or locale enforcement behavior in agents/gap-analyzer/.
---

# Gap Analyzer Agent

## Responsibilities

Compares the user's resume JSON against a raw job description (JD) to produce a structured gap analysis: confirmed strengths, skill/experience/certification gaps, a priority-ordered gap list, an overall match score (0–100), and a plain-language summary.

## I/O Specifications

- **Input**: `resumeJson` (ResumeJson — personal fields stripped via `omitPersonal()`), `jdText` (string — raw JD pasted by user), `locale` ("ko" | "en")
- **Output**: `GapAnalysisOutput` (stored in `session.gap_analysis`)
- **Location**: `agents/gap-analyzer/index.ts` — exports `getGapAnalyzerInstruction(locale)`
- **Orchestration**: Called from `agents/orchestrator.ts` → `runCareerAnalysis()` (Step 1)

## Key Design Decisions

- **Raw JD only**: Uses the user-pasted JD text directly. No vector search at this step — precise matching requires the exact text.
- **8-phase chain-of-thought prompt**: Phases are hardcoded in the system instruction. Do not reorder or merge phases.
- **Quality gate**: `validateGapAnalysis()` in `orchestrator.ts` enforces required fields and valid enum values. Retries up to `MAX_QUALITY_RETRIES = 2` on failure.
- **Locale directive placement**: The `langDirective` is injected at the top of every user prompt (before JD text) so the model's language instruction takes precedence over JD language.

## Valid Schema Constraints

- `category`: exactly one of `{"skill", "experience", "certification", "portfolio", "keyword"}`
- `priority`: exactly one of `{"high", "medium", "low"}` in lowercase
- `overall_match_score`: integer 0–100
- `gaps`: array with ≥ 1 item; each item must have `id`, `category`, `priority`, `rationale`

## Data Transfer Rules

- Always use types from `agents/types.ts` (`GapAnalysisOutput`, `ResumeJson`, `SESSION_KEYS`)
- Personal contact info must be stripped before passing resume to this agent — use `omitPersonal()` from `agents/types.ts`
- Never access Pinecone, Supabase, or the file system directly from this agent
