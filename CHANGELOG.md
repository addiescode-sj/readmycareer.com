# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.6.0] - 2026-06-01

### Added

- **Model-provider abstraction**: a provider-agnostic `ModelAdapter` ([agents/lib/model-adapter.ts](agents/lib/model-adapter.ts)) with Gemini and OpenAI implementations. The gap-analysis stage can now run on OpenAI via the `provider` field on `POST /api/analyze` or the `MODEL_PROVIDER` env var; planning stays on Gemini to preserve the context-cache path. Documented in the new README "Model Strategy & Trade-offs" section.
- **Agent observability**: structured per-stage telemetry (latency, token usage, cache hits, retries, success/failure) emitted as JSON logs and aggregated in-process at the orchestrator boundary ([agents/lib/observability.ts](agents/lib/observability.ts)). Per-run metrics persist to a new RLS-enabled `agent_runs` table (written by the analyze route — agents never touch the DB) and are surfaced at `/admin/observability` (avg/p95 latency, failure rate, retry rate, cache-hit rate, tokens, estimated cost, cache-token savings).
- **Quantitative eval**: gap-analysis **recall/precision vs. labeled gaps**, run-to-run **variance** (`--repeat N`), and a **regression baseline + diff** (`--save-baseline` / `--compare-baseline`) in [eval/agent_harness.py](eval/agent_harness.py); a **Grounding / Citation Rate** with per-case source attribution in [eval/ragas_eval.py](eval/ragas_eval.py) (written to `eval/grounding_results.csv`); a **cross-model comparison** harness ([eval/model_comparison.py](eval/model_comparison.py)); and a README results-table generator ([eval/render_results.py](eval/render_results.py)) that renders the committed eval CSVs into the new "Quality & Evaluation" section.
- **Korean eval report**: each agent-harness run regenerates a human-readable Korean report at [documents/agent-eval-report.md](documents/agent-eval-report.md) (aggregate + per-fixture tables + metric glossary); the cost methodology is documented in [documents/cost-calculation.ko.md](documents/cost-calculation.ko.md).
- **Reference-grounding tooling**: the `career-knowledge-base` sync now labels reference docs by Drive folder and surfaces a `by_doc_type` breakdown, plus a retrieval inspector ([mcp-skills/career-knowledge-base/scripts/inspect-retrieval.mjs](mcp-skills/career-knowledge-base/scripts/inspect-retrieval.mjs)) to view ranked hits per query/`doc_type`.

### Changed

- [agents/orchestrator.ts](agents/orchestrator.ts) routes all LLM calls through the `ModelAdapter` interface instead of the inline `callGemini` helper; the context-cache logic moved into the Gemini adapter unchanged. `runCareerAnalysis` gained optional `provider` and `onMetric` parameters.
- **Single model/pricing source**: model ids are centralized in [agents/lib/models.ts](agents/lib/models.ts) (`GEMINI_MODEL` / `OPENAI_MODEL`, env-overridable) and per-1M-token prices in [config/model-pricing.json](config/model-pricing.json), read by both the TS agent layer and the Python eval harness — removing the duplicated model-string/price literals previously scattered across agents, app routes, and MCP skills.
- **Admin access control**: added an `is_admin` flag to `profiles` and a SECURITY DEFINER `public.is_admin()` helper (migration `20260601000003_add_profile_admin_role`). The `/admin/observability` page and `/api/admin/observability` route now require the admin role (non-admins are redirected / get 403) instead of merely being signed in, and `agent_runs` reads are restricted to admins via RLS. Admin accounts are granted manually in Supabase.

---

## [0.5.2] - 2026-05-30

### Fixed

- **RAG sync produced 0 records (Google Drive → Pinecone)**: the `readmycareer` index is an integrated `llama-text-embed-v2` index that embeds text server-side, but the `career-knowledge-base` skill and chat route were generating client-side Gemini `gemini-embedding-001` vectors and calling `index.upsert()` / `index.query({ vector })`. Integrated indexes reject client-supplied vectors — and the dimensions differed (3072 vs 1024) — so every upsert failed and the index stayed empty. Migrated the RAG path to Pinecone integrated inference (`upsertRecords` / `searchRecords`; embedded field `text`, overridable via `PINECONE_TEXT_FIELD`). ([`4ec1e5b`](../../commit/4ec1e5b))
- **Drive sync aborted with `Invalid array length`**: `chunkText` could stop advancing when a document's trailing slice was ≤ the overlap size, spinning until the chunk array hit the JS length limit. Now guarantees forward progress and terminates on the final chunk. ([`abf8b7f`](../../commit/abf8b7f))
- **Drive folder access failures**: the connector now accepts pasted folder URLs (normalized to bare IDs), supports Shared Drive folders (`supportsAllDrives` / `includeItemsFromAllDrives`), and reports the failing folder ID in the error message. ([`abf8b7f`](../../commit/abf8b7f))
- **`/api/sync` masked the real error**: the route crashed on `JSON.parse` when the MCP tool returned a plain-text error, hiding the actual cause. Now honors the tool `isError` flag and returns the message with a 500. ([`5c37926`](../../commit/5c37926))

### Documentation

- **RAG background & reference architecture**: README now documents the contextual gaps in JD/resume matching and the Pinecone knowledge-base category inventory. ([`040c671`](../../commit/040c671))

### Tests

- **Eval coverage**: added `eval/QUALITY_CRITERIA.md` (per-metric ship-gate contract) and expanded the agent/RAG harness, dataset, and fixtures. ([`3709187`](../../commit/3709187))

---

## [0.5.1] - 2026-05-12

### Fixed

- **Resume optimizer 500 error (Vercel deploy)**: `mcp-skills/resume-generator` was never compiled during Vercel deployment — `dist/` is gitignored and the build command did not include the MCP skill package. Added `pnpm --filter @readmycareer/mcp-resume-generator build` to `vercel.json` and configured `outputFileTracingIncludes` in `next.config.mjs` so the compiled skill is bundled with the serverless function. ([`dd44170`](../../commit/dd44170))
- **AI coach chat silent failure**: SSE consumer in `AICoachChat` only handled `{ text }` events and silently discarded `{ error }` payloads. When the Gemini API returned an error the chat showed a permanent loading indicator with no message. Now surfaces the error text to the user. ([`b31d980`](../../commit/b31d980))

---

## [0.5.0] - 2026-05-12

### Added

- **Resume projects integration (gap analysis)**: Phase 5c added to the gap analyzer — for each project in `resume_json.projects[]`, tech stack items that intersect JD requirements are emitted as `category:"portfolio"` strengths. ([`53873cb`](../../commit/53873cb))
- **Resume projects integration (career planning)**: Orchestrator and career-plan-generator MCP skill now receive the user's existing side projects. When a portfolio gap can be addressed by extending an existing project, the planner references it by name instead of suggesting a new build-from-scratch project. ([`53873cb`](../../commit/53873cb))
- **Resume projects integration (resume generation)**: Resume generator MCP skill outputs a **Projects** section (after Work Experience). Structural fields — name, period, tech stack, URL — are copied verbatim from the input resume; `achievements` are rewritten by the LLM in the user's locale for consistent language. ([`53873cb`](../../commit/53873cb))
- **Dual-score CompetencyRadar**: Radar chart now renders two layers — solid primary for **required** match score and dashed secondary for **preferred** match score — derived from the new `requirement_type` field on gap items. Backward-compatible with legacy single-score data. ([`5a608e4`](../../commit/5a608e4))
- **`requirement_type` on gap items**: Gap analyzer emits `requirement_type: "required" | "preferred"` on every gap item so downstream components can distinguish must-have from nice-to-have gaps. Phase 8 scoring updated to weight required gaps 2× and preferred gaps 0.5×. ([`53873cb`](../../commit/53873cb))
- **Projects section in optimized resume modal**: `OptimizedResumeModal` renders the projects section between Work Experience and Education, including PDF export support. ([`5af47ee`](../../commit/5af47ee))
- **Eval metrics for project integration**: Agent harness gains `project_portfolio_strength_rate` (≥ 80 %) and `project_plan_integration_rate` (≥ 70 %) metrics. ([`1ed8889`](../../commit/1ed8889))

### Fixed

- **Resume optimizer 500 error**: `upsert` was specifying `onConflict: "career_plan_id,user_id"` but the `optimized_resumes` table has a unique constraint on `career_plan_id` alone. Changed to match the actual constraint. ([`6d6a163`](../../commit/6d6a163))
- **Optimized resume idempotency**: Previously returned a cached row even when it lacked a `projects` field (pre-feature data). Now forces regeneration for any row missing `projects[]`, enabling seamless migration of legacy records. ([`6d6a163`](../../commit/6d6a163))
- **Projects section rendered in wrong locale**: Achievements were copied verbatim from the original English-language resume instead of being rewritten by the LLM. Added an explicit locale instruction (`projects[].achievements: rewrite each bullet in the output language`) and switched to the same merge pattern used for work experience. ([`53873cb`](../../commit/53873cb))

### Changed

- **Keyword extraction in resume optimizer**: `extractKeywords` now returns separate `required` and `preferred` keyword lists ordered by `requirement_type`, matching the scoring change in the gap analyzer. ([`53873cb`](../../commit/53873cb))
- **Overall readiness %** on the saved plan page now reads `overall_match_score` directly from the gap analysis JSON when present, falling back to averaging `requiredScore` values across competency axes. ([`5a608e4`](../../commit/5a608e4))

---

## [0.4.0] - 2026-05-11

### Added

- **Resume optimizer**: New **Optimize Resume** button in `/dashboard/[id]` activates when all career plan checklist items are completed. Calls a Gemini-powered `resume-generator` MCP skill to synthesize the resume, gap analysis, and completed todo evidence into an ATS-optimized output. ([`48dfd76`](../../commit/48dfd76))
- **Optimized resume template**: Fixed section order — personal info, key highlights (≤5 ATS bullets), skills, education, awards/certs, cover letter (5-6 sentences). ([`48dfd76`](../../commit/48dfd76))
- **Resume result modal**: Displays the generated resume with Copy as Markdown and Download `.md` actions. Button cycles through idle → generating → complete states; re-opens the modal if clicked again. ([`3df14e8`](../../commit/3df14e8))
- **`optimized_resumes` Supabase table**: Persists one ATS-optimized resume per career plan (unique constraint on `career_plan_id`). Locale auto-detected from `Accept-Language` header (Korean / English). ([`48dfd76`](../../commit/48dfd76))

### Fixed

- **MCP skill subprocess path**: All four skill paths in `agents/lib/mcp-client.ts` corrected from `../../mcp-skills` to `../../../mcp-skills`. webpack hardcodes `import.meta.url` to the `dist/` path, so an extra level was needed to reach the monorepo root. ([`48dfd76`](../../commit/48dfd76))
- **Resume personal info**: `/api/resume` was stripping `personal` from the SSE result before the client received it, causing 422 errors in the resume optimizer for any plan created after the fact. Now only `raw_text` is stripped. ([`3df14e8`](../../commit/3df14e8))
- **Resume storage privacy**: `resumeJson` is no longer persisted to `sessionStorage`. It is kept in React in-memory state only and stored server-side via `career_plans.resume_json`. ([`3df14e8`](../../commit/3df14e8))
- **Gap analyzer locale enforcement**: Added an explicit locale directive to the system instruction so the model outputs in the user's language regardless of the JD language. ([`9e9e56c`](../../commit/9e9e56c))
- **Mobile double scrollbar**: Eliminated competing scroll contexts on small screens. ([`79d5141`](../../commit/79d5141))
- **Roadmap mobile layout**: Reduced font sizes and padding for better readability on small viewports. ([`5fd88b0`](../../commit/5fd88b0))
- **Plan selector overflow**: Constrained width and added text ellipsis to prevent layout breakage. ([`588167a`](../../commit/588167a))

### Changed

- **Gemini model**: Replaced deprecated `gemini-2.5-flash-preview-05-20` with `gemini-3.1-flash-lite-preview` in the `resume-generator` MCP skill. ([`48dfd76`](../../commit/48dfd76))

### Refactored

- **Logo component**: Extracted `Logo` as a shared component and unified logo rendering across pages. ([`6f6e98e`](../../commit/6f6e98e))
- **Context panel**: Made the history context panel a collapsible accordion on mobile. ([`7084dff`](../../commit/7084dff))

---

## [0.3.0] - 2026-05-08

### Added

- **Synthetic Intelligence design system**: Implemented design tokens (colors, typography, spacing, elevation, glassmorphism) via shadcn/ui. All components now use semantic tokens instead of raw Tailwind color classes. ([`d06e205`](../../commit/d06e205))
- **Landing page & layout shell**: Full landing page with hero, feature highlights, and CTA. Persistent layout shell with header, footer, and navigation. ([`adcd030`](../../commit/adcd030))
- **Unified onboarding flow** (`InitializeWorkspace`): Replaced the two-step `ResumeUpload` + `GoalSetting` screens with a single workspace initialization view. ([`84a1bc0`](../../commit/84a1bc0))
- **Dashboard sub-pages**: Career Profile, Roadmap Timeline, and Conversation History are now dedicated sub-pages under `/dashboard/[id]`. ([`5019066`](../../commit/5019066))
- **Application status tracker**: Users can track job application status and add notes directly in the career profile section. ([`1902df1`](../../commit/1902df1))
- **Roadmap velocity chart**: Visual chart showing weekly todo completion rate over time. ([`b756783`](../../commit/b756783))
- **Plan selector**: Dropdown in the dashboard header for switching between saved career plans without leaving the page. ([`b756783`](../../commit/b756783))
- **8-phase gap analyzer**: Rewrote the gap analyzer with a chain-of-thought 8-phase prompt for more precise skill-level matching, strength extraction, and portfolio gap detection. ([`e55d5b2`](../../commit/e55d5b2))
- **i18n expansion**: Added translations for all new screens — velocity chart, career profile status/notes, history headers, and onboarding flow. Default locale changed to English. ([`1dc311d`](../../commit/1dc311d), [`829ad1e`](../../commit/829ad1e))

### Fixed

- **Locale detection**: Client now passes an explicit `locale` parameter to API routes to override server-side `Accept-Language` detection, which was unreliable in some deployment environments. ([`efdae43`](../../commit/efdae43))
- **Gap analyzer output**: Improved language directive placement and deduplicated portfolio gaps that were appearing multiple times. ([`8265aaa`](../../commit/8265aaa))
- **Conversation history layout**: Aligned column header heights in the dashboard history view. ([`659e9cd`](../../commit/659e9cd))
- **Zod resume schema**: Added `.catch()` fallbacks to all resume parsing fields to prevent hard failures when the LLM omits optional fields. ([`87717b1`](../../commit/87717b1))

### Refactored

- **CompetencyRadar**: Extracted into a shared reusable component used across dashboard sub-pages. ([`9af9717`](../../commit/9af9717))
- **PageHeader**: Extracted as a shared component for consistent dashboard page headers. ([`de463d2`](../../commit/de463d2))
- **Design tokens**: Applied design system tokens to all existing components and updated root layout. ([`77ad520`](../../commit/77ad520))

---

## [0.2.0] - 2026-04-29

### Added

- **Google OAuth authentication**: Users can sign in with Google. An OAuth callback route (`/api/auth/callback`) exchanges the auth code for a Supabase session, and `AuthListener` syncs login state to `localStorage` for cross-tab awareness. ([`2288f0f`](../../commit/2288f0f))
- **Returning-user gate**: First-time visitors proceed directly to the main flow. Returning users (detected via `localStorage`) are shown a welcome-back overlay offering a quick path to the dashboard or the option to continue without signing in. ([`2288f0f`](../../commit/2288f0f))
- **Dashboard**: Authenticated users can access `/dashboard` to view all saved career plans. Each plan links to a detail page (`/dashboard/[id]`) that renders the full roadmap and chat history in read-only mode. A sign-out button is included. ([`055ed97`](../../commit/055ed97))
- **Career plan persistence** (`/api/career-plans`): Plans are saved to Supabase on Google sign-in from the roadmap screen. Endpoint enforces a 3-plan limit per user and supports GET (list) and DELETE (remove by ID). ([`d454651`](../../commit/d454651))
- **Chat history persistence**: `ChatInterface` loads prior messages from the `recent_chat_messages` Supabase view on mount and writes each new user/assistant exchange to `chat_messages` in real time. ([`3bd48d8`](../../commit/3bd48d8))
- **Supabase database schema**: Full schema with Row-Level Security policies, triggers, and `pgvector` extension support for future semantic search. ([`ab7083a`](../../commit/ab7083a))
- **Animated runner progress track**: The static progress bar on the roadmap is replaced with a pixel-art character that runs along a track. Milestone celebrations appear at 30 %, 60 %, 90 %, and 100 % completion. ([`e6dcc26`](../../commit/e6dcc26))
- **Save banner on roadmap**: Unauthenticated users see a prompt to save their plan via Google sign-in. The banner updates automatically to reflect saving, saved, plan-limit-reached, and error states. ([`e6dcc26`](../../commit/e6dcc26))
- **JD text in session state**: `jdText` is now tracked in `SessionContext` and passed through the `onAnalyzed` callback so the full job description is available when persisting a plan. ([`ef444d6`](../../commit/ef444d6))

### Changed

- **Middleware**: Supabase session is refreshed on every request via the `@supabase/ssr` server client. The route matcher is expanded from specific API paths to all non-static routes so auth cookies are kept fresh across the app. ([`2288f0f`](../../commit/2288f0f))
- **CSP headers**: `img-src` now allows `https://lh3.googleusercontent.com` (Google profile photos); `connect-src` allows `https://*.supabase.co`. ([`2288f0f`](../../commit/2288f0f))
- **Root layout routing**: When the current path starts with `/dashboard`, the layout renders `children` (dashboard pages) directly instead of the `SessionLayout` onboarding flow. ([`055ed97`](../../commit/055ed97))

---

## [0.1.1] - 2026-04-21

### Fixed

- **Career plan language**: LLM agents were generating output (plan themes, weekly todos, milestones, summary, chat responses) in the language of the submitted JD rather than the user's language. All outputs now follow the browser's `Accept-Language` setting via an injected language directive in each LLM prompt. ([`8cacdee`](../../commit/8cacdee))

### Changed

- **Model**: Replaced `gemini-2.5-flash` with `gemini-3.1-flash-lite-preview` across all ADK agents (`GapAnalyzerAgent`, `PlannerAgent`, `ChatQnAAgent`), MCP skills (`career-plan-generator`, `pdf-word-to-json`), and API routes (`/api/resume`, `/api/chat`, `externalJdSearch`). Provides larger free-tier quota. ([`3e47dca`](../../commit/3e47dca))
- **Resume parsing**: Added multi-pass JSON fallback, markdown fence stripping, and temperature reduction in `/api/resume` to improve parse reliability with the new model. Removed unused `raw_text` field from the resume schema.

### Refactored

- **Progress messages (i18n)**: Server-side agents and API routes no longer generate locale-aware display strings. SSE progress events now emit semantic step keys only (e.g. `"gap_analysis"`, `"planning"`). `GoalSetting.tsx` resolves them to display text via `next-intl`, keeping all UI copy in `ko.json` / `en.json` as the single source of truth. ([`7115eb7`](../../commit/7115eb7))

---

## [0.1.0] - 2026-04-18

### Added

- Initial release: resume upload (PDF/DOCX), JD paste-based gap analysis, AI-generated weekly career plan, roadmap view with Gantt timeline, copy-as-markdown export, and floating AI career coach chat.
