# [PRD] Personal Career Manager AI Agent

## 1. Product Summary
Objective: To objectively analyze the gap between the user's current competencies (AS-IS) and their target job description (TO-BE), and provide a hyper-personalized career roadmap and actionable learning plan to bridge this gap within a specified job search timeframe.

### Target Users:

Mid-level developers with 3-7 years of experience preparing for a career transition.

Job seekers who require highly tailored preparation based on the specific requirements of target companies (e.g., Fintech company or Global Tech companies).

Professionals planning to achieve high level of base salary and benefits in limited time, who need systematic, timeline-based management.

### Core Problems to Solve:

The difficulty for candidates in objectively identifying specific technical stacks and competencies they lack when reading extensive JDs.

The absence of a concrete, daily/weekly execution plan (Action Plan) for studying and preparing, despite having a set timeframe for the job search.

## 2. User Journey
- Sign-in: The user signs in via Google OAuth. On first sign-in, a profile is automatically created and persisted to Supabase. Data is retained across sessions.

- Data Input: The user uploads their resume (PDF/Text) or manually inputs their technical stack and project experience into the chatbot.

- Goal Setting: The user inputs the desired target company, specific role (e.g., Product Engineer), the target job search duration (e.g., 1 month), and **pastes the full text of the job description (JD) they are applying for**.

- JD-Based Gap Analysis: The agent compares the user's resume directly against the pasted JD text to identify competency gaps. Separately, it queries the Vector DB for career trend and industry reference documents to enrich the career planning step.

- Roadmap Delivery: Based on the analyzed gap, the AI generates a comprehensive timeline table, a weekly to-do list, and a daily study log template. Career trend references from the knowledge base are incorporated to ensure the plan reflects current industry practices.

- Visualization & Interaction: The user toggles the generated markdown table into a visual chart, asks follow-up questions regarding the details, and interacts with the chatbot to refine the plan.

## 3. Core Feature Specs
### 1. Profile-JD Gap Analysis Module
- Description: Matches the user's resume data with the **user-provided JD text** to derive 'Current Competencies', 'Lacking Competencies', and 'Priorities for Improvement'. The JD is pasted directly by the user rather than fetched from a database, ensuring the analysis always reflects the exact job being applied to.

- Quality Standards:

Must go beyond simple keyword matching and logically compare the depth of the user's project experience with the technical requirements demanded by the JD.

Gap analysis results must always include 'evidence' (e.g., explicitly stating which requirement from the JD the gap is based on).

- Portfolio/Project Alignment: For each project in the user's resume `projects[]`, the gap analyzer must perform three explicit checks: (1) **tech stack coverage** — whether `tech_stack[]` includes JD-required technologies; (2) **keyword alignment** — whether project descriptions and achievements contain high-signal JD keywords; (3) **competency depth** — whether the project demonstrates the required proficiency level (e.g., "toy CRUD app" vs. JD requiring "production-scale microservices"). Gaps from these checks are emitted as `category:"portfolio"` or `category:"keyword"` items with concrete rationale (e.g., "No project demonstrates GraphQL required by JD").

### 2. Reference-Enhanced Career Planning
- Description: In addition to gap analysis, the system queries the Vector DB for career trend and industry reference documents (`doc_type: "reference"`) relevant to the target role and company. These references (e.g., current IT trends, in-demand skills, hiring patterns) supplement the career plan generation step, ensuring the roadmap is grounded in real-world market context.

- Retrieval Strategy: Hybrid search (dense vector + BM25 + reranking) is applied to retrieve the most relevant reference documents. If the search returns no results, career planning falls back gracefully to general knowledge.

### 3. Multimodal Roadmap Generator (Output Generator)
- Timeline Table: Outputs a markdown table categorizing the job search period into distinct phases such as 'Preparation - Intensive Study - Application & Interview'.

- Toggle Visualization Guardrails: Visualizes progress aligned with the current date (System Date) and generates structured data fully compatible with rendering libraries like Mermaid.js or custom UI components.

- Weekly To-do List: Proposes mandatory action items for each week based on the lacking competencies identified from the JD (e.g., "Build a RAG pipeline project using Next.js App Router").

- Daily Study Log: Generates a text template summarizing the day's learning content, alongside a checklist required to advance to the next step.

- Markdown Export: A "Copy as Markdown" button on the roadmap summary card converts the full career plan (all weeks and tasks) into a structured markdown table. Users can paste this directly into Notion, GitHub Issues, or any markdown-compatible tool. The table columns are: Week | Theme | Date Range | Milestone | Task | Category | Priority | Est. Hours.

- **Career Plan Selector:** The Protocol Roadmap page (`/dashboard/roadmap`) supports a plan selector dropdown (shown when the user has more than one non-archived career plan). Selection is URL-search-param-based (`?planId=xxx`), keeping the page server-rendered and consistent with the Career Profile page pattern. The most recent plan is selected by default.

- **Roadmap Velocity Tracker:** A Linear-style cycle speed chart rendered on the Protocol Roadmap page. X-axis = elapsed time (% of total plan duration); Y-axis = task completion %. Three visual elements: (1) dashed *ideal trajectory* line (linear 0→100%); (2) solid *required pace* line from (today, actual%) → (end, 100%) showing the remaining velocity needed; (3) a vertical today marker. The area between the ideal and required pace lines is filled green (on track / ahead) or red (behind). A metric strip below the chart shows days elapsed, days remaining, current completion %, and required weekly completion rate. Status badge: On Track / Ahead of Schedule / Behind Schedule. Falls back gracefully if `date_range` data is absent.

### 4. Interactive Career Coaching (Chat)
- Description: Dynamically restructures the roadmap in real-time based on user feedback (e.g., If the user states, "I am already familiar with this concept," the AI adjusts the plan accordingly).

- Response Quality: Leverages the high inference speed of Gemini Fast (Flash) mode to propose partial plan revisions within 3 seconds.

- Chat History Retention: Chat messages are stored per career plan and retained for 7 days. Users can view conversation history when revisiting an existing career plan. Messages older than 7 days are automatically purged.

### 5. Career Profile Report
- **Description:** A dedicated dashboard page (`/dashboard/profile`) that presents the user's competency snapshot and skill gap overview derived from a selected career plan and its associated gap analysis.

- **Report Basis Display:** Each report shows a "Based on" metadata line indicating the resume upload date and the career plan's creation date, target role, and company. This ensures users understand the data provenance of the displayed analysis.

- **Plan Selector:** When a user has more than one active/completed career plan (up to 3), a `<select>` plan selector allows switching between plans. Selection is URL-search-param-based (`?planId=xxx`), keeping the page server-rendered and SEO-friendly. The most recent plan is selected by default.

- **Data Displayed:** Competency radar chart (five categories: Skill, Experience, Certification, Portfolio, Keyword), evidence-based findings (gaps with High/Medium/Low priority labels), application status tracker, user notes, and the next 3 pending todos from the associated roadmap.

- **Application Status Tracking:** A `<select>` input lets the user record their current job application stage for the career plan. Allowed values: `applied` (서류 지원 완료), `doc_passed` (서류 합격), `doc_failed` (서류 불합격), `interview_1_pass` (1차 면접 통과), `interview_2_pass` (2차 면접 통과), `interview_3_pass` (3차 면접 통과), `offer_accepted` (최종 오퍼 수락), `offer_declined` (오퍼 미수락). Stored in `career_plans.application_status`. Default is unset (null).

- **User Notes:** A textarea (max 2000 characters) lets the user attach free-form notes to the career plan — e.g., interview feedback, preparation memos. Stored in `career_plans.notes`. The status selector and notes textarea are rendered in a two-column horizontal layout, positioned immediately before the "Next Actions" section.

## 4. Technical Requirements
### 1. Model & Prompt Engineering
Gemini Fast Mode Integration: Utilizes the large context window to input the user's lengthy resume and the full texts of the pasted JD into a single inference process.

Few-shot Prompting:

Includes reference examples in the system prompt to guarantee output consistency (e.g., [Input: Junior Frontend / Target: Toss] -> [Output: Analysis Table Sample]).

Strictly enforces JSON output formatting to prevent rendering errors in the frontend visualization components.

### 2. RAG Pipeline — Reference Knowledge Base
Data Source: Career trend articles, industry reports, and role-specific knowledge documents are embedded and stored in the Vector DB (`doc_type: "reference"`). These are retrieved to supplement career plan generation, not for JD discovery.

Retrieval Strategy: Employs 'tech stack and role combinations' as search queries. Hybrid search (dense + BM25 + Pinecone reranking) ensures high-relevance retrieval.

JD Input: JD text is provided directly by the user (paste input) rather than retrieved from the Vector DB. This guarantees analysis fidelity — the system always analyzes the exact job the user is applying for.

### 3. Frontend & Data Visualization
Tech Stack: Next.js, Tailwind CSS, Shadcn UI (Optimized for a Vibe Coding environment to ensure rapid MVP development).

Visualization Logic: The client-side application parses the AI-generated Markdown/JSON data and renders it into an interactive, toggleable timeline view.

### 4. Data Persistence & Auth
Auth: Google OAuth only (via Supabase Auth). No email/password accounts.

Primary DB: Supabase PostgreSQL — stores profiles, resumes, career plans, gap analyses, roadmaps, weekly tasks, daily logs, and chat history.

Vector DB: Pinecone remains the primary RAG store. `jd_documents` is also mirrored in Supabase pgvector (768-dim, gemini-embedding-001) as a supplementary fallback.

Career Plan Limit: Maximum 3 active/completed career plans per user account. Enforced at the database level via a BEFORE INSERT trigger. Archived plans do not count toward the limit — archiving is the mechanism to free up a slot.

Chat History Retention: 7 days per career plan. Enforced via a daily pg_cron cleanup job and a `recent_chat_messages` VIEW that automatically filters to the last 7 days.

Row Level Security: All user data tables are protected by Supabase RLS. Users can only access their own data.

### 5. Resume Optimizer

**Trigger:** The "Optimize Resume" button is enabled only when all todo items across the career plan are marked as completed (`completedTodosCount === totalTodosCount && totalTodosCount > 0`). When disabled, a hover tooltip reads "Complete all checklist items to generate your optimized resume." (i18n-aware). The button is shown exclusively in the saved plan detail view (`/dashboard/[id]`) — not during the initial session flow.

**Persistent state:** On page load, the client queries `optimized_resumes` by `career_plan_id`. If a row exists, the button immediately renders as "✓ Resume Generated" (regardless of todo completion status) and clicking it re-opens the result modal without triggering a new API call. While the initial Supabase query is in-flight, the button slot is replaced by an animated skeleton placeholder (`animate-pulse`, matching the button's height and width) to prevent UI flicker between "Optimize Resume" and "✓ Resume Generated" states.

**Generation flow:**
- User clicks "Optimize Resume" → `POST /api/resume-optimizer { career_plan_id }`
- API checks for an existing `optimized_resumes` row (idempotent — returns cached result)
- API validates all weekly tasks are completed (server-side guard)
- API fetches: `career_plans`, `gap_analyses.summary_json`, `resumes.resume_json` (with personal info), completed `weekly_tasks.action_items`
- Locale detected from `Accept-Language` header → "ko" or "en"
- `runResumeOptimizer()` calls `ResumeOptimizerAgent` → `callMcpTool("resume-generator", "generate_resume", …)`
- `resume-generator` MCP invokes Gemini (`gemini-2.5-flash-preview-05-20`) to synthesize the resume
- Result persisted to `optimized_resumes` table; returned as JSON

**Resume template (fixed order):**
1. Personal info: name, job title, website links, email, phone
2. Key highlights: max 5 ATS-friendly bullets synthesized from experience/projects (prioritizing JD-matched achievements and completed todo activities)
3. Key skills: flat deduplicated list
4. Education
5. Awards & certifications
6. Cover letter: 5-6 sentence motivation paragraph explaining JD fit (references gap summary + completed activities)

**Content constraints (ATS-friendly):**
- No tables — bullet points only
- Strong action verbs at the start of each highlight
- JD keywords woven naturally into descriptions
- Markdown formatted for clean plain-text rendering

**DB constraint:** `optimized_resumes.career_plan_id` is UNIQUE — at most one optimized resume per career plan. Enforced at database level.

**Result display:** Full-screen overlay modal rendered via React Portal directly into `document.body` (bypasses parent CSS `filter` constraints that would otherwise limit `position: fixed` to a transformed ancestor). Modal covers the entire viewport with a glassmorphism background (95% white opacity, 20px backdrop blur). Contains all resume sections, applied JD keyword chips, and three export actions: "Copy Markdown" (copies raw markdown to clipboard), "Download .md" (browser file download), and "PDF로 저장" (opens a print-ready HTML page and triggers the browser print/save-as-PDF dialog). PDF output uses `@page { margin: 0 }` CSS to suppress browser-generated print headers (date, title) and footers (URL, page number); all external links are normalized to `https://` before rendering. Modal closes via the × button.
