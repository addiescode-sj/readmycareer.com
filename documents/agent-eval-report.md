# Agent Output Quality Report

> **Auto-generated** by `eval/agent_harness.py` on every run — do not edit by hand.
> Raw per-case data lives in [`eval/agent_harness_results.csv`](../eval/agent_harness_results.csv).
> To refresh: run `pnpm dev`, then `pnpm eval:agents` (or `pnpm eval`).

- **Generated:** 2026-06-01 19:55:46
- **Result:** ❌ **FAIL** — one or more gated metrics below threshold
- **Fixtures:** 3/3 successful
- **LLM-judge model:** `gemini-3.1-flash-lite-preview`

## Aggregate Metrics

| Metric                        | Score   | Threshold   | Status   |
|-------------------------------|---------|-------------|----------|
| Schema Compliance Rate        | 100.00% | >= 95%      | PASS     |
| JSON Parse Error Rate         | 0.00%   | <  5%       | PASS     |
| Gap Faithfulness (LLM-judge)  | 0.6000  | >= 0.7      | FAIL     |
| Plan Completeness Rate        | 100.00% | >= 90%      | PASS     |
| Date Consistency Rate         | 100.00% | = 100%      | PASS     |
| p50 Latency                   | 14.1s   | —           | INFO     |
| p95 Latency                   | 16.7s   | < 30.0s     | PASS     |
| Avg Cost / Request            | $0.0009 | < $0.01     | PASS     |
| Match Score In Range          | 0.00%   | >= 80%      | FAIL     |
| Gap Recall (vs labels)        | 41.67%  | >= 50%      | FAIL     |
| Gap Precision (INFO)          | 42.22%  | —           | INFO     |
| Category Diversity (>=3 dims) | 33.33%  | = 100%      | FAIL     |
| Project Portfolio Strength    | 100.00% | >= 80%      | PASS     |
| Project Plan Integration      | 33.33%  | >= 70%      | FAIL     |
| Hidden Expectation Coverage   | 33.33%  | >= 66%      | FAIL     |
| Prerequisite Ordering         | 100.00% | = 100%      | PASS     |
| Contextual Depth (LLM-judge)  | 0.5000  | >= 0.7      | FAIL     |

## Per-Fixture Scores

| Fixture                     | Latency   | Schema   |   Faithfulness |   Depth |   Recall | Plan ≥3   | Dates   | Hidden Exp.   |   Match | Cost    |
|-----------------------------|-----------|----------|----------------|---------|----------|-----------|---------|---------------|---------|---------|
| fx_junior_frontend_fintech  | 14.1s     | ✓        |            0.7 |     0.4 |     0.5  | ✓         | ✓       | ✗             |      23 | $0.0008 |
| fx_python_backend_to_nodejs | 11.4s     | ✓        |            0.7 |     0.4 |     0.75 | ✓         | ✓       | ✓             |      45 | $0.0008 |
| fx_fullstack_global_tech    | 16.7s     | ✓        |            0.4 |     0.7 |     0    | ✓         | ✓       | ✗             |      88 | $0.0011 |

Legend: ✓ / ✗ = pass / fail per fixture · Faithfulness & Depth = LLM-judge (0–1) ·
Recall = vs labeled gaps (0–1) · Match = `overall_match_score` (0–100).

## What Each Metric Means

| Metric | Gate | What it measures |
| --- | --- | --- |
| **Schema Compliance Rate** | ≥ 95% | Share of responses whose JSON validates against the `CareerPlanOutput` schema (`gap_analysis` + `weeks` with all required fields). Structural validity of the agent output. |
| **JSON Parse Error Rate** | < 5% | Share of requests whose body could not be parsed as valid JSON at all (`1 − successful/total`). Lower is better. |
| **Gap Faithfulness** (LLM-judge) | ≥ 0.70 | An LLM judge scores 0–1 whether each identified gap is grounded in the JD/résumé evidence rather than hallucinated. Shows `SKIP` when run with `--skip-llm-judge`. |
| **Plan Completeness Rate** | ≥ 90% | Share of plans in which **every** week contains at least 3 todos. |
| **Date Consistency Rate** | = 100% | Share of plans whose weekly date ranges are continuous in time (end ≥ start, and each week starts within 2 days of the previous week's end). |
| **p50 / p95 Latency** | p95 < 30s | Median / 95th-percentile end-to-end response time of `/api/analyze`. p50 is INFO only. |
| **Avg Cost / Request** | < $0.01 | Estimated USD per request from prompt + completion tokens at Gemini Flash Lite pricing ($0.075 / $0.30 per 1M input / output). |
| **Match Score In Range** | ≥ 80% | Share of fixtures whose `gap_analysis.overall_match_score` lands inside the fixture's expected range — catches the model systematically over- or under-rating fit. |
| **Gap Recall** (vs labels) | ≥ 50% | Of the gap keywords labeled for a fixture (`expected_gaps_keywords`), the share the analysis actually surfaced (case-insensitive substring match across each gap's `item` + `rationale`). Content accuracy against the golden set. |
| **Gap Precision** | INFO | Of the gaps the model surfaced, the share that hit ≥ 1 labeled keyword. INFO-only and never gated because labels are intentionally non-exhaustive (a valid gap outside the label set would look like a false positive). |
| **Category Diversity** (≥ 3 dims) | = 100% | Whether gaps + strengths together span ≥ 3 distinct categories (`skill` / `experience` / `certification` / `portfolio` / `keyword`), plus any categories the fixture explicitly expects. Guards against one-dimensional analysis. |
| **Project Portfolio Strength** | ≥ 80% | For fixtures whose résumé has projects, whether the analysis surfaces ≥ 1 `portfolio`-category strength (fixtures without projects auto-pass). |
| **Project Plan Integration** | ≥ 70% | For fixtures with projects, whether ≥ 1 weekly todo references an existing project name by case-insensitive substring (the plan should build on what the candidate already has). |
| **Hidden Expectation Coverage** | ≥ 66% | Whether the analysis surfaces ≥ 1 **implicit**, non-JD-literal expectation the reference corpus ties to the role/tier (README gap area #2). A RAG-grounding metric — needs the reference corpus seeded. |
| **Prerequisite Ordering** | = 100% | Whether no foundational gap is ranked below an advanced gap that depends on it, for each `[before, after]` pair the fixture declares (rank = priority weight, then array index). README gap area #5. |
| **Contextual Depth** (LLM-judge) | ≥ 0.70 | An LLM judge scores 0–1 the holistic depth beyond keyword matching — skill transferability, company-stage/tier fit, and market relevance (README gap areas #1 / #3 / #4). Shows `SKIP` under `--skip-llm-judge`. |

**Status legend:** `PASS` / `FAIL` against the gate · `INFO` = reported but not gated · `SKIP` = LLM-judge metric not computed (`--skip-llm-judge`).

