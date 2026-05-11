# Resume Optimizer Agent Development

This skill provides specialized context for developing or modifying the `ResumeOptimizerAgent` in the readmycareer.com project.

## Responsibilities

Generates an ATS-optimized resume artifact from the user's resume JSON, completed gap-analysis findings, and career plan progress. The output follows a fixed template: personal info, key highlights (max 5 bullets), key skills, education, awards/certifications, and a 5-6 sentence cover letter.

## I/O Specifications

- **Input**: `OptimizedResumeInput` from `agents/types.ts`
  - `resume_json` (ResumeJson — full, with personal info)
  - `gap_analysis` (GapAnalysisOutput)
  - `completed_todos` (TodoItem[] where done=true)
  - `target_jd` (title, company, jd_text)
  - `locale` ("ko" | "en")
- **Output**: `OptimizedResumeOutput` (stored in `session.optimized_resume`)
  - `resume_data`: structured sections (OptimizedResumeData)
  - `markdown`: full ATS-friendly Markdown
  - `meta`: { generated_at, language, keywords_applied }
- **Location**: `agents/resume-optimizer/index.ts`
- **Eval**: `agents/resume-optimizer/eval.ts`

## Architecture

The agent bypasses ADK and calls the `resume-generator` MCP skill directly via `callMcpTool()`, following the same pattern as `runCareerAnalysis()` in `agents/orchestrator.ts`.

Flow:
1. Extract JD keywords from `gap_analysis.gaps` and `gap_analysis.strengths`
2. Summarize `completed_todos` into activity strings
3. Call `callMcpTool("resume-generator", "generate_resume", args)` via `mcp-client.ts`
4. The MCP skill invokes Gemini (`gemini-2.5-flash-preview-05-20`) to generate the resume
5. Retry up to `MAX_RETRIES = 2` on failure

## MCP Skill Dependency

- **Skill**: `resume-generator` (`mcp-skills/resume-generator/src/index.ts`)
- **Tool**: `generate_resume`
- **Input shape**: `GenerateInputSchema` (resume_data, target_jd, cover_letter_context, options.language)
- Registered in `agents/lib/mcp-client.ts` under `SKILL_PATHS["resume-generator"]`

## Quality Gates (eval.ts)

| Gate | Threshold |
|------|-----------|
| highlights count | 3 ≤ n ≤ 5 |
| cover_letter sentences | 5 ≤ n ≤ 7 |
| skills count | ≥ 3 |
| keywords_applied count | ≥ 3 |
| required sections present | personal, highlights, skills, education, awards_and_certs, cover_letter |
| markdown length | ≥ 200 chars |

## Guidelines

- **Personal info is included**: Unlike GapAnalyzerAgent (which strips personal), ResumeOptimizerAgent receives the full `ResumeJson` with personal contact info.
- **Data transfer**: Use `agents/types.ts` schemas for all I/O.
- **No direct DB access**: The agent only calls MCP tools via `callMcpTool()`. DB operations (fetching resume, gap analysis, storing result) happen in the API route (`app/src/app/api/resume-optimizer/route.ts`).
- **Locale**: Must respect `locale` field and pass it to the MCP skill as `options.language`. Korean output requires the MCP skill system instruction to enforce Korean.
- **1-per-plan constraint**: Enforced by UNIQUE constraint on `optimized_resumes.career_plan_id`. The API layer checks for existing records before calling the agent (idempotent endpoint).
