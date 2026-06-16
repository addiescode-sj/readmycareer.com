# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

readmycareer.com is an AI career-coaching PoC built as a **pnpm monorepo**. A Next.js 14 (App Router) frontend talks to API routes that drive a multi-agent pipeline (Google ADK + Gemini 3.1 Flash Lite Preview). Agents call MCP stdio subprocesses for skill isolation, and use Pinecone RAG plus Supabase (Postgres + Auth + RLS) for persistence.

Pipeline: `pdf-word-to-json` (MCP) → `GapAnalyzerAgent` → `PlannerAgent` → (after todos done) `ResumeOptimizerAgent`. A separate stateful `ChatQnAAgent` powers the in-app coach. Each step runs inside a **quality gate loop** (≤ 2–3 retries) that validates Zod schemas, plan completeness (≥ 3 todos/week), and date continuity before accepting a result.

See [README.md](./README.md) and [AGENTS.md](./AGENTS.md) for canonical architecture diagrams. Per-subsystem context lives in `.gemini/skills/<name>/SKILL.md` (Gemini CLI workspace skills) — read the matching skill file before editing an agent or MCP skill.

## Repository Context

This is a **pnpm workspace** monorepo (`pnpm-workspace.yaml`). Only `agents/` and `mcp-skills/*` are runtime packages alongside `app/`; everything else is tooling or docs.

```
readmycareer.com/
├── app/                       Next.js 14 App Router frontend + API routes
│   └── src/app/
│       ├── (@chat|@goal|@plan|@upload)/   parallel route slots
│       ├── api/                            DB + agent entry points (SSE-capable)
│       ├── dashboard/                      authenticated user plans
│       ├── admin/                          admin-only observability view
│       └── share/                          public read-only plan view
├── agents/                    Google ADK agents (orchestrator + 4 agents) — runtime
│   ├── orchestrator.ts        public API: runCareerAnalysis / runChatQnA / runResumeOptimizer
│   ├── types.ts               single source of truth for all agent I/O Zod schemas
│   └── lib/
│       ├── mcp-client.ts      connection-pooled MCP stdio client
│       ├── models.ts          model ids + pricing registry (reads config/model-pricing.json)
│       ├── model-adapter.ts   provider-agnostic LLM adapter; adapters/ = gemini + openai
│       └── observability.ts   per-stage telemetry + in-process aggregate
├── mcp-skills/                MCP stdio subprocesses spawned by agents — runtime
│   ├── pdf-word-to-json/      resume extraction
│   ├── career-knowledge-base/ Pinecone RAG
│   ├── career-plan-generator/ structured plan JSON
│   └── resume-generator/      ATS resume synthesis
├── eval/                      ragas + agent harness (Python) — ship gate
├── supabase/                  SQL migrations + RLS policies
├── config/                    shared cross-language config (model-pricing.json)
├── documents/                 product/design docs + generated eval report
└── .gemini/skills/            per-subsystem SKILL.md (progressive disclosure)
```

**Rules for working in this repo:**

- **Respect workspace boundaries.** Cross-package imports go through the published workspace name (`@readmycareer/agents`), never via relative `../../agents/...` paths from `app/`.
- **Read the matching `.gemini/skills/<name>/SKILL.md` first** before editing `agents/<name>/index.ts` or `mcp-skills/<name>/src/index.ts`. The global `AGENTS.md` stays lightweight by design — detailed I/O specs live in the skills.
- **Schema migrations** belong in `supabase/` and must include RLS policies. Never modify a published migration; add a new one.
- **Generated artifacts (`dist/`, `.next/`, `node_modules/`) are gitignored.** Do not commit them, and do not edit files under them.
- **Secrets live in `app/.env.local`** (`GOOGLE_API_KEY`, `PINECONE_*`, `NEXT_PUBLIC_SUPABASE_*`). The `readmycareer-*.json` service-account file at the root is a secret — never log, paste, or commit it.
- **Docs that drive behavior**: [README.md](./README.md), [AGENTS.md](./AGENTS.md), [DESIGN.md](./DESIGN.md), [CHANGELOG.md](./CHANGELOG.md). Update [CHANGELOG.md](./CHANGELOG.md) when shipping a user-visible change.

## Architecture Boundaries — Hard Rules

These boundaries exist so the agent layer remains a pure function of its inputs (the eval harness depends on it):

- **Agents do not touch Supabase, Pinecone, or the filesystem directly.** All external access goes through `callMcpTool()` in [agents/lib/mcp-client.ts](agents/lib/mcp-client.ts), or is performed in the API route layer.
- **DB I/O lives in API routes** under [app/src/app/api/](app/src/app/api/) — fetching agent inputs and persisting results (`career_plans`, `gap_analyses`, `roadmaps`, `optimized_resumes`, chat history).
- **MCP skills are spawned via the connection-pooled client** in [agents/lib/mcp-client.ts](agents/lib/mcp-client.ts). Never `spawn()` an MCP subprocess elsewhere.
- **All agent I/O types live in [agents/types.ts](agents/types.ts)** and are validated with Zod at every boundary.
- **Public agent surface** is `runCareerAnalysis`, `runChatQnA`, `runResumeOptimizer` from [agents/orchestrator.ts](agents/orchestrator.ts). App code must not import individual agents.
- **LLM calls go through the `ModelAdapter` interface** ([agents/lib/model-adapter.ts](agents/lib/model-adapter.ts)) — never construct a provider SDK client in an agent or the orchestrator. The gap-analysis stage is provider-swappable (`provider` arg / `MODEL_PROVIDER` env).
- **Observability stays boundary-safe**: the orchestrator emits per-stage metrics via the `onMetric` callback; the API route persists them to `agent_runs`. Agents never log to or touch the DB.

## Gemini / Agent Guidelines

- **Model**: `gemini-3.1-flash-lite-preview` for all agents and MCP skills. Do not silently switch models, and never hardcode a model string — model ids + pricing live in one registry, [agents/lib/models.ts](agents/lib/models.ts) (`GEMINI_MODEL` / `OPENAI_MODEL`; prices from `config/model-pricing.json`). App imports it via `@readmycareer/agents/models`; MCP skills (separate processes) read the same `GEMINI_MODEL` env var, so setting it once switches everything.
- **Framework**: Google ADK TypeScript (`@google/adk`) with `InMemorySessionService`.
- **Caching**: resume tokens use Gemini Context Caching (1h TTL) — preserve cache keys when refactoring.
- **Bilingual output**: all agent output respects `Accept-Language` (en / ko). Never hardcode the response language.
- **Quality gates**: any new agent must be wrapped in a retry loop that validates schema + domain rules before returning. Mirror the pattern already in `gap-analyzer` / `planner`.

## Eval Discipline

The eval suite ([eval/run_evals.sh](eval/run_evals.sh)) is the contract for shipping changes that touch agents, MCP skills, prompts, or RAG:

- **Run `pnpm eval` before declaring agent/MCP/RAG work complete.** A failing eval blocks the change — do **not** weaken thresholds in `agent_harness.py` / `ragas_eval.py` to make it pass.
- The agent harness requires `pnpm dev` to be running on `BASE_URL` (default `http://localhost:3000`).
- Tracked metrics: Schema Compliance, Gap Faithfulness, **Gap Recall/Precision vs. labels**, Plan Completeness, Date Consistency, **Hidden Expectation Coverage**, **Contextual Depth**, p95 Latency, Avg Cost (agents); Faithfulness, Answer Relevancy, Context Precision/Recall, **Grounding/Citation Rate** (RAG). The harness also supports `--repeat N` (variance) and `--save-baseline`/`--compare-baseline` (regression diff).
- Inspect `eval/agent_harness_results.csv`, `eval/ragas_results.csv`, and `eval/grounding_results.csv` — review the CSV, not just the PASS/FAIL summary. Each agent run also regenerates a human-readable Korean report at [documents/agent-eval-report.md](documents/agent-eval-report.md).
- To extend coverage, add cases to [eval/eval_dataset.json](eval/eval_dataset.json) and `eval/fixtures/` rather than relaxing assertions.

## Frontend Guidelines

- **Next.js 14 App Router** — default to **Server Components**; mark Client Components with `"use client"` only when interactivity, hooks, or browser APIs require it.
- **Hybrid rendering / Streaming SSR**:
  - Prefetch on the server with `QueryClient.prefetchQuery` and pass through `<HydrationBoundary state={dehydrate(qc)}>` so the client takes over with a warm cache.
  - Use `loading.tsx` and `<Suspense>` boundaries to stream above-the-fold UI first; never block a route on a slow agent call.
  - For long-running agent runs, stream via Server-Sent Events from `app/src/app/api/` and render incremental progress.
- **TanStack Query (`@tanstack/react-query`)** is the single source of truth for server state on the client. Centralize keys in the shared `queryKeys` module; co-locate query/mutation hooks (`useResumeQuery`, `useCareerPlans`, `useChatMessages`, …) and do not duplicate fetching logic in components.
- **Styling: shadcn/ui + Tailwind CSS only.** No CSS modules, no styled-components, no inline `style` for design concerns.
  - Read [DESIGN.md](./DESIGN.md) before any UI work — the Synthetic Intelligence design system is mandatory.
  - Never use raw Tailwind palette colors (e.g. `bg-blue-600`, `bg-gray-100`) — use design tokens.
  - Use `cn()` (clsx + tailwind-merge) for conditional class composition.
- **i18n**: all user-facing strings go through `next-intl` keys in both `en.json` and `ko.json`. Never hardcode strings in JSX.
- **Code quality**: keep components small and presentational where possible, with explicit prop types. Prefer composition over flag props. Do not introduce abstractions that aren't justified by an existing second caller.

## Commit Workflow

When the user says **"커밋해"**, immediately (no confirmation prompt) split the working tree into logically scoped commits and create them. All commit messages must be **English** and follow Conventional Commits:

```
<type>(<scope>): <subject ≤ 50 chars, imperative, no trailing period>

- bullet 1 (what & why, not how)
- bullet 2

Resolves: #<issue>     ← omit entirely if no issue number is associated
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`. Typical scopes for this repo: `agents`, `gap-analyzer`, `planner`, `chat`, `resume-optimizer`, `mcp`, `rag`, `api`, `dashboard`, `auth`, `i18n`, `eval`, `ui`.

## Handoff Workflow

Cross-session task state lives in [documents/handoff.md](documents/handoff.md), managed by the `/handoff` skill ([.claude/skills/handoff/SKILL.md](.claude/skills/handoff/SKILL.md)). Sections: `🔜 To Do` / `🚧 In Progress` / `✅ Done`. Item format (do not deviate):

```
- [ ] **<title>** — <one-line summary>
  - 파일: `path/a`, `path/b`
  - 이유: <why it is needed>
  - 완료 기준(DoD): <what "done" looks like>
```

- **When the user says "handoff에 추가해줘"** (or "핸드오프에 추가", "add to handoff"), immediately (no confirmation prompt) append the task to the `🔜 To Do` section of [documents/handoff.md](documents/handoff.md) in the exact format above, then update the `마지막 갱신:` line to today's date. If 파일/이유/DoD are unclear, infer them from the current conversation; only ask if genuinely ambiguous. Keep body text Korean, code/paths/commits English.

- **When resuming a session or right before a context compact**, first read [documents/handoff.md](documents/handoff.md) and treat it as the source of truth for "where we left off". Preserve only context that maps to an active `🔜 To Do` / `🚧 In Progress` item — the task's files, rationale, DoD, and any decisions not yet recorded in the repo. Before the compact, fold any such unrecorded decision or progress back into the relevant handoff item (and move finished work to `✅ Done` with date + commit hash) so it survives the summarization. Discard transient detail (tool dumps, abandoned approaches, resolved errors) that no active item depends on.
