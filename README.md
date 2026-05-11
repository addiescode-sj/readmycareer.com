# readmycareer.com

> **PoC** — AI-powered career gap analysis and roadmap generator for tech professionals.

Upload your resume, paste a job description, and get a personalized week-by-week career plan built by a multi-agent AI pipeline — then generate an ATS-optimized resume once you've completed the plan.

---

## Overview

**readmycareer.com** is a proof-of-concept application that demonstrates how a multi-agent LLM system can accelerate career transitions in the tech industry.

The base model is **Gemini 3.1 Flash Lite** (free tier). This model was chosen with Gemini's multimodal generation capabilities in mind as a foundation for future enhancements — richer resume parsing, visual portfolio analysis, and document generation.

Because raw job descriptions often lack the full context needed to accurately assess a candidate's readiness, the system integrates a **Pinecone RAG vector database** seeded with career and tech industry knowledge. This supplementary context gives the agents a more grounded view of role requirements, typical skill progressions, and hiring patterns — beyond what's explicitly written in any single JD.

**Current version: `v0.4.0`**

---

## Features

| Feature | Description |
|---|---|
| **Resume parsing** | Upload PDF or DOCX; Gemini extracts structured JSON (skills, experience, education, certifications) |
| **Gap analysis** | Multi-phase comparison of resume vs. JD; outputs strengths, gaps, priority order, and a match score |
| **Career roadmap** | Week-by-week action plan with daily todos, milestones, and a Gantt timeline |
| **AI career coach** | Floating chat interface grounded in your resume, gap analysis, and career plan |
| **Resume optimizer** | After completing all checklist items, generates an ATS-optimized resume (highlights, cover letter, skills flat-list) |
| **Bilingual output** | All agent output respects `Accept-Language` — Korean and English supported |
| **Dashboard** | Authenticated users can save up to 3 career plans and revisit them via `/dashboard` |

---

## Architecture

```
readmycareer.com/              (pnpm monorepo)
├── app/                       Next.js 14 frontend + API routes
├── agents/                    Multi-agent orchestration layer (Google ADK) ← runtime
│   ├── gap-analyzer/          Phase-by-phase JD vs. resume comparison
│   ├── planner/               Week-by-week career plan generator
│   ├── chat-qna/              Context-aware career coach
│   ├── resume-optimizer/      ATS resume generation from completed plan
│   ├── lib/mcp-client.ts      Connection-pooled MCP stdio client
│   └── orchestrator.ts        Public API surface (runCareerAnalysis, runChatQnA, runResumeOptimizer)
└── mcp-skills/                MCP stdio subprocesses (spawned by agents/) ← runtime
    ├── career-knowledge-base/ Pinecone RAG search over career/tech corpus
    ├── career-plan-generator/ Structured plan JSON generation
    ├── pdf-word-to-json/      Resume text extraction and normalization
    └── resume-generator/      Gemini-powered ATS resume synthesis
```

> `agents/` and `mcp-skills/` are the only runtime packages. All other root-level directories (`eval/`, `documents/`) are development tooling and documentation.

### Agent pipeline

```
[Resume Upload]  →  pdf-word-to-json (MCP)  →  ResumeJson
[JD Paste]       →  career-knowledge-base (MCP, Pinecone RAG)  →  JdSearchResult[]
                                        ↓
                          GapAnalyzerAgent  →  GapAnalysisOutput
                                        ↓
                            PlannerAgent    →  CareerPlanOutput
                                        ↓ (after all todos done)
                       ResumeOptimizerAgent →  OptimizedResumeOutput
```

Each step runs inside a **quality gate loop** (up to 3 retries) that validates schema compliance, plan completeness (≥3 todos/week), and date continuity before accepting a result.

---

## Tech Stack

### Frontend
- **Next.js 14** (App Router) + **React 18**
- **Tailwind CSS** + **Framer Motion** — Synthetic Intelligence design system
- **next-intl** — i18n (English / Korean)
- **Recharts** — Gantt / progress visualization
- **react-markdown** — Markdown rendering for resume and plan output

### Backend / API
- **Next.js API Routes** with **Server-Sent Events (SSE)** for streaming progress
- **Supabase** (PostgreSQL + Auth + Row-Level Security) — user auth, career plans, chat history, optimized resumes
- **pdf-parse** + **mammoth** — PDF and DOCX text extraction

### AI / Agents
- **Google Gemini 3.1 Flash Lite Preview** — base LLM for all agents and MCP skills
- **Google ADK (`@google/adk`)** — multi-agent runner with `InMemorySessionService`
- **Gemini Context Caching** — resume tokens cached for 1 hour to reduce repeat billing
- **MCP (Model Context Protocol)** — stdio subprocess pool for skill isolation and reuse
- **Pinecone** — vector database for career/tech industry RAG context
- **Zod** — runtime schema validation at every agent I/O boundary

### Tooling
- **pnpm workspaces** — monorepo package management
- **TypeScript 5** across all packages
- **Playwright** — end-to-end testing

---

## Roadmap

### Near-term
- **Hyperparameter tuning** — optimize temperature, topP, and max tokens per agent for better output consistency and quality
- **RAG-augmented gap assessment** — when a JD omits explicit skill requirements, use the Pinecone corpus to infer expected competencies for the role level and company tier, improving capability radar accuracy

### Medium-term
- **User profile & progress tracking** — persist skill growth, completed resources, and plan milestones across sessions to build a longitudinal career profile
- **Career plan refinement** — incorporate previous plan history and actual completion rates to produce more realistic and personalized next plans

### Long-term
- **Practical learning resource recommendations** — surface specific courses, projects, and open-source contributions tailored to identified gaps and the user's current level
- **Multimodal resume input** — leverage Gemini's multimodal capabilities for richer extraction from visual or image-heavy resumes and portfolios

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- A Supabase project
- A Google AI / Gemini API key
- A Pinecone API key and index

### Environment variables

Create `app/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GOOGLE_API_KEY=
PINECONE_API_KEY=
PINECONE_INDEX_NAME=
```

### Install and run

```bash
pnpm install

# Build all packages (agents + mcp-skills)
pnpm build

# Start the dev server
pnpm dev
```

The app will be available at `http://localhost:3000`.

> **Note:** After any source change in `agents/` or `mcp-skills/`, re-run `pnpm build` and restart the dev server. The `dist/` directories are gitignored and must be rebuilt locally.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

**Latest: [v0.4.0](https://github.com/addiescode-sj/readmycareer.com/releases/tag/v0.4.0)** — Gemini Resume Optimizer

---

## License

Private repository. All rights reserved.
