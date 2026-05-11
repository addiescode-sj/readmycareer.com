# readmycareer.com — Agent Guidelines

## Project Overview

readmycareer.com is an AI career coaching service. Users upload a resume and paste a job description to receive a personalized gap analysis, a week-by-week career roadmap, an AI career coach chat, and — once all checklist items are complete — an ATS-optimized resume.

## Architecture

```
[User]
   │  Upload resume (PDF/DOCX) + paste JD text + enter target role/company
   ▼
/api/resume  →  mcp-skills/pdf-word-to-json  →  ResumeJson
/api/analyze →  career-knowledge-base (Pinecone RAG)  →  JdSearchResult[]
                         │
                         ▼
              agents/orchestrator.ts :: runCareerAnalysis()
                         │
                  ┌──────┴──────┐
                  ▼             ▼
          GapAnalyzerAgent   (Step 1) → GapAnalysisOutput
                  │
                  ▼
            PlannerAgent    (Step 2) → CareerPlanOutput
                  │
             [saved to Supabase: career_plans, gap_analyses, roadmaps]
                  │
                  ▼ (user completes all todos)
       ResumeOptimizerAgent (Step 3) → OptimizedResumeOutput
                  │
             [saved to Supabase: optimized_resumes]

[Chat]  →  ChatQnAAgent  →  ChatQnAOutput  (stateful, per-session)
```

Each step runs inside a **quality gate loop** (up to `MAX_QUALITY_RETRIES = 2`) that validates schema compliance and plan completeness before accepting a result.

## Workspace Skills (Progressive Disclosure)

Detailed I/O specs, constraints, and architecture notes for each agent and MCP skill are packaged as [Gemini CLI workspace skills](https://geminicli.com/docs/cli/skills/) in `.gemini/skills/`. The global context (this file) stays lightweight; detailed context is injected only when needed.

| Skill | Activates when working on |
|---|---|
| `.gemini/skills/gap-analyzer/` | `agents/gap-analyzer/index.ts` |
| `.gemini/skills/planner/` | `agents/planner/index.ts` |
| `.gemini/skills/chat-qna/` | `agents/chat-qna/index.ts` |
| `.gemini/skills/resume-optimizer/` | `agents/resume-optimizer/index.ts` |
| `.gemini/skills/mcp-skills/` | `mcp-skills/*/src/index.ts` |

## Coding Standards

- **Agent framework**: Google ADK TypeScript (`@google/adk`)
- **MCP runtime**: `@modelcontextprotocol/sdk`
- **Schema validation**: Zod at every agent I/O boundary
- **Language**: TypeScript ESM, Node ≥ 20
- **LLM model**: `gemini-3.1-flash-lite-preview` (all agents and MCP skills)
- All agent I/O types must be defined in `agents/types.ts`
- MCP skills are called via `callMcpTool()` in `agents/lib/mcp-client.ts` — never spawned directly
- Agents must not access Supabase, Pinecone, or the file system directly; all external access goes through MCP tool calls or is handled in the API route layer
- DB operations (fetching inputs, storing results) happen in `app/src/app/api/` routes, not inside agents
