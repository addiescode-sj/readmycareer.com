---
name: resume-optimizer
description: Expertise in developing and modifying the ResumeOptimizerAgent and resume-generator MCP skill. Use when the user asks to update the ATS resume generation pipeline, resume template sections, cover letter logic, quality gates, or the Gemini prompt in agents/resume-optimizer/ or mcp-skills/resume-generator/.
---

# Resume Optimizer Agent

## Responsibilities

Generates an ATS-optimized resume artifact once the user has completed all career plan checklist items. Synthesizes the original resume JSON, gap analysis findings, and completed todo evidence into a fixed-template output: personal info → key highlights (≤5 bullets) → skills → education → awards/certs → cover letter (5–6 sentences).

## I/O Specifications

- **Input**: `OptimizedResumeInput` from `agents/types.ts`
  - `resume_json` (ResumeJson — full, **with personal info included**)
  - `gap_analysis` (GapAnalysisOutput)
  - `completed_todos` (TodoItem[] where `done === true`)
  - `target_jd` (`{ title, company, jd_text }`)
  - `locale` ("ko" | "en")
- **Output**: `OptimizedResumeOutput`
  - `resume_data`: structured sections (`OptimizedResumeData`)
  - `markdown`: full ATS-friendly Markdown string
  - `meta`: `{ generated_at, language, keywords_applied }`
- **Location**: `agents/resume-optimizer/index.ts`
- **Orchestration**: Exposed via `agents/orchestrator.ts` → `runResumeOptimizer()`. Called from `app/src/app/api/resume-optimizer/route.ts`.

## Architecture

Bypasses the ADK Runner and calls the `resume-generator` MCP skill directly via `callMcpTool()` from `agents/lib/mcp-client.ts`.

```
API Route → runResumeOptimizer() → callMcpTool("resume-generator", "generate_resume", args)
                                          ↓
                              mcp-skills/resume-generator/src/index.ts
                                          ↓
                              Gemini (gemini-3.1-flash-lite-preview)
```

## Quality Gates

| Gate | Threshold |
|---|---|
| `highlights` count | 3 ≤ n ≤ 5 |
| `cover_letter` sentences | 5–6 |
| `skills` count | ≥ 3 |
| `keywords_applied` count | ≥ 3 |
| Required sections present | `personal`, `highlights`, `skills`, `education`, `awards_and_certs`, `cover_letter` |
| Markdown length | ≥ 200 chars |

Retries up to `MAX_RETRIES = 2` on MCP skill failure (handled in `agents/lib/mcp-client.ts` pool).

## Key Design Decisions

- **Personal info is included**: Unlike GapAnalyzerAgent, this agent receives the full `ResumeJson` with personal contact info — needed for the resume header.
- **1-per-plan constraint**: Enforced by `UNIQUE` constraint on `optimized_resumes.career_plan_id`. The API route checks for an existing record before calling the agent (idempotent).
- **Locale must propagate**: Pass `locale` as `options.language` to the MCP skill so the system instruction enforces the correct output language.
- **MCP path resolution**: `agents/lib/mcp-client.ts` uses `../../../mcp-skills/` (3 levels from `agents/dist/lib/`) because webpack hardcodes `import.meta.url` to the `dist/` path.

## Data Transfer Rules

- Always use types from `agents/types.ts` (`OptimizedResumeInput`, `OptimizedResumeOutput`, `SESSION_KEYS.OPTIMIZED_RESUME`)
- DB operations (fetching resume/gap analysis, storing result) happen in the API route — not in the agent
- Never access Supabase or the file system directly from this agent
