# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
