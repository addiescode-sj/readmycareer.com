# User Stories — Personal Career Manager AI Agent

> 📄 Generated based on PRD | Total 21 Stories | Last Updated: 2026-04-18
> Finalized: Includes direct JD paste input / RAG reference retrieval for planning / Account-based / Chat History DB Storage

---

## Epic 1: User Profile & Account Management
> Provides the foundation for job seekers to register their history and goals while maintaining data across sessions.

### US-001 | 🔴 Must | Sign in via Google OAuth

- **Page:** Sign-in Screen
- **Feature:** Google OAuth authentication via Supabase Auth

**As a** developer preparing for a career transition,
**I want to** sign in using my Google account,
**So that** I can save my resume and roadmap data and continue where I left off.

**Acceptance Criteria:**
- [ ] Given the sign-in screen, When the "Continue with Google" button is clicked, Then the Google OAuth consent screen is presented.
- [ ] Given successful Google OAuth, When redirected back to the app, Then a `profiles` row is automatically created in Supabase using the user's `display_name` and `avatar_url` from Google.
- [ ] Given a returning user, When they sign in again, Then their existing career plans, roadmaps, and chat history are restored.
- [ ] Given an unauthenticated request to any protected page, Then the user is redirected to the sign-in screen.
- [ ] Given the sign-out button is clicked, Then the Supabase session is cleared and the user is redirected to the sign-in screen.

**Notes:** Email/password authentication is out of scope. Supabase Auth handles the Google OAuth provider. The `handle_new_user` DB trigger auto-populates the `profiles` table on first sign-in.

---

### US-002 | 🔴 Must | Resume PDF Upload

- **Page:** Profile Input Screen
- **Feature:** PDF parsing and text extraction

**As a** job-seeking developer,
**I want to** upload my resume PDF and have my tech stack and project experience automatically parsed,
**So that** I can start the gap analysis quickly without manual input.

**Acceptance Criteria:**
- [ ] Given a PDF file upload, When parsing is complete, Then a structured preview of tech stacks, projects, and work periods is displayed.
- [ ] Given the parsing results, When a user edits or adds items, Then the changes are saved.
- [ ] Given a PDF exceeding 10MB, When an upload is attempted, Then a file size limit message is displayed.
- [ ] Given a scanned image PDF where text extraction is impossible, Then the system guides the user to manual input mode.

**Notes:** Server-side PDF parsing (e.g., pdf-parse or Python pdfminer). Parsed results are normalized into a JSON schema for DB storage.

---

### US-003 | 🔴 Must | Manual Tech Stack Input

- **Page:** Profile Input Screen
- **Feature:** Tag-based manual tech stack entry

**As a** developer who prefers not to upload a PDF,
**I want to** manually enter my tech stack and project experience,
**So that** I can start the gap analysis without a resume file.

**Acceptance Criteria:**
- [ ] Given the tech stack input field, When Enter or a comma is pressed, Then a tag is added and autocomplete suggestions are shown.
- [ ] Given project experience input, Then a structured form for project name, tech used, and duration is provided.
- [ ] Given mandatory fields (years of experience, at least one tech stack) are empty, When moving to the next step, Then a mandatory field error is displayed.

---

## Epic 2: Goal Setting & JD Input

> Enables users to set target companies, roles, and periods, and provide the job description text for gap analysis.

### US-004 | 🔴 Must | Career Goal Setting with JD Paste

- **Page:** Goal Setting Screen
- **Feature:** Input target company, role, duration, and paste JD text

**As a** developer planning a career transition,
**I want to** enter my target company, role (e.g., Product Engineer), target duration, and paste the full text of the job description I am applying for,
**So that** the AI can perform a precise gap analysis based on the exact JD I am targeting.

**Acceptance Criteria:**
- [ ] Given a company name input, Then autocomplete suggests a list of known companies.
- [ ] Given a target duration, Then it can be selected between 1 week to 6 months, and the system auto-calculates the deadline from today.
- [ ] Given the JD text field is submitted empty or with fewer than 50 characters, Then a validation error "Please paste the job description (minimum 50 characters)" is displayed immediately without calling the API.
- [ ] Given a JD text exceeding 10,000 characters, Then a validation error "Job description is too long (maximum 10,000 characters)" is displayed.
- [ ] Given valid JD text is pasted (50+ characters), Then the analysis proceeds using the pasted JD text directly for gap comparison.
- [ ] Given the goal is saved, Then all subsequent analyses and roadmaps are generated based on this goal and the pasted JD.
- [ ] Given a goal reset on the same account, Then a dialog appears to choose between overwriting the existing roadmap or creating a new one.
- [ ] Given a user already has 3 active or completed career plans, When they attempt to create a new plan, Then the system displays: "You have reached the maximum of 3 career plans. Archive an existing plan to create a new one." No API call is made.

**Notes:** The 3-plan limit is enforced at the database level via a BEFORE INSERT trigger on the `career_plans` table. Archived plans do not count toward the limit.

---

### US-005 | 🔴 Must | RAG-based Career Reference Context

- **Page:** Goal Setting Screen → Analysis Result Screen
- **Feature:** Vector DB retrieval of career trend and industry reference documents

**As a** developer preparing for a specific role,
**I want** the system to automatically retrieve relevant career trend and industry context from its knowledge base,
**So that** my career plan reflects current industry practices and in-demand skills beyond just my pasted JD.

**Acceptance Criteria:**
- [ ] Given a goal is set with a valid JD paste, Then career trend reference documents are retrieved from the Vector DB using the target role/company as the query (`doc_type: "reference"`).
- [ ] Given reference retrieval fails or returns 0 results, Then the career plan is still generated successfully using only the pasted JD and gap analysis (graceful degradation).
- [ ] Given reference results are retrieved, Then they inform the career planning step (PlannerAgent) as supplementary context — not the gap analysis step.
- [ ] Given the hybrid search (dense + BM25 + reranking) is used for retrieval, Then the existing Pinecone hybrid search pipeline in `mcp-skills/career-knowledge-base` is used without structural changes.

**Notes:** Reference documents (career trends, IT trends, hiring patterns) are stored in the Vector DB with `doc_type: "reference"`. JD text for gap analysis is always user-provided.

---

### US-006 | 🟡 Should | JD Paste UX Enhancements

- **Page:** Goal Setting Screen
- **Feature:** Improved JD paste experience

**As a** developer who has a specific job posting,
**I want to** paste the full text of a JD with clear guidance and character feedback,
**So that** I can confirm my input is complete and correctly formatted before starting the analysis.

**Acceptance Criteria:**
- [ ] Given the JD textarea, Then a character counter (current / 10000) is displayed in real time.
- [ ] Given a hint text below the label, Then it reads "Paste the full text of the job posting you are applying for."
- [ ] Given JD text is pasted, Then it is used for analysis in the same format regardless of source (copied from a website, PDF text, etc.).

---

## Epic 3: Profile-JD Gap Analysis
> AI performs an in-depth comparison between the user profile and JDs to suggest missing skills and priorities with rationale.

### US-007 | 🔴 Must | View Skill Gap Analysis Results

- **Page:** Gap Analysis Result Screen
- **Feature:** Display current skills, missing skills, and improvement priorities

**As a** developer who requested a gap analysis,
**I want to** see my current skills, missing skills, and improvement priorities on one screen,
**So that** I can immediately identify what to study first.

**Acceptance Criteria:**
- [ ] Given analysis completion, Then three sections (Current Skills, Missing Skills, Priorities) are clearly distinguished.
- [ ] Given each missing skill item, Then the rationale (source JD + requirement text) is displayed.
- [ ] Given analysis results, Then they are generated via logical comparison of project depth vs. JD requirements, not just keyword matching.
- [ ] Given a loading state, Then progress indicators for each stage (Fetching Reference Docs → Gap Analysis → Generating Career Plan) are displayed.
- [ ] Given analysis completion, Then portfolio alignment checks are included: for each resume project, the system verifies `tech_stack[]` against JD-required technologies and flags missing ones as portfolio-category gaps with rationale (e.g., "No project demonstrates GraphQL required by JD").
- [ ] Given analysis completion, Then keyword alignment checks are included: project descriptions and achievements are scanned for high-signal JD keywords, and missing keywords are flagged as keyword-category gaps with rationale.

**Notes:** Include examples like [Junior Frontend / Target: Toss] in few-shot prompts. Force output into JSON schema.

---

### US-008 | 🟡 Should | Regenerate Gap Analysis

- **Page:** Gap Analysis Result Screen
- **Feature:** Re-run analysis

**As a** developer whose analysis results differ from expectations,
**I want to** re-run the analysis after swapping JDs or editing my profile,
**So that** I can obtain more accurate gap results.

**Acceptance Criteria:**
- [ ] Given profile or JD edits, Then the "Re-analyze" button is activated.
- [ ] Given the re-analyze button is clicked, Then the old and new results are compared side-by-side or the old is replaced by the new.
- [ ] Given the new result differs from the previous one, Then changed items are highlighted.

---

## Epic 4: Roadmap Generation & Visualization
> Automatically generates timelines, weekly To-dos, and daily logs based on gap analysis.

### US-009 | 🔴 Must | Timeline Roadmap Generation

- **Page:** Roadmap Screen
- **Feature:** Step-by-step timeline table generation

**As a** developer who completed the gap analysis,
**I want to** receive a timeline roadmap divided into phases (Preparation → Intensive Study → Application/Interview),
**So that** I can see what to do and when at a glance.

**Acceptance Criteria:**
- [ ] Given a target duration, Then a timeline table with auto-calculated phases based on today's date is generated.
- [ ] Given the timeline display, Then start dates, end dates, and core goals for each phase are shown.
- [ ] Given timeline data generation, Then it is outputted as structured data (JSON/Markdown) renderable via Mermaid.js or custom UI.
- [ ] Given the current date falls within a specific phase, Then that phase is visually highlighted.

---

### US-010 | 🔴 Must | Weekly To-do List Generation

- **Page:** Roadmap Screen — Weekly View
- **Feature:** JD-based weekly action item generation

**As a** developer with a roadmap,
**I want to** check specific action items for each week,
**So that** I know exactly what to execute every week.

**Acceptance Criteria:**
- [ ] Given a roadmap is generated, Then at least 3 specific action items (e.g., "Build a RAG pipeline project with Next.js App Router") are suggested per week.
- [ ] Given weekly items, Then each item includes a checkbox, and completion status is saved to the DB.
- [ ] Given a specific week is clicked, Then the detailed plan for that week expands.

---

### US-011 | 🔴 Must | Daily Learning Log Template

- **Page:** Roadmap Screen — Daily View
- **Feature:** Daily record template and checklist

**As a** developer who wants to record daily progress,
**I want to** receive a summary template and a checklist to move to the next step,
**So that** I can track my learning progress systematically.

**Acceptance Criteria:**
- [ ] Given the daily view is opened, Then a text input for today's summary and a completion checklist are displayed.
- [ ] Given all checklist items are completed, Then a "Ready for next step" status is visually indicated.
- [ ] Given a day has passed, Then that day's log is automatically archived and accessible via history.
- [ ] Given a log is saved, Then the date, content, and checklist status are stored in the DB.

---

### US-021 | 🟡 Should | Copy Career Plan as Markdown Table

- **Page:** Roadmap Screen
- **Feature:** One-click markdown table export to clipboard

**As a** developer with a generated career plan,
**I want to** copy the full plan as a markdown table with a single click,
**So that** I can paste it into Notion, GitHub Issues, or any external tool without manual reformatting.

**Acceptance Criteria:**
- [ ] Given the Roadmap Screen is displayed, Then a "Copy as Markdown" button is visible in the summary card.
- [ ] Given the button is clicked, Then the full plan (all weeks, all tasks) is copied to the clipboard as a markdown table.
- [ ] Given a successful copy, Then the button label changes to "Copied!" for 2 seconds, then reverts.
- [ ] Given the markdown output, Then it includes a header block (title, summary, period) and a table with columns: Week | Theme | Date Range | Milestone | Task | Category | Priority | Est. Hours.
- [ ] Given a cell value containing a pipe character (`|`), Then it is escaped as `\|` to prevent table breakage.

---

### US-012 | 🟡 Should | Timeline Toggle Visualization

- **Page:** Roadmap Screen
- **Feature:** Table ↔ Chart view toggle

**As a** developer who wants a visual roadmap,
**I want to** toggle between a Markdown table and an interactive chart view,
**So that** I can view the roadmap in my preferred format.

**Acceptance Criteria:**
- [ ] Given the "View Chart" toggle is on, Then a Gantt chart is rendered using Mermaid.js or a custom component.
- [ ] Given the chart view, Then the current phase is highlighted based on today's date.
- [ ] Given the "View Table" toggle is on, Then it immediately switches back to the Markdown table.

---

## Epic 5: Interactive Career Coaching Chat
> Users can chat with the AI to adjust roadmaps and refine detailed plans in real-time.

### US-013 | 🔴 Must | AI Coaching Chat Conversation

- **Page:** Chat Interface
- **Feature:** Context-aware AI conversation

**As a** developer with additional questions about the roadmap,
**I want to** ask the AI via chat and receive immediate answers,
**So that** I can resolve ambiguities and adjust my learning direction quickly.

**Acceptance Criteria:**
- [ ] Given a message is sent, Then the AI response starts (streaming) within 3 seconds.
- [ ] Given previous conversation context, Then the AI provides consistent answers referring to that context.
- [ ] Given a page refresh or re-login, Then the previous chat history is restored from the DB.
- [ ] Given a chat response, Then it is always generated based on the current target company/role/duration context.

**Notes:** Use Gemini Flash mode. Handle responses via SSE streaming.

---

### US-014 | 🔴 Must | Dynamic Roadmap Modification via Chat

- **Page:** Chat Interface → Roadmap Screen
- **Feature:** Update roadmap using natural language commands

**As a** developer who already knows a specific skill,
**I want to** say "I already know this concept," and have the AI adjust the roadmap,
**So that** I can focus on more important areas without wasting time.

**Acceptance Criteria:**
- [ ] Given the user reports proficiency in a skill, Then the AI marks it as complete or removes/adjusts it in the weekly To-dos.
- [ ] Given a roadmap update, Then changes are immediately reflected in the roadmap UI and saved to the DB.
- [ ] Given a modification via chat, Then an inline notification "Roadmap updated" is displayed on the message.
- [ ] Given an accidental modification, Then it can be restored via an "Undo" button.

---

### US-015 | 🟡 Should | Chat History Storage & Restoration

- **Page:** Chat Interface
- **Feature:** Conversation continuity across sessions

**As a** developer visiting multiple times,
**I want to** see my previous conversations,
**So that** I don't have to explain the context from scratch every time.

**Acceptance Criteria:**
- [ ] Given entry to the chat screen after sign-in, Then chat messages from the last 7 days are loaded chronologically via the `recent_chat_messages` view.
- [ ] Given messages older than 7 days, Then they are automatically purged by the daily cleanup job and are no longer visible.
- [ ] Given more than 50 messages within the 7-day window, Then past history can be viewed via pagination or infinite scroll using `sequence_number` for cursor-based pagination.
- [ ] Given a career plan switch, Then chat history shown is scoped to the currently active career plan.

**Notes:** Chat messages are stored in the `chat_messages` table with a `career_plan_id` FK. The `recent_chat_messages` VIEW automatically filters to `created_at > NOW() - INTERVAL '7 days'`. A `cleanup_old_chat_messages()` pg_cron job runs daily at 03:00 UTC to hard-delete expired rows.

---

## Epic 6: RAG Pipeline & JD Data Management
> Crawls, embeds, and stores job JDs to build and maintain a searchable Vector DB.

### US-016 | 🔴 Must | JD Crawling & Embedding Storage

- **Page:** Backend Pipeline (Admin)
- **Feature:** JD collection, embedding, and Vector DB storage

**As a** system operator,
**I want to** automatically collect JDs from major platforms and store them in a Vector DB,
**So that** users always receive analysis based on the latest JDs.

**Acceptance Criteria:**
- [ ] Given the crawling pipeline execution, Then collected JDs go through: Text Extraction → Chunking → Embedding → Vector DB Storage.
- [ ] Given JD storage, Then metadata (company, role, collection date, original URL) is stored alongside.
- [ ] Given a duplicate JD, Then the existing record is updated without creating a duplicate.
- [ ] Given a crawl failure, Then failure logs are recorded and a retry mechanism is triggered.

**Notes:** Use Supabase pgvector or Pinecone. Embedding model: text-embedding-3-small or equivalent.

---

### US-017 | 🟢 Could | JD Data Freshness Management

- **Page:** Backend Pipeline (Admin)
- **Feature:** JD expiration handling and periodic updates

**As a** system operator,
**I want to** periodically update or expire old JDs,
**So that** users get analysis based on current market requirements.

**Acceptance Criteria:**
- [ ] Given a JD older than 30 days, Then it is marked as "Near Expiration" and prioritized for re-collection.
- [ ] Given a JD older than 60 days, Then it is automatically excluded from search or ranked with lower weight.
- [ ] Given the admin dashboard, Then total JD count, freshness distribution, and recent crawl status are visible.

---

## Epic 7: Progress Tracking & Dashboard
> Provides a progress screen for users to track their preparation status and stay motivated.

### US-018 | 🟡 Should | View Progress Dashboard

- **Page:** Dashboard Screen
- **Feature:** Visualization of overall roadmap progress

**As a** learning developer,
**I want to** see my current completion rate and remaining time on the dashboard,
**So that** I can quickly check my schedule adherence and stay motivated.

**Acceptance Criteria:**
- [ ] Given dashboard entry, Then the completion rate vs. total To-dos is shown via percentage and progress bar.
- [ ] Given less than 7 days to the deadline, Then a warning banner is displayed.
- [ ] Given a weekly completion rate below 50%, Then the AI suggests insights like "Try to speed up your learning this week."

---

### US-019 | 🟢 Could | Learning Streak & Notifications

- **Page:** Dashboard Screen
- **Feature:** Continuous learning day tracking and reminders

**As a** developer wanting a consistent routine,
**I want to** check my learning streak and receive reminders when I miss a log,
**So that** I can maintain the habit of recording my daily learning.

**Acceptance Criteria:**
- [ ] Given a daily log entry, Then the learning streak counter increases by 1.
- [ ] Given no log for a day, Then a "No record for yesterday" notification appears upon the next login.
- [ ] Given a 7-day streak, Then a congratulatory message and badge are displayed.

---

### US-020 | ⚪ Won't | Parallel Management of Multiple Goals

- **Page:** Dashboard Screen
- **Feature:** Simultaneous tracking of multiple target companies

**As a** developer applying to multiple companies,
**I want to** generate separate roadmaps for each company and manage them in parallel,
**So that** I can systematically prepare for multiple options.

**Acceptance Criteria:**
- [ ] Out of scope for this version. Focusing on a single goal is the core MVP value.
- [ ] Goal switching (US-004) is included, but parallel tracking UI is not.
- [ ] Register as a future requirement in the backlog.

---

### US-022 | 🟡 Should | Career Profile Report with Plan Selector

- **Page:** Career Profile (`/dashboard/profile`)
- **Feature:** Report basis display and multi-plan selector

**As a** developer with multiple career plans,
**I want to** see which resume and career plan my profile report is based on, and switch between my plans,
**So that** I can compare my competency snapshots across different target roles without confusion.

**Acceptance Criteria:**
- [ ] Given the career profile page loads, Then a "Based on" metadata line shows the resume upload date, target role, target company (if set), and plan creation date.
- [ ] Given the user has more than one active/completed plan, Then a plan selector (`<select>`) is visible and lists all plans with their creation dates.
- [ ] Given a plan is selected from the dropdown, Then the URL updates to `/dashboard/profile?planId=[id]` and the page re-renders server-side with data from the selected plan.
- [ ] Given no `planId` search param is present, Then the most recent plan is selected by default.
- [ ] Given the user has exactly one plan, Then only the "Based on" line is shown — the plan selector is not rendered.
- [ ] Given the user has no plans, Then the existing "no gap analysis data yet" empty state is shown unchanged.

**Notes:** `planId` is a URL search param for SEO-friendliness. Plan selection uses `router.push()` in the client component. All data fetching stays server-side in `page.tsx`.

---

### US-023 | 🟡 Should | Application Status & Notes on Career Profile

- **Page:** Career Profile (`/dashboard/profile`)
- **Feature:** Job application status tracker and free-form notes textarea

**As a** developer actively applying for jobs,
**I want to** record my current application stage and add personal notes (e.g., interview feedback) directly on the career profile page,
**So that** I can track my progress and capture important context alongside my competency analysis without switching tools.

**Acceptance Criteria:**
- [ ] Given the career profile page loads, Then an application status `<select>` is rendered with the following options (in order): Not set, 서류 지원 완료, 서류 합격, 서류 불합격, 1차 면접 통과, 2차 면접 통과, 3차 면접 통과, 최종 오퍼 수락, 오퍼 미수락.
- [ ] Given the user selects a status, Then the value is immediately saved to `career_plans.application_status` for the currently selected plan.
- [ ] Given a notes textarea, Then it accepts up to 2000 characters and shows a live character counter (current / 2000).
- [ ] Given the notes exceed 2000 characters, Then the input is blocked and an inline validation message is shown.
- [ ] Given the user types notes and clicks Save, Then the notes are saved to `career_plans.notes` for the currently selected plan.
- [ ] Given a save succeeds, Then a brief success indicator is shown ("Saved").
- [ ] Given a save fails, Then an inline error message is displayed without losing the user's draft.
- [ ] Given the status selector and notes textarea, Then they are laid out in a two-column horizontal grid, positioned immediately before the "Next Actions" section.
- [ ] Given the user has no active plan, Then the status/notes section is not rendered.

**Notes:** `application_status` is stored as a nullable TEXT enum in `career_plans`. `notes` is nullable TEXT with a DB-level CHECK (`char_length(notes) <= 2000`). Status is saved on `onChange`; notes are saved on explicit button click. The section is client-side only — no SSR mutation needed.

---

---

### US-024 | 🟡 Should | Roadmap Velocity & Pace Visualization

- **Page:** Protocol Roadmap (`/dashboard/roadmap`)
- **Feature:** Linear-style velocity chart showing required pace vs. actual completion

**As a** developer tracking their career plan progress,
**I want to** see a velocity chart showing whether I'm on pace to complete my plan by the end date,
**So that** I can adjust my daily study intensity before it's too late.

**Acceptance Criteria:**
- [ ] Given a roadmap with `date_range` on each week, Then the chart calculates plan start, end, and today's position.
- [ ] Given the chart is rendered, Then an ideal trajectory line (dashed diagonal) is visible from 0% to 100%.
- [ ] Given the chart is rendered, Then a required pace line is shown from (today, actual%) to (end, 100%).
- [ ] Given today is before the plan end date, Then a vertical "today" marker is displayed on the chart.
- [ ] Given actual completion >= ideal at today's position (within 5% tolerance), Then the status is "On Track" or "Ahead of Schedule"; fill area is green.
- [ ] Given actual completion < ideal - 5%, Then the status is "Behind Schedule"; fill area is red.
- [ ] Given the metric strip, Then it shows: days elapsed, days remaining, current completion %, and required %/week to finish on time.
- [ ] Given no `date_range` data on any week, Then the chart is not rendered (graceful fallback, no error).

**Notes:** Chart is SVG-based (no external charting library). Status thresholds: `completionPct > timeProgressPct + 10` = Ahead; within ±5% = On Track; below = Behind.

---

## 📊 Summary

| Priority | Count | Stories |
|----------|-------|---------|
| 🔴 Must  | 16    | US-001 (Google OAuth), US-002~003, 005, 007, 009~011, 013~014, 016, US-025~030 |
| 🟡 Should| 10    | US-006, 008, 012, 015, 018, 021, 022, 023, 024 |
| 🟢 Could | 2     | US-017, 019 |
| ⚪ Won't | 1     | US-020 |
| **Total**| **30**| |

**Recommended MVP Scope:** All "Must" + US-006 (Manual JD), US-012 (Toggle Visualization), US-015 (Chat History), US-021 (Copy as Markdown), US-023 (Application Status & Notes) — US-001 ~ US-016, US-021, US-023, US-025~030.

**Next Steps:**
- [ ] Story point estimation with the dev team (Planning Poker) — Focus on US-016 RAG pipeline effort.
- [ ] Register US-020 (Parallel Goals) in the next sprint backlog.
- [ ] Refine US-007 Gap Analysis JSON schema with PO/Dev (Front-end rendering dependency).
- [x] DB architecture decided: Supabase PostgreSQL is the primary relational DB; Pinecone remains the primary RAG vector store. `jd_documents` mirrored in Supabase pgvector (768-dim, gemini-embedding-001) as supplementary storage.

---

## Epic 8: Resume Optimizer

> Converts the completed career plan into a tangible, job-ready artifact — an ATS-optimized resume synthesized by Gemini multimodal LLM.

### Epic
**US-025: Resume Optimizer** — Generate a job-ready, ATS-optimized resume when all career plan checklist items are completed.

---

### User Stories

#### US-025: Optimize Resume Button
**As a** user who has completed all checklist items in a career plan,  
**I want to** click "Optimize Resume" to generate a tailored resume,  
**So that** I can immediately apply to the target role with a polished, JD-matched document.

**Acceptance Criteria:**
- [ ] "Optimize Resume" button is visible in the saved plan view (`/dashboard/[id]`)
- [ ] Button is **disabled** when `completedTodosCount < totalTodosCount` and no resume has been previously generated
- [ ] Hovering the disabled button shows tooltip: "Complete all checklist items to generate your optimized resume"
- [ ] Button becomes **active** (purple gradient) when all todos are marked done
- [ ] Clicking the active button calls `POST /api/resume-optimizer`
- [ ] Loading state shows "Generating..." text while request is in flight
- [ ] Once generated, button permanently shows "✓ Resume Generated" across page reloads (on mount, client queries `optimized_resumes` by `career_plan_id` and sets completed state if a row exists)
- [ ] Clicking "✓ Resume Generated" re-opens the result modal with the cached data; no new API call is made
- [ ] "✓ Resume Generated" button is always clickable regardless of current todo completion status

#### US-026: Optimized Resume Content
**As a** user generating an optimized resume,  
**I want** the resume to follow a fixed ATS-friendly template,  
**So that** my resume passes automated screening and clearly communicates my fit.

**Acceptance Criteria:**
- [ ] Resume includes all 6 sections in order: personal info, highlights, skills, education, awards/certs, cover letter
- [ ] Highlights section contains 3–5 bullet points starting with action verbs
- [ ] Cover letter is 5–6 sentences explaining JD fit
- [ ] No tables in the output — bullet points only
- [ ] JD keywords (from gap analysis) are naturally embedded in descriptions
- [ ] Completed career plan activities are referenced in the cover letter

#### US-027: Resume Locale Awareness
**As a** user with a preferred language,  
**I want** the resume to be generated in my browser language,  
**So that** I receive a Korean or English resume without manual selection.

**Acceptance Criteria:**
- [ ] `Accept-Language: ko*` → Korean resume output
- [ ] Other languages → English resume output
- [ ] Language applied consistently across all sections (highlights, cover letter, section headings)

#### US-028: Resume Result Modal
**As a** user who has generated an optimized resume,  
**I want** to view, copy, and download it from a modal,  
**So that** I can use the resume in my job application immediately.

**Acceptance Criteria:**
- [ ] Modal opens after successful generation (or when re-clicking "✓ Resume Generated")
- [ ] Modal renders as a full-screen overlay via React Portal into `document.body` (not a centered card)
- [ ] All resume sections are rendered in correct order
- [ ] Applied JD keyword chips are shown in the modal header
- [ ] "Copy Markdown" copies the full resume to clipboard
- [ ] "Download .md" triggers a browser file download of the raw markdown
- [ ] "PDF로 저장" opens a print-ready HTML page and triggers the browser print/save-as-PDF dialog
- [ ] PDF output uses `@page { margin: 0 }` to suppress browser-generated print headers (date, title) and footers (URL, page number)
- [ ] All external links in the PDF (LinkedIn, GitHub, etc.) are normalized to `https://` before rendering
- [ ] Modal closes via the × button

#### US-029: One Resume Per Plan
**As a** user,  
**I want** re-clicking "Optimize Resume" to return the existing resume,  
**So that** I don't accidentally overwrite a resume I'm happy with.

**Acceptance Criteria:**
- [ ] Calling the API again for the same `career_plan_id` returns the cached result
- [ ] No duplicate rows in `optimized_resumes` for the same career plan
- [ ] UNIQUE constraint on `optimized_resumes.career_plan_id` enforced at DB level
- [ ] On page load, the client queries Supabase for an existing `optimized_resumes` row; if found, the button state is pre-set to "completed" without requiring a new generation

---

#### US-030: Skeleton Loading State for Optimize Button
**As a** user visiting a plan detail page,
**I want** the optimize button area to show a loading placeholder while the app checks if a resume already exists,
**So that** I don't see the button flash between "Optimize Resume" and "✓ Resume Generated" states on page load.

**Acceptance Criteria:**
- [ ] On page mount, before the Supabase `optimized_resumes` query resolves, the button area renders an `animate-pulse` skeleton matching the button's height and approximate width
- [ ] Once the query resolves (resume found or not), the skeleton is replaced by the correct button state in a single render with no visible flash
- [ ] The skeleton placeholder has no click handlers (not interactive)
- [ ] The skeleton matches the button's visual dimensions (`h-9 w-36`, `rounded-xl`)

---

| Priority | Points | Stories |
|----------|--------|---------|
| 🔴 Must  | 10     | US-025, US-026, US-027, US-028, US-029, US-030 |

**Story Point Breakdown:** US-025 (2), US-026 (3), US-027 (1), US-028 (2), US-029 (1), US-030 (1) → Total: 10 points