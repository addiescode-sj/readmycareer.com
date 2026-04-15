```markdown
# readmycareer.com — Agent Guidelines

## Project Overview

readmycareer.com is an AI career coaching service that analyzes user resumes against a user-provided job description (JD) to identify gaps, generate weekly career plans, and support chat Q&A.

## Architecture

```
[User]
   │ Upload Resume + Enter Target Role/Company + Paste JD Text
   ▼
mcp-skills/pdf-word-to-json          → ResumeJson
   │
   ├─────────────────────────────────────────────────────────────────────────┐
   │ (JD text pasted directly by user — used for precise gap analysis)       │
   │                                                                         ▼
   │                              mcp-skills/career-knowledge-base  → ReferenceResult[]
   │                              (doc_type: "reference" — career trends,    │
   │                               industry info, current IT trends)          │
   ▼                                                                         │
agents/GapAnalyzerAgent              → GapAnalysisOutput  (session.gap_analysis)
   │                                                                         │
   └─────────────────────────────────────────────────────────────────────────┘
   ▼
agents/PlannerAgent                  → CareerPlanOutput   (session.career_plan)
   │
   ▼
agents/ChatQnAAgent                  → ChatQnAOutput      (session.chat_history)
```

## Sub-Agent Roles

| Agent | Input | Output | Session Key |
|---|---|---|---|
| GapAnalyzerAgent | resume_json, jd_text | Strengths/Gaps + Priority JSON | `gap_analysis` |
| PlannerAgent | gap_analysis, reference_results, duration_weeks, start_date | Weekly Plan + Gantt JSON | `career_plan` |
| ChatQnAAgent | user_message + Session Context | Answer + Sources + Follow-up Qs | `chat_history` |

## Coding Standards

- All Agent I/O must use the type definitions in `agents/types.ts`.
- MCP skill calls must be wrapped as a `FunctionTool` and injected into the Agent.
- Data transfer between agents is performed exclusively through the ADK session state (`output_key`).
- Before implementation, all tool execution blocks must be marked with `throw new Error("NOT_IMPLEMENTED: ...")`.

## MCP Skills

| Skill | Location | Role |
|---|---|---|
| career-knowledge-base | mcp-skills/career-knowledge-base/ | Career trend / industry reference search (doc_type: "reference") |
| pdf-word-to-json | mcp-skills/pdf-word-to-json/ | Resume Parsing |
| career-plan-generator | mcp-skills/career-plan-generator/ | Weekly Plan Generation |
| resume-generator | mcp-skills/resume-generator/ | Markdown Resume Generation |

## JD Input Strategy

- **Gap Analysis**: Uses raw JD text pasted by the user (`jdText`). No vector search is involved in this step, ensuring the analysis is always based on the exact job the user is targeting.
- **Career Planning**: Supplements the plan with career trend and industry reference documents retrieved from the Vector DB (`doc_type: "reference"`). These are fetched via the hybrid search (dense + BM25 + reranking) pipeline in `mcp-skills/career-knowledge-base`.
- **Hybrid Search Structure**: The underlying Pinecone hybrid search in `mcp-skills/career-knowledge-base/src/lib/rag.ts` is unchanged. The `doc_type` filter at the call site determines whether JD or reference documents are retrieved.

## Tech Stack

- **Agent Framework**: Google ADK TypeScript (`@google/adk`)
- **Agent IDE**: Antigravity (Stitch Workflow)
- **MCP Runtime**: `@modelcontextprotocol/sdk`
- **Schema Validation**: Zod
- **Language**: TypeScript (ESM, Node 20+)

## File Conventions

- Agent Implementation: `agents/<name>/index.ts`
- Agent YAML Config: `.antigravity/agents/<name>.yaml`
- Workflow YAML: `.antigravity/workflows/<name>.yaml`
- MCP Skill: `mcp-skills/<name>/src/index.ts`
- Common Types: `agents/types.ts`

## Restrictions

- Agents must not access the Vector DB or file system directly. Access must be routed through MCP skill tools.
- The LLM model defaults to `gemini-2.5-flash`.
- Use only the `SESSION_KEYS` constants (`agents/types.ts`) for session state keys.
```
