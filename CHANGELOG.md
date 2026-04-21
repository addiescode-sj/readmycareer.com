# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
