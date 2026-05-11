---
name: mcp-skills
description: Expertise in developing and modifying MCP skill servers in mcp-skills/. Use when the user asks to add, update, or debug any of the MCP stdio subprocesses — career-knowledge-base, career-plan-generator, pdf-word-to-json, or resume-generator.
---

# MCP Skills

## Overview

Each MCP skill is a standalone Node.js stdio server that exposes one or more tools to the agent layer via the Model Context Protocol. Skills are spawned and pooled by `agents/lib/mcp-client.ts`.

## Available Skills

| Skill | Location | Primary Tool | Role |
|---|---|---|---|
| `career-knowledge-base` | `mcp-skills/career-knowledge-base/` | `search` | Pinecone RAG search over career/tech corpus |
| `pdf-word-to-json` | `mcp-skills/pdf-word-to-json/` | `parse_resume` | PDF/DOCX text extraction + structured JSON |
| `career-plan-generator` | `mcp-skills/career-plan-generator/` | `generate_plan` | Weekly career plan JSON generation |
| `resume-generator` | `mcp-skills/resume-generator/` | `generate_resume` | ATS resume generation via Gemini |

## Development Rules

- **Entry point**: `mcp-skills/<name>/src/index.ts` — must start a `StdioServerTransport` and call `server.connect(transport)` at the top level
- **Build**: Run `npm run build` inside the skill directory after any source change. Output goes to `dist/` (gitignored — must rebuild locally)
- **Dev run**: `npm run dev` via `tsx` for local testing without a full build
- **Schema sharing**: Use Zod schemas defined in the skill's own `src/index.ts`. Cross-skill schema reuse should go through `agents/types.ts`
- **Connection pool**: Skills are registered in `agents/lib/mcp-client.ts` under `SKILL_PATHS`. Path is resolved from `agents/dist/lib/` using `../../../mcp-skills/<name>/dist/index.js`

## Adding a New Skill

1. Create `mcp-skills/<name>/src/index.ts` with `McpServer` and `StdioServerTransport`
2. Add `package.json` with `"type": "module"`, `"main": "dist/index.js"`, and build/dev scripts
3. Register the skill path in `SKILL_PATHS` in `agents/lib/mcp-client.ts`
4. Rebuild agents: `npm run build` in `agents/`
5. Add a corresponding skill doc in `.gemini/skills/<name>/SKILL.md`

## Environment Variables

All skills inherit `process.env` from the parent agent process. Required vars per skill:

- `career-knowledge-base`: `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`
- `resume-generator`: `GOOGLE_API_KEY` or `GEMINI_API_KEY`
- `pdf-word-to-json`: none (pure parsing, no external APIs)
- `career-plan-generator`: `GOOGLE_API_KEY` or `GEMINI_API_KEY`
