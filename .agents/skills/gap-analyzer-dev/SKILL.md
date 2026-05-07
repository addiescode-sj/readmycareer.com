# Gap Analyzer Agent Development

This skill provides the specialized context for developing or modifying the `GapAnalyzerAgent` in the readmycareer.com project.

## Responsibilities
Analyzes user resumes against a user-provided job description (JD) to identify strengths, gaps, and generate a priority list.

## I/O Specifications
- **Input**: `resume_json` (ResumeJsonForAnalysis), `jd_text` (string)
- **Output**: `GapAnalysisOutput` (stored in `session.gap_analysis`)
- **Location**: `agents/gap-analyzer/index.ts`
- **Config**: `.antigravity/agents/gap-analyzer.yaml`

## Guidelines
- **JD Input Strategy**: Uses raw JD text pasted by the user (`jd_text`). No vector search is involved in this step to ensure precise matching.
- **Data Transfer**: Always use `agents/types.ts` for schemas and `SESSION_KEYS` for state management.
- **Dependencies**: Must not access Vector DB or file system directly. Uses MCP tools.
