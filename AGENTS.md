```markdown
# readmycareer.com — Agent Guidelines

## Project Overview

readmycareer.com is an AI career coaching service that analyzes user resumes to identify JD-based gaps, providing weekly career plans and chat Q&A.

## Architecture

```
[User]
   │ Upload Resume + Input Target JD
   ▼
mcp-skills/pdf-word-to-json          → ResumeJson
mcp-skills/career-knowledge-base     → JdSearchResult[]
   │
   ▼
agents/GapAnalyzerAgent              → GapAnalysisOutput  (session.gap_analysis)
   │
   ▼
agents/PlannerAgent                  → CareerPlanOutput   (session.career_plan)
   │
   ▼
agents/ChatQnAAgent                  → ChatQnAOutput      (session.chat_history)
```

## Sub-Agent Roles

| Agent | Input | Output | Session Key |
|---|---|---|---|
| GapAnalyzerAgent | resume_json, jd_search_results | Strengths/Gaps + Priority JSON | `gap_analysis` |
| PlannerAgent | gap_analysis, duration_weeks, start_date | Weekly Plan + Gantt JSON | `career_plan` |
| ChatQnAAgent | user_message + Session Context | Answer + Sources + Follow-up Qs | `chat_history` |

## Coding Standards

- All Agent I/O must use the type definitions in `agents/types.ts`.
- MCP skill calls must be wrapped as a `FunctionTool` and injected into the Agent.
- Data transfer between agents is performed exclusively through the ADK session state (`output_key`).
- Before implementation, all tool execution blocks must be marked with `throw new Error("NOT_IMPLEMENTED: ...")`.

## MCP Skills

| Skill | Location | Role |
|---|---|---|
| career-knowledge-base | mcp-skills/career-knowledge-base/ | JD/Reference RAG Search |
| pdf-word-to-json | mcp-skills/pdf-word-to-json/ | Resume Parsing |
| career-plan-generator | mcp-skills/career-plan-generator/ | Weekly Plan Generation |
| resume-generator | mcp-skills/resume-generator/ | Markdown Resume Generation |

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
- The LLM model defaults to `gemini-2.0-flash`.
- Use only the `SESSION_KEYS` constants (`agents/types.ts`) for session state keys.
```