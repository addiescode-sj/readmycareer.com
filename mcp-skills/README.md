# readmycareer MCP Skills

This is a collection of MCP (Model Context Protocol) skills that compose the readmycareer.com service. Each skill operates as an independent MCP server and utilizes JSON for primary input and output.

## Skill List

| Skill | Role | Primary Tool |
|---|---|---|
| `career-knowledge-base` | Searches JD/career reference documents in RAG Vector DB | `search` |
| `pdf-word-to-json` | Converts PDF/Word resumes into structured JSON | `parse_resume` |
| `career-plan-generator` | Converts Gap analysis results into weekly plans + Timeline JSON | `generate_plan` |
| `resume-generator` | Converts resume JSON into JD-optimized Markdown resumes | `generate_resume` |

## Data Flow

```
[User Upload]
      │
      ▼
pdf-word-to-json ──► ResumeJson
      │
      ├─► career-knowledge-base (JD Search) ──► Gap Analysis (External Logic)
      │
      ├─► career-plan-generator ──► WeeklyPlan + TimelineJson
      │
      └─► resume-generator ──► Markdown Resume
```

## Development Environment

```bash
# In each skill directory
npm install
npm run dev    # Direct execution via tsx
npm run build  # TypeScript build
```

## Implementation TODO

In each skill's `src/index.ts` file, replace the `throw new Error("NOT_IMPLEMENTED: ...")` sections with actual implementation. For detailed guidance, refer to the `TODO` comments within each file.

## Shared Schemas

The `ResumeJsonSchema` from `pdf-word-to-json` is shared and used by `resume-generator`. Once these skills stabilize, it is recommended to separate them into a shared package named `@readmycareer/schemas`.