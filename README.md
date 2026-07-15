# readmycareer.com

> **PoC** — AI-powered career gap analysis and roadmap generator for tech professionals.

Upload your resume, paste a job description, and get a personalized week-by-week career plan built by a multi-agent AI pipeline — then generate an ATS-optimized resume once you've completed the plan.

**Live:** [readmycareer.vercel.app](https://readmycareer.vercel.app)

---

## Overview

**readmycareer.com** is a proof-of-concept application that demonstrates how a multi-agent LLM system can accelerate career transitions in the tech industry.

The system runs on a **provider-agnostic model layer**: gap analysis and resume optimization run on a reasoning-tier model (Gemini 2.5 Flash by default), while planning and chat run on a faster, cheaper tier (Gemini Flash Lite). The gap-analysis stage can be switched to OpenAI per request. All model interaction is being incrementally migrated to the **Vercel AI SDK** for streaming, structured outputs, and generative UI.

## Background & Intent

Traditional recruiting platforms and career recommendation systems rely heavily on simple keyword matching (ATS) or superficial analyses of job descriptions. Consequently, they fail to grasp the **multidimensional context of the job market**. readmycareer.com deeply analyzes the relationship between a user's resume and a specific job description, generating an organic, personalized, and highly actionable week-by-week career roadmap via a multi-agent AI system.

### Key Areas of Contextual Gaps in the Job Market

Keyword-based resume/JD matching fails to capture five critical dimensions:

1. **Technical Terminology & Stack Mismatch** — identical technologies described in different terms (`Container Orchestration` vs `Kubernetes`); no evaluation of skill transferability (AWS ECS experience → GCP Cloud Run).
2. **Hidden & Implicit Expectations** — a JD listing only "Java, Spring Boot, MySQL" carries unspoken expectations (distributed design, Redis, Kafka, CI/CD) depending on company scale and seniority.
3. **Company Stage & Culture Fit** — early-stage startups want generalists; enterprises want specialists. Plans that ignore this produce unrealistic milestones.
4. **Skill Lifecycle & Market Trends** — obsolete requirements copy-pasted from years-old templates must be deprioritized against skills actively valued today.
5. **Unstructured Progression Trajectories** — recommending Kubernetes to a candidate without Docker fundamentals creates an impractical roadmap; prerequisites matter.

To bridge these gaps, a **Pinecone RAG knowledge base** seeds the agents with industry references across four categories: skill taxonomy & tech synonyms, role & company-tier profiles, learning pathways & roadmaps, and hiring trends & interview frameworks.

---

## Features

| Feature              | Description                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Resume parsing**   | Upload PDF or DOCX; structured JSON extraction (skills, experience, education, certifications)                        |
| **Gap analysis**     | 8-phase comparison of resume vs. JD; outputs strengths, gaps (required vs. preferred), priority order, match score    |
| **Career roadmap**   | Week-by-week action plan with daily todos, milestones, and a Gantt timeline                                           |
| **AI career coach**  | Chat interface grounded in your resume, gap analysis, and career plan — with agentic RAG search and visible reasoning |
| **Resume optimizer** | After completing all checklist items, generates an ATS-optimized resume (highlights, cover letter, projects section)  |
| **Bilingual output** | All agent output respects `Accept-Language` — Korean and English supported                                            |
| **Dashboard**        | Authenticated users can save up to 3 career plans and revisit them via `/dashboard`                                   |
| **Observability**    | Per-stage telemetry (latency, tokens, cache hits, retries, cost) surfaced at `/admin/observability`                   |

---

## Architecture

```
readmycareer.com/              (pnpm monorepo)
├── app/                       Next.js frontend + API routes (SSE streaming, Vercel AI SDK)
├── agents/                    Agent orchestration layer ← runtime
│   ├── orchestrator.ts        Pipeline control flow (runCareerAnalysis, runResumeOptimizer)
│   ├── gap-analyzer/          8-phase JD vs. resume comparison (instruction exports)
│   ├── planner/               Week-by-week career plan generator (instruction exports)
│   ├── resume-optimizer/      ATS resume generation (Vercel AI SDK generateObject)
│   └── lib/
│       ├── model-adapter.ts   Provider-agnostic ModelAdapter (Gemini / OpenAI)
│       ├── models.ts          Centralized model ids (GEMINI_MODEL, GEMINI_MODEL_REASONING, OPENAI_MODEL)
│       ├── observability.ts   Per-stage telemetry, aggregated at the orchestrator boundary
│       └── mcp-client.ts      Connection-pooled MCP stdio client
├── mcp-skills/                MCP stdio subprocesses (spawned by agents/) ← runtime
│   ├── career-knowledge-base/ Pinecone RAG search over career/tech corpus
│   ├── career-plan-generator/ Structured plan JSON generation
│   ├── pdf-word-to-json/      Resume text extraction and normalization
│   └── resume-generator/      ATS resume synthesis
├── eval/                      TypeScript eval harness (@readmycareer/eval) — dev tooling
└── config/                    model-pricing.json — single source for per-token pricing
```

> `agents/` and `mcp-skills/` are the only runtime packages. `eval/`, `documents/`, and `config/` are development tooling and shared configuration.

### Agent pipeline

```
[Resume Upload]  →  pdf-word-to-json (MCP)  →  ResumeJson
[JD Paste]       →  career-knowledge-base (MCP, Pinecone RAG)  →  JdSearchResult[]
                                        ↓
                          Gap Analysis (reasoning-tier model)  →  GapAnalysisOutput
                                        ↓                          ⤷ checkpointed to career_plan_jobs
                          Planning (flash-tier model)          →  CareerPlanOutput
                                        ↓ (after all todos done)
                          Resume Optimization (reasoning-tier) →  OptimizedResumeOutput
```

- Every stage boundary is a **Zod-validated contract**.
- Each step runs inside a **quality gate loop** (up to 3 retries) validating schema compliance, plan completeness (≥3 todos/week), and date continuity before accepting a result.
- **Durable job checkpoints**: `/api/analyze` persists the gap-analysis result per run (`career_plan_jobs`); a client reconnect resumes from planning instead of re-running the full pipeline.

### Model strategy & trade-offs

All LLM calls route through a provider-agnostic `ModelAdapter` interface:

- **Gap analysis / resume optimization** → `GEMINI_MODEL_REASONING` (default `gemini-2.5-flash`) — the stages where reasoning quality dominates output quality.
- **Planning / chat** → `GEMINI_MODEL` (default `gemini-3.1-flash-lite-preview`) — latency- and cost-sensitive stages.
- **OpenAI** — gap analysis can run on OpenAI via the `provider` field on `POST /api/analyze` or `MODEL_PROVIDER`. Planning stays on Gemini to preserve the context-cache path.
- **Gemini context caching** — resume tokens cached for 1 hour to reduce repeat billing; savings are tracked in observability metrics.
- Model ids live in `agents/lib/models.ts`; per-1M-token pricing in `config/model-pricing.json` — one source of truth shared by the agent layer and the eval harness.

### Vercel AI SDK adoption (incremental, in progress)

Migration from raw provider SDKs to `ai` + `@ai-sdk/google`, done route by route and verified live end-to-end at each step:

**Done**

- `/api/chat` uses `streamText(...).toUIMessageStreamResponse()`; full conversation history sent as `ModelMessage`s via `convertToModelMessages`.
- All three chat surfaces (`AICoachChat`, `ChatInterface`, `ChatHistoryClient`) share one `useChat`-based hook and one message renderer — replacing three hand-rolled fetch + SSE-parsing implementations.
- **Generative UI**: RAG search is a `search_reference` tool the model calls agentically; tool calls and results render inline as source cards.
- **Reasoning visibility**: Gemini's thinking streams as a `reasoning` UI part (collapsible "thought process" block) via `thinkingConfig`.
- `resume-optimizer` uses `generateObject` against its Zod schema — no more manual JSON-fence-stripping.

**Pending**

- `GeminiAdapter` context-cache path (intentionally untouched until proven).
- OpenAI adapter migration.

### Observability

Structured per-stage telemetry — latency, token usage, cache hits, retries, success/failure — is emitted as JSON logs and aggregated at the orchestrator boundary (`agents/lib/observability.ts`). Per-run metrics persist to an RLS-protected `agent_runs` table (written by the API route; agents never touch the DB) and are surfaced at `/admin/observability`: avg/p95 latency, failure rate, retry rate, cache-hit rate, tokens, estimated cost, and cache-token savings. Admin access is enforced via an `is_admin` flag and RLS.

---

## Quality & Evaluation

The eval suite is a TypeScript workspace package (`@readmycareer/eval`, run with `tsx`) that reuses the **same Zod schemas as production** to validate every boundary — one source of truth from agent I/O to eval gates.

- **Agent harness** — gap-analysis **recall/precision vs. labeled gaps**, plan completeness, run-to-run **variance** (`--repeat N`), and a **regression baseline + diff** (`--save-baseline` / `--compare-baseline`).
- **RAG quality** — four RAGAS metrics reimplemented natively in TypeScript (no JS port exists), plus a **grounding/citation rate** with per-case source attribution.
- **Cross-model comparison** harness for evaluating model/provider changes before rollout.
- Ship gates are documented in `eval/QUALITY_CRITERIA.md`; each run regenerates a human-readable report at `documents/agent-eval-report.md`.

```bash
pnpm eval          # full suite
pnpm eval:agents   # agent harness only
pnpm eval:fast     # quick regression check
```

---

## Tech Stack

### Frontend

- **Next.js** (App Router) + **React**
- **Vercel AI SDK** (`@ai-sdk/react` `useChat`) — streaming chat, generative UI, reasoning display
- **Tailwind CSS** + **Framer Motion** — Synthetic Intelligence design system (shadcn/ui tokens)
- **next-intl** — i18n (English / Korean)
- **Recharts** — Gantt / progress / competency-radar visualization

### Backend / API

- **Next.js API Routes** with **SSE** for pipeline progress streaming
- **Vercel AI SDK** (`ai`, `@ai-sdk/google`) — `streamText`, `generateObject`, UI message streams
- **Supabase** (PostgreSQL + Auth + Row-Level Security) — users, career plans, chat history, job checkpoints, agent telemetry
- **pdf-parse** + **mammoth** — PDF and DOCX text extraction

### AI / Agents

- **ModelAdapter** — provider-agnostic LLM layer (Gemini + OpenAI implementations)
- **Gemini 2.5 Flash** (reasoning tier) + **Gemini Flash Lite** (fast tier) — env-overridable
- **Gemini Context Caching** — resume tokens cached to reduce repeat billing
- **MCP (Model Context Protocol)** — stdio subprocess pool for skill isolation and reuse
- **Pinecone** — integrated-inference vector index (`llama-text-embed-v2`) for RAG
- **Zod** — runtime schema validation at every agent I/O boundary, shared with the eval harness

### Tooling

- **pnpm workspaces** — monorepo package management
- **TypeScript 5** across all packages, including the eval harness
- **Playwright** — end-to-end testing

---

## Roadmap

### Near-term

- **LangSmith tracing** — full distributed traces per pipeline run, beyond the in-house telemetry.
- **Orchestration framework evaluation** — LangGraph / Mastra for graph-based state management, retries, and branching as first-class primitives.
- **Complete the Vercel AI SDK migration** — context-cache path and OpenAI adapter.

### Medium-term

- **User profile & progress tracking** — persist skill growth and milestones across sessions for a longitudinal career profile.
- **Career plan refinement** — incorporate plan history and actual completion rates into subsequent plans.

### Long-term

- **Practical learning resource recommendations** — courses, projects, and open-source contributions tailored to identified gaps.
- **Multimodal resume input** — richer extraction from visual or image-heavy resumes and portfolios.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- A Supabase project
- A Google AI / Gemini API key (and optionally an OpenAI API key)
- A Pinecone API key and integrated-inference index

### Environment variables

Create `app/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GOOGLE_API_KEY=
OPENAI_API_KEY=            # optional — enables provider switching for gap analysis
PINECONE_API_KEY=
PINECONE_INDEX_NAME=
GEMINI_MODEL=              # optional override, default flash-lite
GEMINI_MODEL_REASONING=    # optional override, default gemini-2.5-flash
MODEL_PROVIDER=            # optional, "gemini" (default) | "openai"
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

---

## License

Private repository. All rights reserved.
