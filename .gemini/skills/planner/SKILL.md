---
name: planner
description: Expertise in developing and modifying the PlannerAgent. Use when the user asks to update the career plan generation, weekly todo structure, date continuity logic, milestone generation, quality gate thresholds, or the planner system instruction in agents/planner/.
---

# Planner Agent

## Responsibilities

Generates a week-by-week career action plan based on gap analysis results and career trend reference documents retrieved from the Pinecone vector database. Each week contains a theme, milestone, and ≥ 3 todos with category, priority, estimated hours, and resource links.

## I/O Specifications

- **Input**: `gapAnalysisData` (GapAnalysisOutput), `referenceResults` (JdSearchResult[] from Pinecone), `durationWeeks` (number), `startDate` (string YYYY-MM-DD), `targetRole`, `targetCompany`, `locale` ("ko" | "en")
- **Output**: `CareerPlanOutput` (stored in `session.career_plan`)
- **Location**: `agents/planner/index.ts` — exports `PLANNER_INSTRUCTION`
- **Orchestration**: Called from `agents/orchestrator.ts` → `runCareerAnalysis()` (Step 2, after gap analysis)

## Key Design Decisions

- **RAG supplementary context**: Reference documents from Pinecone (`doc_type: "reference"`) are injected into the planning prompt. They supplement but do not replace the gap analysis data.
- **Gemini context caching**: The planner reuses a resume cache (same key as gap analyzer) to avoid re-billing resume tokens. Cache TTL is 1 hour.
- **Quality gate**: `validateCareerPlan()` in `orchestrator.ts` enforces:
  - `weeks.length ≥ ceil(durationWeeks * 0.8)`
  - Each week has ≥ `MIN_TODOS_PER_WEEK = 3` todos
  - `date_range` fields are consecutive across weeks (≤ 2-day gap allowed)
- **Response normalization**: `normalizePlan()` in `orchestrator.ts` normalizes varying LLM output shapes (e.g. `career_plan.weeks` vs `weeks`) into a consistent `CareerPlanOutput`.

## Required Output Structure

```json
{
  "summary": "string",
  "weeks": [{
    "week_number": 1,
    "date_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "theme": "string",
    "milestone": "string | null",
    "todos": [{
      "id": "string",
      "title": "string",
      "description": "string | null",
      "category": "skill | experience | certification | portfolio | keyword",
      "priority": "high | medium | low",
      "estimated_hours": 2,
      "done": false,
      "resources": []
    }]
  }],
  "timeline": { "milestones": [], "gantt_rows": [] }
}
```

## Data Transfer Rules

- Always use types from `agents/types.ts` (`CareerPlanOutput`, `SESSION_KEYS`)
- Never access Pinecone, Supabase, or the file system directly — reference data is passed in as a parameter from the orchestrator
