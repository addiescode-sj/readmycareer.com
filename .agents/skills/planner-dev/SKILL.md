# Planner Agent Development

This skill provides specialized context for developing or modifying the `PlannerAgent` in the readmycareer.com project.

## Responsibilities
Generates weekly career plans and Gantt chart timelines based on gap analysis results and external career knowledge.

## I/O Specifications
- **Input**: `gap_analysis` (GapAnalysisOutput), `reference_results`, `duration_weeks`, `start_date`
- **Output**: `CareerPlanOutput` (stored in `session.career_plan`)
- **Location**: `agents/planner/index.ts`
- **Config**: `.antigravity/agents/planner.yaml`

## Guidelines
- **RAG Integration**: Supplements the plan with career trend and industry reference documents retrieved from the Vector DB (`doc_type: "reference"`). These are fetched via the hybrid search (dense + BM25 + reranking) pipeline in `career-knowledge-base` MCP.
- **Data Transfer**: Always use `agents/types.ts` schemas.
- **Dependencies**: Must not access the file system or Vector DB directly. Access must be routed through MCP skill tools.
