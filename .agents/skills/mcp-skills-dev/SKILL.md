# MCP Skills Development

This skill provides specialized context for developing or modifying MCP skills in the readmycareer.com project.

## Responsibilities
Provides specific tools (capabilities) to the Agents as independent MCP servers utilizing JSON for primary input and output.

## Available Skills
| Skill | Location | Role | Primary Tool |
|---|---|---|---|
| `career-knowledge-base` | `mcp-skills/career-knowledge-base/` | JD/Career reference search (Vector DB) | `search` |
| `pdf-word-to-json` | `mcp-skills/pdf-word-to-json/` | Resume Parsing | `parse_resume` |
| `career-plan-generator` | `mcp-skills/career-plan-generator/` | Weekly Plan Generation | `generate_plan` |
| `resume-generator` | `mcp-skills/resume-generator/` | Markdown Resume Generation | `generate_resume` |

## Development Guidelines
- **Location**: `mcp-skills/<name>/src/index.ts`
- **Execution**: Run `npm run dev` in the skill directory via `tsx`.
- **Implementation Rules**: Replace `throw new Error("NOT_IMPLEMENTED: ...")` with actual code implementation.
- **Shared Schemas**: Schemas like `ResumeJsonSchema` are shared between skills.
