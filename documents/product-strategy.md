# Product Strategy Canvas — readmycareer.com

---

## 1. Vision

> **Help anyone close the gap between where they are and where they want to be in their career — with honest, AI-powered insight that no human coach could deliver at this price or speed.**

- We believe everyone deserves a clear-eyed view of their career trajectory, not just people who can afford a $300/hr executive coach.
- We aspire to become the default career intelligence layer for ambitious professionals worldwide.
- We value honesty over flattery: our product tells you what's actually missing, not what you want to hear.

---

## 2. Market Segments

**Segment A — The Tech Career Climber (Primary)**

| | |
|---|---|
| **JTBD** | When I'm planning my next career move, I want to know exactly what skills and experiences I'm missing for a target role, so I can close the gap systematically rather than guess. |
| **Desired outcome** | A concrete, prioritized action plan — not vague advice |
| **Constraint** | No budget for human coaching; too busy to research blindly |
| **Profile** | Mid-level engineer or IC (3–8 YOE) aiming at senior/staff or FAANG-tier |

**Why this segment first?** High intent, high urgency, self-directed learners who will follow a plan. They share outcomes publicly (Twitter/X, LinkedIn), which drives organic growth. They're already searching for this; they just find generic tools.

**Segment B — The Career Switcher (Secondary)**

Non-tech professional targeting a tech role (e.g., finance → data, operations → PM). High anxiety about transferability of experience. Will pay to reduce uncertainty.

---

## 3. Relative Costs

**Position: Premium value, not low cost.**

We do not compete on price with free tools (ChatGPT prompt hacks, free Jobscan tier). Our cost structure reflects:
- LLM inference per analysis (Gemini 2.5 Flash — cost-efficient model choice already validated)
- Agent orchestration (Gap Analyzer + Planner + Chat Q&A pipeline)
- No large human coaching team needed = structural cost advantage vs. human coaches

**Unit economics target:** Keep per-session AI inference cost < $0.10 to support a freemium or $15–25/mo subscription model with healthy margins.

---

## 4. Value Propositions

### Segment A — Tech Career Climber

| | |
|---|---|
| **What before** | Uploads resume to LinkedIn, applies to 50 jobs, gets no callbacks. Doesn't know if it's the resume, the skills, or the targeting. |
| **How** | Paste a target JD + upload resume → AI gap analyzer identifies specific skill, experience, and framing gaps against that exact role in < 60 seconds. Planner generates a week-by-week action plan to close them. |
| **What after** | Candidate walks into applications knowing exactly what's missing, what to fix first, and what to say in interviews. |
| **Alternatives** | Jobscan (keyword matching only, no gap plan), LinkedIn Premium (generic learning recs), ChatGPT (no structure, user must prompt correctly) |

### Segment B — Career Switcher

| | |
|---|---|
| **What before** | Unsure if 5 years in finance counts as relevant experience for a PM role. Gets conflicting advice from Reddit and friends. |
| **How** | AI reads career trajectory holistically and translates transferable skills into tech-role language, then surfaces what's genuinely missing (not just keywords). |
| **What after** | Knows what to build (portfolio, side project, cert) and how to position existing experience confidently. |
| **Alternatives** | Bootcamps ($15K+), human coaches ($200–400/hr), career-change subreddits |

---

## 5. Trade-offs (What We Will NOT Do)

| Out of scope | Why |
|---|---|
| Resume template builder | Zety/Resume.io already owns this; building it adds complexity, no differentiation |
| Job board / job aggregator | High CAC, commodity; we send users to existing boards |
| ATS keyword stuffing optimization | Trains users to game systems, not close real gaps; conflicts with our honest-insight brand |
| Generalist career advice (all roles, all industries) | Dilutes the AI's precision; start with tech, where JDs are structured and learnable |
| Human coaching marketplace | Adds supply-side complexity before product-market fit |

**The focus rule:** Every feature must either make the gap analysis sharper or the career plan more actionable. If it doesn't, it waits.

---

## 6. Key Metrics

**North Star Metric:**
> **Number of users who complete a gap analysis AND execute at least one week of their career plan**

This captures both activation (analysis done) and retention (plan followed), and directly predicts long-term value delivery.

**OMTM for Q1 (pre-launch → first 100 users):**
> **Activation rate** — % of sign-ups who complete a full gap analysis within their first session

*Why:* At pre-launch, proving the core loop works (resume in → actionable plan out) is the only thing that matters. If activation is < 40%, the product isn't doing its job.

---

## 7. Growth

**Motion: Product-Led Growth (PLG)**

| Phase | Strategy |
|---|---|
| **0 → 100 users** | Direct outreach — founder posts on LinkedIn/X sharing gap analysis case studies. Invite beta users from relevant communities (Blind, Levels.fyi, tech Twitter). |
| **100 → 1K users** | Shareable output — generate a public "Career Gap Report" card that users can post. Virality built into the product. |
| **1K → 10K users** | SEO + comparison content ("readmycareer vs Jobscan", "how to analyze your resume with AI") + referral program. |
| **10K+** | B2B channel — bootcamps, coding schools, university career centers embed the tool for their students. |

**Unit economics target:** CAC < 1/3 of LTV. At $20/mo subscription, LTV (6-month avg) = $120 → CAC ceiling = $40.

**Freemium structure:**
- Free: 1 gap analysis/month, no planner
- Pro ($19/mo): Unlimited analyses + full weekly planner + chat Q&A

---

## 8. Capabilities Required

| Capability | Build or Partner |
|---|---|
| Multi-agent AI pipeline (Gap Analyzer, Planner, Chat) | **Build** — already in progress; core IP |
| Resume parsing (PDF/DOCX → structured JSON) | **Build** — MCP skill already built |
| LLM inference (Gemini 2.5 Flash) | **Partner** — Google AI |
| Vector DB for semantic JD/resume matching | **Partner** — Pinecone (already integrated) |
| Auth + payments + billing | **Partner** — Supabase Auth + Stripe |
| SEO content engine | **Hire/outsource** — after product-market fit |
| Multilingual support (EN/KO already supported) | **Build** — next-intl already wired in; leverage for Korean market early |

**Must develop to win:** The quality of gap analysis output is the product. Invest in prompt engineering, eval pipelines, and LLM judge scoring to continually improve output quality.

---

## 9. Can't / Won't (Defensibility)

| Moat | How we build it |
|---|---|
| **Output quality flywheel** | Each analysis + user feedback trains our eval benchmarks. Over time, our prompts and scoring improve faster than competitors who don't run structured evals. |
| **Career trajectory context** | We analyze the full career arc, not just a snapshot resume. Building longitudinal data (with consent) creates a richer model over time. |
| **Switching costs** | Once a user has their Gap Report + 8-week plan, leaving means starting over. Plan continuity and progress tracking deepen lock-in. |
| **Korean market early mover** | Bilingual (EN/KO) support already built. Korean tech job market is underserved by English-first tools. Early brand ownership is durable. |

**Why competitors can't easily copy this:**
- Jobscan optimizes keywords — a fundamentally different (and shallower) framing of the problem
- LinkedIn Premium has the data but not the analysis product; their incentive is to keep users on-platform, not to help them leave for a better job
- ChatGPT requires the user to be the PM — our product does the thinking for them

---

## Critical Hypotheses

| # | Hypothesis | Risk level |
|---|---|---|
| H1 | Users will find the gap analysis output specific enough to act on (not too generic) | High |
| H2 | Users are willing to pay ~$20/mo for this, even though ChatGPT is free | Medium |
| H3 | Shareable output drives meaningful word-of-mouth virality | Medium |
| H4 | Tech-career focus is a beachhead, not a ceiling — other verticals (finance, healthcare) are reachable later | Low |

---

## Validation Experiments

| Hypothesis | Experiment | Success signal |
|---|---|---|
| H1 | Show 10 beta users a gap analysis output; ask "what would you do next Monday?" | 7/10 give a specific, actionable answer |
| H2 | Put a paywall after the first free analysis; measure conversion | > 5% free → paid conversion within 7 days |
| H3 | Add a "Share my Gap Report" CTA; track click-through and referral signups | > 15% of users click; > 2% of views convert to sign-up |

---

*Strategy coherence check: Vision (democratize career coaching) → Segment (tech career climbers with real urgency) → Core value (honest gap analysis, not resume fluff) → Trade-offs (no ATS gaming, no job board) → Growth (PLG + shareable output) → Defensibility (eval flywheel + switching costs). All elements point in the same direction.*

*Revisit this canvas each quarter as you gather data from real users. The segment and metrics sections will likely need the most updating after launch.*

---

## Addendum: Resume Optimizer as Tangible Career Artifact

The Resume Optimizer transforms the career plan from a "planning tool" into a "job application tool." This shift materially strengthens the product's value proposition:

- **Completion loop:** Users are incentivized to finish all checklist items to unlock the resume — improving retention and plan completion rates. Once generated, the "✓ Resume Generated" button state persists across page reloads (Supabase-backed), reinforcing the sense of progress and completion.
- **Tangible output:** Unlike gap analysis or a weekly plan, an optimized resume is immediately usable in a job application — viewable in a full-screen modal, copyable as Markdown, downloadable as `.md`, or exported as a clean PDF (browser print headers/footers suppressed; external links normalized to `https://`).
- **Differentiated positioning:** Competitors offer resume builders or career planning separately. readmycareer.com is the only tool that connects gap identification → growth execution → resume synthesis in a single workflow, powered by Gemini multimodal LLM.
- **PLG viral vector:** The generated resume references the platform's output (JD-matched keywords, structured template). Recruiters who see the output quality drive word-of-mouth.
- **Data flywheel:** Each optimization call (locale, keywords applied, sections generated) adds signal to the eval pipeline for improving the `resume-generator` MCP skill quality over time.
