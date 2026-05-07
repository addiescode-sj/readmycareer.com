```markdown
# readmycareer.com — Agent Guidelines

## Project Overview

readmycareer.com is an AI career coaching service that analyzes user resumes against a user-provided job description (JD) to identify gaps, generate weekly career plans, and support chat Q&A.

## Architecture

```text
[User]
   │ Upload Resume + Enter Target Role/Company + Paste JD Text
   ▼
mcp-skills/pdf-word-to-json          → ResumeJson
   │
   ├─► GapAnalyzerAgent              → GapAnalysisOutput
   │
   ├─► PlannerAgent                  → CareerPlanOutput
   │
   └─► ChatQnAAgent                  → ChatQnAOutput
```

## Context Window Optimization (Gemini CLI Agent Skills)

Following the [Gemini CLI Agent Skills](https://geminicli.com/docs/cli/skills/) guidelines, detailed responsibilities, I/O specifications, and coding standards for individual agents and MCP skills have been extracted into specialized Agent Skills. This uses **Progressive Disclosure** to keep the global context window lightweight and save tokens.

When you need to develop or modify specific components, Gemini CLI will automatically activate the relevant skill:
- **GapAnalyzerAgent**: Uses `gap-analyzer-dev` skill
- **PlannerAgent**: Uses `planner-dev` skill
- **ChatQnAAgent**: Uses `chat-qna-dev` skill
- **MCP Skills**: Uses `mcp-skills-dev` skill

*(These skills are located in the `.agents/skills/` directory)*

## General Coding Standards

- **Agent Framework**: Google ADK TypeScript (`@google/adk`)
- **Agent IDE**: Antigravity (Stitch Workflow)
- **MCP Runtime**: `@modelcontextprotocol/sdk`
- **Schema Validation**: Zod
- **Language**: TypeScript (ESM, Node 20+)
- All Agent I/O must use the type definitions in `agents/types.ts`.
- MCP skill calls must be wrapped as a `FunctionTool` and injected into the Agent.
- Data transfer between agents is performed exclusively through the ADK session state (`output_key`).
- Agents must not access the Vector DB or file system directly. Access must be routed through MCP skill tools.
- The LLM model defaults to `gemini-2.5-flash`.
```
