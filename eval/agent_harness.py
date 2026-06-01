"""
Agent Output Quality Evaluation Harness (agent_harness.py)
=====================================================

Calls the POST /api/analyze endpoint to measure the following metrics:

  1. Schema Compliance Rate   — CareerPlanOutput JSON schema compliance
  2. JSON Parse Error Rate    — Rate of JSON parsing failures
  3. Gap Faithfulness         — Whether gap analysis is based on JD evidence (LLM-as-judge)
  4. Plan Completeness Rate   — Rate of meeting todos >= 3 per week
  5. Date Consistency Rate    — Weekly date continuity (no gaps)
  6. p50 / p95 Latency        — Percentile response times
  7. Avg Cost / Request       — Estimated cost based on gemini-2.0-flash pricing

RAG-grounding metrics (added once the Pinecone reference corpus — the report
files synced from Google Drive, README §2 Categories A–D — is seeded). These
measure whether the reference context actually reduces the five contextual gaps
the README §1 enumerates, i.e. that output quality improves *beyond* naive
keyword matching:

  8. Hidden Expectation Coverage — gap analysis surfaces at least one implicit,
                                   non-JD-literal expectation for the role/tier
                                   (README gap area #2)
  9. Prerequisite Ordering       — foundational gaps are not ranked below the
                                   advanced gaps that depend on them
                                   (README gap area #5)
 10. Contextual Depth (LLM-judge)— holistic score for skill transferability,
                                   company-tier fit, and market relevance
                                   (README gap areas #1, #3, #4)

Execution:
    # Run server first: pnpm dev (in root directory)
    cd eval
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    python agent_harness.py
    python agent_harness.py --base-url http://localhost:3000 --skip-llm-judge
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import jsonschema
from dotenv import load_dotenv
from tabulate import tabulate

# ── Environment setup ─────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent.parent / ".env")
GOOGLE_API_KEY: str | None = os.environ.get("GOOGLE_API_KEY") or os.environ.get(
    "GEMINI_API_KEY"
)

# Gemini Flash Lite pricing (USD per 1M tokens, for input ≤128k)
PRICE_INPUT_PER_1M = 0.075
PRICE_OUTPUT_PER_1M = 0.30

# LLM-as-judge model. Defaults to the project's standard model (proven available with the
# project's GOOGLE_API_KEY, unlike the older gemini-2.0 line); override with EVAL_JUDGE_MODEL.
JUDGE_MODEL = os.environ.get("EVAL_JUDGE_MODEL", "gemini-3.1-flash-lite-preview")

# ── Thresholds ────────────────────────────────────────────────────────────────

THRESHOLDS: dict[str, float] = {
    "schema_compliance_rate": 0.95,
    "json_parse_error_rate": 0.05,             # must be below this value to PASS
    "gap_faithfulness": 0.70,
    "plan_completeness_rate": 0.90,
    "date_consistency_rate": 1.00,
    "p95_latency_s": 30.0,                     # must be below this value to PASS
    "avg_cost_usd": 0.01,                      # must be below this value to PASS
    "match_score_in_range_rate": 0.80,
    "category_diversity_rate": 1.00,
    # Content-accuracy vs. labeled gaps (expected_gaps_keywords). Gated leniently to start;
    # raise as the golden set matures. gap_precision is reported INFO-only (labels are non-exhaustive).
    "gap_recall": 0.50,
    "project_portfolio_strength_rate": 0.80,   # fixtures with projects must have ≥1 portfolio strength
    "project_plan_integration_rate": 0.70,     # fixtures with projects must reference a project in ≥1 todo
    # ── RAG-grounding thresholds (reference corpus must be seeded) ──────────────
    "hidden_expectation_coverage_rate": 0.66,  # surfaces ≥1 implicit expectation (README gap #2)
    "prerequisite_ordering_rate": 1.00,        # ordering invariant — never rank a prereq below its dependant (gap #5)
    "contextual_depth": 0.70,                  # LLM-judge depth beyond keyword matching (gaps #1/#3/#4)
}

# Priority ranking weights — lower number == higher priority (ranked earlier).
PRIORITY_WEIGHT: dict[str, int] = {"high": 0, "medium": 1, "low": 2}

# ── JSON schema definition ────────────────────────────────────────────────────
# Based on the return structure of runCareerAnalysis() in orchestrator.ts.
# Return value: { ...normalizedPlan, career_plan: normalizedPlan, gap_analysis: gapAnalysisData }
# → Both gap_analysis and weeks fields exist at the top level.

CAREER_PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["gap_analysis", "weeks"],
    "properties": {
        "gap_analysis": {
            "type": "object",
            "required": [
                "target_role",
                "strengths",
                "gaps",
                "priority_order",
                "overall_match_score",
                "summary",
            ],
            "properties": {
                "target_role": {"type": "string", "minLength": 1},
                "strengths": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["id", "category", "item", "evidence"],
                        "properties": {
                            "id": {"type": "string"},
                            "category": {
                                "enum": [
                                    "skill",
                                    "experience",
                                    "certification",
                                    "portfolio",
                                    "keyword",
                                ]
                            },
                            "item": {"type": "string"},
                            "evidence": {"type": "string"},
                        },
                    },
                },
                "gaps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["id", "category", "item", "priority", "rationale"],
                        "properties": {
                            "category": {
                                "enum": [
                                    "skill",
                                    "experience",
                                    "certification",
                                    "portfolio",
                                    "keyword",
                                ]
                            },
                            "priority": {"enum": ["high", "medium", "low"]},
                        },
                    },
                },
                "priority_order": {"type": "array", "items": {"type": "string"}},
                "overall_match_score": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 100,
                },
                "summary": {"type": "string", "minLength": 1},
            },
        },
        "weeks": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "required": ["week_number", "date_range", "theme", "todos"],
                "properties": {
                    "week_number": {"type": "integer", "minimum": 1},
                    "date_range": {
                        "type": "object",
                        "required": ["start", "end"],
                        "properties": {
                            "start": {
                                "type": "string",
                                "pattern": r"^\d{4}-\d{2}-\d{2}$",
                            },
                            "end": {
                                "type": "string",
                                "pattern": r"^\d{4}-\d{2}-\d{2}$",
                            },
                        },
                    },
                    "theme": {"type": "string", "minLength": 1},
                    "todos": {"type": "array"},
                },
            },
        },
    },
}

# ── Structural validation ─────────────────────────────────────────────────────


def check_plan_completeness(data: dict) -> bool:
    """Checks that every week has at least 3 todos."""
    weeks = data.get("weeks", [])
    if not weeks:
        return False
    return all(len(w.get("todos", [])) >= 3 for w in weeks)


def check_date_consistency(data: dict) -> bool:
    """
    Checks that weekly date_ranges are contiguous in time order.
    - end >= start (within each week)
    - next week start <= previous week end + 2 days (allowed gap)
    """
    weeks = data.get("weeks", [])
    if not weeks:
        return False
    try:
        for i, w in enumerate(weeks):
            dr = w.get("date_range", {})
            start = datetime.strptime(dr["start"], "%Y-%m-%d")
            end = datetime.strptime(dr["end"], "%Y-%m-%d")
            if end < start:
                return False
            if i > 0:
                prev_end = datetime.strptime(
                    weeks[i - 1]["date_range"]["end"], "%Y-%m-%d"
                )
                # Discontinuous if next week start is more than 2 days after previous week end
                if start > prev_end + timedelta(days=2):
                    return False
        return True
    except (KeyError, ValueError, TypeError):
        return False


def check_portfolio_strengths(data: dict) -> bool:
    """
    Checks that gap_analysis.strengths contains at least one portfolio-category item.
    Only meaningful when the resume has projects (checked by caller via fixture).
    """
    strengths = data.get("gap_analysis", {}).get("strengths", [])
    return any(s.get("category") == "portfolio" for s in strengths)


def check_project_plan_integration(data: dict, fixture: dict) -> bool:
    """
    Checks that at least one todo title or description references an existing project name
    from the fixture's resume. Case-insensitive substring match.
    """
    project_names = [
        p.get("name", "").lower()
        for p in fixture.get("request", {}).get("resumeJson", {}).get("projects", [])
        if p.get("name")
    ]
    if not project_names:
        return True  # no projects in fixture — skip check

    weeks = data.get("weeks", [])
    for week in weeks:
        for todo in week.get("todos", []):
            text = (
                (todo.get("title") or "") + " " + (todo.get("description") or "")
            ).lower()
            if any(name in text for name in project_names):
                return True
    return False


# ── RAG-grounding structural checks ───────────────────────────────────────────
# These checks are only meaningful once the Pinecone reference corpus (README §2,
# the report files synced from Google Drive) is seeded — the reference context is
# what allows the agent to reason about expectations that are NOT spelled out in
# the JD. They are fixture-driven: a fixture that does not declare the relevant
# expectation field is treated as "not applicable" and passes.


def check_hidden_expectations(data: dict, fixture: dict) -> bool:
    """
    Checks that the gap analysis surfaces at least one *implicit* expectation —
    a skill/competency that the reference corpus associates with the role + company
    tier but that is NOT spelled out verbatim in the JD (README gap area #2).

    Lenient OR-match: passing requires only one of the fixture's expected hidden
    expectations to appear anywhere in the gap_analysis (case-insensitive).
    """
    expected = [e.lower() for e in fixture.get("expected_hidden_expectations", [])]
    if not expected:
        return True  # fixture does not exercise this dimension — not applicable
    blob = json.dumps(data.get("gap_analysis", {}), ensure_ascii=False).lower()
    return any(e in blob for e in expected)


def check_prerequisite_ordering(data: dict, fixture: dict) -> bool:
    """
    Checks that no foundational gap is ranked *below* an advanced gap that depends
    on it (README gap area #5 — unstructured progression trajectories).

    For each [before, after] pair the fixture declares, locate the first gap that
    mentions each term and compare their rank, where rank = (priority_weight,
    array_index). The prerequisite (`before`) must not rank lower than its
    dependant (`after`). A pair whose terms are not both present is skipped.
    """
    pairs = fixture.get("expected_prerequisite_pairs", [])
    if not pairs:
        return True  # not applicable
    gaps = data.get("gap_analysis", {}).get("gaps", [])
    if not gaps:
        return False

    def rank_of(term: str) -> tuple[int, int] | None:
        term = term.lower()
        for idx, g in enumerate(gaps):
            text = ((g.get("item") or "") + " " + (g.get("rationale") or "")).lower()
            if term in text:
                return (PRIORITY_WEIGHT.get(g.get("priority", ""), 1), idx)
        return None

    for before, after in pairs:
        rb = rank_of(before)
        ra = rank_of(after)
        if rb is None or ra is None:
            continue  # cannot compare — skip this pair
        if rb > ra:  # prerequisite ranked strictly below its dependant → violation
            return False
    return True


def score_gap_recall_precision(
    data: dict, fixture: dict
) -> tuple[float | None, float | None]:
    """
    Content-accuracy of the gap analysis vs. the fixture's labeled gap keywords
    (expected_gaps_keywords). This complements the form-level quality gate with a
    label-based accuracy signal.

      recall    = labeled keywords surfaced anywhere in gaps[] / total labeled keywords
                  → the primary content-accuracy metric (gated)
      precision = gap items that hit ≥1 labeled keyword / total gap items
                  → a rough relevance signal. Labels are intentionally non-exhaustive
                    (the model may surface valid gaps not in the label set), so this is
                    reported INFO-only and never gated.

    Returns (None, None) when the fixture declares no labels — the dimension is N/A.
    """
    expected = [k.lower() for k in fixture.get("expected_gaps_keywords", [])]
    if not expected:
        return None, None

    gaps = data.get("gap_analysis", {}).get("gaps", [])
    gap_texts = [
        ((g.get("item") or "") + " " + (g.get("rationale") or "")).lower() for g in gaps
    ]

    matched_keywords = sum(1 for kw in expected if any(kw in t for t in gap_texts))
    recall = matched_keywords / len(expected)

    if gap_texts:
        relevant_items = sum(1 for t in gap_texts if any(kw in t for kw in expected))
        precision = relevant_items / len(gap_texts)
    else:
        precision = 0.0

    return recall, precision


# ── LLM-as-judge: Contextual Depth ────────────────────────────────────────────


def judge_contextual_depth(
    fixture: dict,
    response_json: dict,
    model: Any,
) -> float:
    """
    Uses Gemini Flash to score how much *contextual depth* the gap analysis
    demonstrates beyond naive keyword matching, on a 0.0~1.0 scale. This is the
    headline measure of whether the RAG reference corpus is paying off: it rewards
    reasoning the corpus is meant to enable (README gap areas #1, #3, #4):

      - Skill transferability / synonym resolution (e.g. ECS → Cloud Run, Python → Node.js)
      - Company stage & tier fit (startup generalist vs. big-tech specialist)
      - Market relevance (prioritising current, in-demand skills over legacy ones)
    """
    gap_analysis = response_json.get("gap_analysis", {})
    if not gap_analysis.get("gaps"):
        return 0.0

    target_role = fixture.get("request", {}).get("targetRole", "")
    target_company = fixture.get("request", {}).get("targetCompany", "")
    analysis_text = json.dumps(
        {
            "summary": gap_analysis.get("summary", ""),
            "strengths": [
                {"item": s.get("item", ""), "evidence": s.get("evidence", "")}
                for s in gap_analysis.get("strengths", [])[:6]
            ],
            "gaps": [
                {"item": g.get("item", ""), "rationale": g.get("rationale", "")}
                for g in gap_analysis.get("gaps", [])[:6]
            ],
        },
        ensure_ascii=False,
    )

    prompt = f"""You are an expert evaluator of AI career-coaching output.

Score, from 0.0 to 1.0, how much CONTEXTUAL DEPTH the gap analysis below shows
BEYOND naive keyword matching, for a candidate targeting the role
"{target_role}" at "{target_company}".

Award credit for any of these (the more, the higher the score):
- Skill transferability / synonym resolution (recognising that existing skills
  map to required ones, e.g. AWS ECS ↔ GCP Cloud Run, Python ↔ Node.js paradigm).
- Company stage & tier fit (startup generalist vs. big-tech specialist expectations).
- Market relevance (prioritising currently in-demand skills, deprioritising legacy).

Scoring guide:
- 1.0: Rich, role/tier-aware reasoning across multiple dimensions above.
- 0.7: Some genuine contextual reasoning, not just restating JD keywords.
- 0.4: Mostly keyword restatement with little added context.
- 0.0: Pure keyword matching, no contextual reasoning.

Output ONLY this JSON: {{"score": 0.8, "reasoning": "one sentence"}}

[Gap Analysis]
{analysis_text}
"""

    try:
        resp = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "max_output_tokens": 256,
            },
        )
        parsed = json.loads(resp.text)
        score = float(parsed.get("score", 0.0))
        return max(0.0, min(1.0, score))
    except Exception as exc:
        print(f"  [WARN] LLM contextual-depth judge error: {exc}")
        return 0.0


# ── Cost estimation ───────────────────────────────────────────────────────────


def estimate_cost(
    fixture: dict, response_json: dict | None
) -> tuple[int, int, float]:
    """
    Estimates cost from payload size since HTTP responses do not include token counts.
    - 4 chars ≈ 1 token (typical Korean/English mixed content)
    - System prompt overhead ≈ 2,000 chars (combined for both agents)
    - Accounts for two LLM calls: Gap Analyzer and Planner.
    """
    CHARS_PER_TOKEN = 4
    SYSTEM_OVERHEAD = 2000  # combined system prompts for both agents

    req_chars = len(json.dumps(fixture["request"], ensure_ascii=False)) + SYSTEM_OVERHEAD
    # Two LLM calls (gap analysis prompt + planning prompt)
    prompt_tokens = int(req_chars / CHARS_PER_TOKEN) * 2
    completion_chars = len(json.dumps(response_json, ensure_ascii=False)) if response_json else 0
    completion_tokens = int(completion_chars / CHARS_PER_TOKEN)

    cost = (
        prompt_tokens / 1_000_000 * PRICE_INPUT_PER_1M
        + completion_tokens / 1_000_000 * PRICE_OUTPUT_PER_1M
    )
    return prompt_tokens, completion_tokens, cost


# ── LLM-as-judge: Gap Faithfulness ───────────────────────────────────────────


def judge_gap_faithfulness(
    fixture: dict,
    response_json: dict,
    model: Any,
) -> float:
    """
    Uses Gemini Flash to score how faithfully the gap analysis reflects
    the JD context (or expected_gaps_keywords) on a 0.0~1.0 scale.
    """
    gaps = response_json.get("gap_analysis", {}).get("gaps", [])
    if not gaps:
        return 0.0

    # Use fixture's expected_gaps_keywords as a proxy JD context
    jd_context = "Core required skills: " + ", ".join(fixture.get("expected_gaps_keywords", []))
    gaps_sample = gaps[:6]  # Evaluate at most 6 gaps to reduce cost
    gaps_text = json.dumps(
        [{"item": g.get("item", ""), "rationale": g.get("rationale", "")} for g in gaps_sample],
        ensure_ascii=False,
    )

    prompt = f"""You are an AI output evaluation expert.

Compare the [JD Context] and [Gap Analysis Result] below, 
and evaluate how faithfully the gap analysis reflects the JD context on a score of 0.0 to 1.0.

Criteria:
- 1.0: All gap items have a clear association with the JD context and the rationale is specific.
- 0.7: Most gaps are JD-related, but some evidence is ambiguous.
- 0.4: Less than half of the gaps are JD-related.
- 0.0: Most gaps are unrelated to the JD or no rationale is provided.

You must output only in the following JSON format:
{{"score": 0.8, "reasoning": "Reason within one sentence"}}

[JD Context]
{jd_context}

[Gap Analysis Result]
{gaps_text}
"""

    try:
        resp = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "max_output_tokens": 256,
            },
        )
        parsed = json.loads(resp.text)
        score = float(parsed.get("score", 0.0))
        return max(0.0, min(1.0, score))
    except Exception as exc:
        print(f"  [WARN] LLM judge error: {exc}")
        return 0.0


# ── Fixture execution ─────────────────────────────────────────────────────────


def run_fixture(fixture: dict, client: httpx.Client, endpoint: str) -> dict:
    """
    Calls /api/analyze for a single fixture and returns the result.
    """
    result: dict[str, Any] = {
        "fixture_id": fixture["id"],
        "run_index": 0,
        "latency_s": None,
        "status_code": None,
        "json_parse_ok": False,
        "schema_valid": False,
        "schema_errors": [],
        "gap_faithfulness": None,
        "contextual_depth": None,
        "gap_recall": None,
        "gap_precision": None,
        "plan_completeness": False,
        "date_consistent": False,
        "match_score_in_range": False,
        "category_diversity_ok": False,
        "project_portfolio_strength": False,
        "project_plan_integration": False,
        "hidden_expectation_coverage": False,
        "prerequisite_ordering_ok": False,
        "overall_match_score": None,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "cost_usd": 0.0,
        "response_json": None,
        "error": None,
    }

    t0 = time.time()
    try:
        # /api/analyze responds with text/event-stream (SSE). We need to read the
        # stream line-by-line and extract the JSON payload from the `event: result`
        # frame. Earlier `event: progress` frames are ignored; an `event: error`
        # frame is surfaced as a failure.
        data = None
        sse_error: str | None = None
        with client.stream("POST", endpoint, json=fixture["request"]) as resp:
            result["status_code"] = resp.status_code
            if resp.status_code != 200:
                body_preview = resp.read().decode("utf-8", errors="replace")[:300]
                result["latency_s"] = time.time() - t0
                result["error"] = f"HTTP {resp.status_code}: {body_preview}"
                return result

            current_event = "message"
            for raw in resp.iter_lines():
                # httpx yields str when the response is text; normalise just in case.
                line = raw if isinstance(raw, str) else raw.decode("utf-8", errors="replace")
                if not line:
                    current_event = "message"
                    continue
                if line.startswith("event:"):
                    current_event = line[6:].strip()
                elif line.startswith("data:"):
                    payload = line[5:].strip()
                    if current_event == "result":
                        try:
                            data = json.loads(payload)
                        except json.JSONDecodeError as exc:
                            sse_error = f"result payload not JSON: {exc}"
                    elif current_event == "error":
                        try:
                            sse_error = json.loads(payload).get("message") or payload
                        except json.JSONDecodeError:
                            sse_error = payload

        result["latency_s"] = time.time() - t0

        if data is None:
            result["error"] = sse_error or "No `event: result` frame received from SSE stream"
            return result

        result["json_parse_ok"] = True
        result["response_json"] = data

    except httpx.ConnectError:
        result["latency_s"] = time.time() - t0
        result["error"] = (
            "CONNECTION_REFUSED — Check if the server is running. (pnpm dev)"
        )
        return result
    except httpx.TimeoutException:
        result["latency_s"] = time.time() - t0
        result["error"] = "TIMEOUT — Try increasing the --timeout value."
        return result
    except Exception as exc:
        result["latency_s"] = time.time() - t0
        result["error"] = str(exc)
        return result

    # JSON schema validation
    validator = jsonschema.Draft7Validator(CAREER_PLAN_SCHEMA)
    errors = list(validator.iter_errors(data))
    result["schema_valid"] = len(errors) == 0
    result["schema_errors"] = [e.message for e in errors[:3]]

    # Structural checks
    result["overall_match_score"] = (
        data.get("gap_analysis", {}).get("overall_match_score")
    )
    result["plan_completeness"] = check_plan_completeness(data)
    result["date_consistent"] = check_date_consistency(data)

    # Match score range check
    expected_range = fixture.get("expected_match_score_range")
    if expected_range and result["overall_match_score"] is not None:
        lo, hi = expected_range[0], expected_range[1]
        result["match_score_in_range"] = lo <= result["overall_match_score"] <= hi

    # Category diversity: ≥3 distinct categories across combined gaps + strengths,
    # and all expected_categories must be present if specified in the fixture.
    gap_analysis = data.get("gap_analysis", {})
    all_categories: set[str] = set()
    for item in gap_analysis.get("gaps", []):
        cat = item.get("category", "")
        if cat:
            all_categories.add(cat)
    for item in gap_analysis.get("strengths", []):
        cat = item.get("category", "")
        if cat:
            all_categories.add(cat)
    expected_cats = set(fixture.get("expected_categories", []))
    result["category_diversity_ok"] = (
        len(all_categories) >= 3
        and (not expected_cats or expected_cats.issubset(all_categories))
    )

    # Project integration checks (only when resume has projects)
    resume_projects = fixture.get("request", {}).get("resumeJson", {}).get("projects", [])
    if resume_projects:
        result["project_portfolio_strength"] = check_portfolio_strengths(data)
        result["project_plan_integration"] = check_project_plan_integration(data, fixture)
    else:
        # No projects in resume — treat as passing (not applicable)
        result["project_portfolio_strength"] = True
        result["project_plan_integration"] = True

    # RAG-grounding structural checks (fixture-driven; N/A → pass)
    result["hidden_expectation_coverage"] = check_hidden_expectations(data, fixture)
    result["prerequisite_ordering_ok"] = check_prerequisite_ordering(data, fixture)

    # Content-accuracy vs. labeled gaps (None when the fixture has no labels)
    recall, precision = score_gap_recall_precision(data, fixture)
    result["gap_recall"] = recall
    result["gap_precision"] = precision

    return result


# ── Aggregation ───────────────────────────────────────────────────────────────


def compute_metrics(results: list[dict]) -> dict:
    n = len(results)
    if n == 0:
        return {}

    successful = [r for r in results if r["json_parse_ok"]]
    latencies = sorted(r["latency_s"] for r in results if r["latency_s"] is not None)

    def pct(lst: list, p: float) -> float:
        if not lst:
            return float("nan")
        idx = max(0, min(int(len(lst) * p / 100), len(lst) - 1))
        return lst[idx]

    faithfulness_scores = [
        r["gap_faithfulness"]
        for r in successful
        if r["gap_faithfulness"] is not None
    ]
    depth_scores = [
        r["contextual_depth"]
        for r in successful
        if r["contextual_depth"] is not None
    ]
    recall_scores = [
        r["gap_recall"] for r in successful if r.get("gap_recall") is not None
    ]
    precision_scores = [
        r["gap_precision"] for r in successful if r.get("gap_precision") is not None
    ]

    return {
        "schema_compliance_rate": sum(1 for r in successful if r["schema_valid"]) / n,
        "json_parse_error_rate": 1 - len(successful) / n,
        "gap_faithfulness": (
            sum(faithfulness_scores) / len(faithfulness_scores)
            if faithfulness_scores
            else float("nan")
        ),
        "plan_completeness_rate": (
            sum(1 for r in successful if r["plan_completeness"]) / len(successful)
            if successful
            else 0.0
        ),
        "date_consistency_rate": (
            sum(1 for r in successful if r["date_consistent"]) / len(successful)
            if successful
            else 0.0
        ),
        "p50_latency_s": pct(latencies, 50),
        "p95_latency_s": pct(latencies, 95),
        "avg_cost_usd": sum(r["cost_usd"] for r in results) / n,
        "match_score_in_range_rate": (
            sum(1 for r in successful if r.get("match_score_in_range", False)) / len(successful)
            if successful
            else 0.0
        ),
        "gap_recall": (
            sum(recall_scores) / len(recall_scores) if recall_scores else float("nan")
        ),
        "gap_precision": (
            sum(precision_scores) / len(precision_scores)
            if precision_scores
            else float("nan")
        ),
        "category_diversity_rate": (
            sum(1 for r in successful if r.get("category_diversity_ok", False)) / len(successful)
            if successful
            else 0.0
        ),
        "project_portfolio_strength_rate": (
            sum(1 for r in successful if r.get("project_portfolio_strength", False)) / len(successful)
            if successful
            else 0.0
        ),
        "project_plan_integration_rate": (
            sum(1 for r in successful if r.get("project_plan_integration", False)) / len(successful)
            if successful
            else 0.0
        ),
        "hidden_expectation_coverage_rate": (
            sum(1 for r in successful if r.get("hidden_expectation_coverage", False)) / len(successful)
            if successful
            else 0.0
        ),
        "prerequisite_ordering_rate": (
            sum(1 for r in successful if r.get("prerequisite_ordering_ok", False)) / len(successful)
            if successful
            else 0.0
        ),
        "contextual_depth": (
            sum(depth_scores) / len(depth_scores)
            if depth_scores
            else float("nan")
        ),
        "total_fixtures": n,
        "successful_fixtures": len(successful),
    }


# ── Output ────────────────────────────────────────────────────────────────────


def _pass_fail(condition: bool) -> str:
    return "PASS" if condition else "FAIL"


def _fmt_nan(v: float, fmt: str) -> str:
    import math
    return "N/A (--skip-llm-judge)" if math.isnan(v) else format(v, fmt)


def _summary_rows(metrics: dict) -> list[list[str]]:
    """Builds the [Metric, Score, Threshold, Status] rows shared by the console
    summary (print_summary) and the Markdown report (save_markdown_report), so the
    two presentations can never drift apart."""
    import math

    def _pct(v: float) -> str:
        return "N/A" if (isinstance(v, float) and math.isnan(v)) else f"{v:.2%}"

    return [
        [
            "Schema Compliance Rate",
            f"{metrics['schema_compliance_rate']:.2%}",
            f">= {THRESHOLDS['schema_compliance_rate']:.0%}",
            _pass_fail(metrics["schema_compliance_rate"] >= THRESHOLDS["schema_compliance_rate"]),
        ],
        [
            "JSON Parse Error Rate",
            f"{metrics['json_parse_error_rate']:.2%}",
            f"<  {THRESHOLDS['json_parse_error_rate']:.0%}",
            _pass_fail(metrics["json_parse_error_rate"] <= THRESHOLDS["json_parse_error_rate"]),
        ],
        [
            "Gap Faithfulness (LLM-judge)",
            _fmt_nan(metrics["gap_faithfulness"], ".4f"),
            f">= {THRESHOLDS['gap_faithfulness']}",
            (
                "SKIP"
                if __import__("math").isnan(metrics["gap_faithfulness"])
                else _pass_fail(metrics["gap_faithfulness"] >= THRESHOLDS["gap_faithfulness"])
            ),
        ],
        [
            "Plan Completeness Rate",
            f"{metrics['plan_completeness_rate']:.2%}",
            f">= {THRESHOLDS['plan_completeness_rate']:.0%}",
            _pass_fail(metrics["plan_completeness_rate"] >= THRESHOLDS["plan_completeness_rate"]),
        ],
        [
            "Date Consistency Rate",
            f"{metrics['date_consistency_rate']:.2%}",
            "= 100%",
            _pass_fail(metrics["date_consistency_rate"] >= THRESHOLDS["date_consistency_rate"]),
        ],
        [
            "p50 Latency",
            f"{metrics['p50_latency_s']:.1f}s",
            "—",
            "INFO",
        ],
        [
            "p95 Latency",
            f"{metrics['p95_latency_s']:.1f}s",
            f"< {THRESHOLDS['p95_latency_s']}s",
            _pass_fail(metrics["p95_latency_s"] <= THRESHOLDS["p95_latency_s"]),
        ],
        [
            "Avg Cost / Request",
            f"${metrics['avg_cost_usd']:.4f}",
            f"< ${THRESHOLDS['avg_cost_usd']}",
            _pass_fail(metrics["avg_cost_usd"] <= THRESHOLDS["avg_cost_usd"]),
        ],
        [
            "Match Score In Range",
            f"{metrics['match_score_in_range_rate']:.2%}",
            f">= {THRESHOLDS['match_score_in_range_rate']:.0%}",
            _pass_fail(metrics["match_score_in_range_rate"] >= THRESHOLDS["match_score_in_range_rate"]),
        ],
        [
            "Gap Recall (vs labels)",
            _pct(metrics["gap_recall"]),
            f">= {THRESHOLDS['gap_recall']:.0%}",
            (
                "SKIP"
                if math.isnan(metrics["gap_recall"])
                else _pass_fail(metrics["gap_recall"] >= THRESHOLDS["gap_recall"])
            ),
        ],
        [
            "Gap Precision (INFO)",
            _pct(metrics["gap_precision"]),
            "—",
            "INFO",
        ],
        [
            "Category Diversity (>=3 dims)",
            f"{metrics['category_diversity_rate']:.2%}",
            "= 100%",
            _pass_fail(metrics["category_diversity_rate"] >= THRESHOLDS["category_diversity_rate"]),
        ],
        [
            "Project Portfolio Strength",
            f"{metrics['project_portfolio_strength_rate']:.2%}",
            f">= {THRESHOLDS['project_portfolio_strength_rate']:.0%}",
            _pass_fail(metrics["project_portfolio_strength_rate"] >= THRESHOLDS["project_portfolio_strength_rate"]),
        ],
        [
            "Project Plan Integration",
            f"{metrics['project_plan_integration_rate']:.2%}",
            f">= {THRESHOLDS['project_plan_integration_rate']:.0%}",
            _pass_fail(metrics["project_plan_integration_rate"] >= THRESHOLDS["project_plan_integration_rate"]),
        ],
        [
            "Hidden Expectation Coverage",
            f"{metrics['hidden_expectation_coverage_rate']:.2%}",
            f">= {THRESHOLDS['hidden_expectation_coverage_rate']:.0%}",
            _pass_fail(metrics["hidden_expectation_coverage_rate"] >= THRESHOLDS["hidden_expectation_coverage_rate"]),
        ],
        [
            "Prerequisite Ordering",
            f"{metrics['prerequisite_ordering_rate']:.2%}",
            "= 100%",
            _pass_fail(metrics["prerequisite_ordering_rate"] >= THRESHOLDS["prerequisite_ordering_rate"]),
        ],
        [
            "Contextual Depth (LLM-judge)",
            _fmt_nan(metrics["contextual_depth"], ".4f"),
            f">= {THRESHOLDS['contextual_depth']}",
            (
                "SKIP"
                if __import__("math").isnan(metrics["contextual_depth"])
                else _pass_fail(metrics["contextual_depth"] >= THRESHOLDS["contextual_depth"])
            ),
        ],
    ]


def print_summary(metrics: dict, all_pass: bool) -> None:
    print()
    print("=" * 72)
    print("  readmycareer.com — Agent Output Quality Evaluation")
    print("=" * 72)

    rows = _summary_rows(metrics)
    print(
        tabulate(
            rows,
            headers=["Metric", "Score", "Threshold", "Status"],
            tablefmt="simple",
        )
    )
    print("-" * 72)
    print(
        f"Fixtures: {metrics['successful_fixtures']}/{metrics['total_fixtures']} successful"
    )
    print(
        f"Overall:  {'PASS — all thresholds met' if all_pass else 'FAIL — one or more metrics below threshold'}"
    )
    print("=" * 72)


# ── CSV export ────────────────────────────────────────────────────────────────


def save_csv(results: list[dict], output_path: Path) -> None:
    if not results:
        return
    # Exclude response_json from CSV as it is too large
    exclude = {"response_json"}
    fieldnames = [k for k in results[0] if k not in exclude]
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            writer.writerow({k: v for k, v in r.items() if k in fieldnames})


# ── Markdown report ─────────────────────────────────────────────────────────
# Human-readable companion to the CSV: an aggregate table, a per-fixture table,
# and a glossary explaining what every metric means and why it is gated. Written
# to documents/ on every run so the scores are reviewable without a spreadsheet.

# Glossary text is static (the metric definitions live in the scoring functions
# above); keep it in sync when a metric is added or its threshold rationale changes.
_METRIC_GLOSSARY = """\
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
"""


def _fmt_cell(value: Any, kind: str) -> str:
    """Formats one per-fixture cell for the Markdown table; None renders as an em dash."""
    if value is None:
        return "—"
    if kind == "bool":
        return "✓" if value else "✗"
    if kind == "latency":
        return f"{float(value):.1f}s"
    if kind == "cost":
        return f"${float(value):.4f}"
    if kind == "float":
        return f"{float(value):.2f}"
    return str(value)


def save_markdown_report(
    results: list[dict],
    metrics: dict,
    all_pass: bool,
    md_path: Path,
) -> None:
    """Renders a human-readable Markdown report (aggregate table + per-fixture table +
    metric glossary) next to the CSV. Regenerated on every harness run that produces
    results, so the scores stay reviewable without opening a spreadsheet."""
    if not results:
        return

    summary_md = tabulate(
        _summary_rows(metrics),
        headers=["Metric", "Score", "Threshold", "Status"],
        tablefmt="github",
    )

    per_fixture_headers = [
        "Fixture", "Latency", "Schema", "Faithfulness", "Depth",
        "Recall", "Plan ≥3", "Dates", "Hidden Exp.", "Match", "Cost",
    ]
    per_fixture_rows = [
        [
            r.get("fixture_id", "—"),
            _fmt_cell(r.get("latency_s"), "latency"),
            _fmt_cell(r.get("schema_valid"), "bool"),
            _fmt_cell(r.get("gap_faithfulness"), "float"),
            _fmt_cell(r.get("contextual_depth"), "float"),
            _fmt_cell(r.get("gap_recall"), "float"),
            _fmt_cell(r.get("plan_completeness"), "bool"),
            _fmt_cell(r.get("date_consistent"), "bool"),
            _fmt_cell(r.get("hidden_expectation_coverage"), "bool"),
            _fmt_cell(r.get("overall_match_score"), "raw"),
            _fmt_cell(r.get("cost_usd"), "cost"),
        ]
        for r in results
    ]
    per_fixture_md = tabulate(
        per_fixture_rows, headers=per_fixture_headers, tablefmt="github"
    )

    generated = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    overall = (
        "✅ **PASS** — all gated thresholds met"
        if all_pass
        else "❌ **FAIL** — one or more gated metrics below threshold"
    )

    content = f"""# Agent Output Quality Report

> **Auto-generated** by `eval/agent_harness.py` on every run — do not edit by hand.
> Raw per-case data lives in [`eval/agent_harness_results.csv`](../eval/agent_harness_results.csv).
> To refresh: run `pnpm dev`, then `pnpm eval:agents` (or `pnpm eval`).

- **Generated:** {generated}
- **Result:** {overall}
- **Fixtures:** {metrics['successful_fixtures']}/{metrics['total_fixtures']} successful
- **LLM-judge model:** `{JUDGE_MODEL}`

## Aggregate Metrics

{summary_md}

## Per-Fixture Scores

{per_fixture_md}

Legend: ✓ / ✗ = pass / fail per fixture · Faithfulness & Depth = LLM-judge (0–1) ·
Recall = vs labeled gaps (0–1) · Match = `overall_match_score` (0–100).

## What Each Metric Means

{_METRIC_GLOSSARY}
"""

    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(content, encoding="utf-8")


# ── Overall pass/fail judgment ────────────────────────────────────────────────


def all_thresholds_met(metrics: dict) -> bool:
    import math

    checks = [
        metrics["schema_compliance_rate"] >= THRESHOLDS["schema_compliance_rate"],
        metrics["json_parse_error_rate"] <= THRESHOLDS["json_parse_error_rate"],
        metrics["plan_completeness_rate"] >= THRESHOLDS["plan_completeness_rate"],
        metrics["date_consistency_rate"] >= THRESHOLDS["date_consistency_rate"],
        metrics["p95_latency_s"] <= THRESHOLDS["p95_latency_s"],
        metrics["avg_cost_usd"] <= THRESHOLDS["avg_cost_usd"],
        metrics["match_score_in_range_rate"] >= THRESHOLDS["match_score_in_range_rate"],
        metrics["category_diversity_rate"] >= THRESHOLDS["category_diversity_rate"],
        metrics["project_portfolio_strength_rate"] >= THRESHOLDS["project_portfolio_strength_rate"],
        metrics["project_plan_integration_rate"] >= THRESHOLDS["project_plan_integration_rate"],
        metrics["hidden_expectation_coverage_rate"] >= THRESHOLDS["hidden_expectation_coverage_rate"],
        metrics["prerequisite_ordering_rate"] >= THRESHOLDS["prerequisite_ordering_rate"],
    ]
    # gap_recall is NaN only when no fixture declares labels; skip the gate in that case.
    if not math.isnan(metrics.get("gap_recall", float("nan"))):
        checks.append(metrics["gap_recall"] >= THRESHOLDS["gap_recall"])
    # LLM-judge metrics: skip check if NaN (judge was skipped)
    if not math.isnan(metrics["gap_faithfulness"]):
        checks.append(metrics["gap_faithfulness"] >= THRESHOLDS["gap_faithfulness"])
    if not math.isnan(metrics["contextual_depth"]):
        checks.append(metrics["contextual_depth"] >= THRESHOLDS["contextual_depth"])
    return all(checks)


# ── Consistency / variance ────────────────────────────────────────────────────


def compute_consistency(results: list[dict]) -> list[dict]:
    """Per-fixture stdev across repeated runs — quantifies the non-determinism the
    retry gate otherwise hides. Returns [] unless at least one fixture ran ≥2 times."""
    import statistics

    by_fixture: dict[str, list[dict]] = {}
    for r in results:
        by_fixture.setdefault(r["fixture_id"], []).append(r)

    rows: list[dict] = []
    for fid, runs in by_fixture.items():
        if len(runs) < 2:
            continue

        def stdev_of(key: str) -> float:
            vals = [r[key] for r in runs if r.get(key) is not None]
            return statistics.stdev(vals) if len(vals) >= 2 else 0.0

        rows.append(
            {
                "fixture_id": fid,
                "runs": len(runs),
                "match_score_stdev": stdev_of("overall_match_score"),
                "gap_faithfulness_stdev": stdev_of("gap_faithfulness"),
                "gap_recall_stdev": stdev_of("gap_recall"),
                "latency_stdev": stdev_of("latency_s"),
            }
        )
    return rows


def print_consistency(rows: list[dict]) -> None:
    if not rows:
        return
    print("\n" + "=" * 72)
    print("  Consistency / Variance (stdev across repeated runs)")
    print("=" * 72)
    table = [
        [
            r["fixture_id"],
            r["runs"],
            f"{r['match_score_stdev']:.2f}",
            f"{r['gap_faithfulness_stdev']:.3f}",
            f"{r['gap_recall_stdev']:.3f}",
            f"{r['latency_stdev']:.2f}s",
        ]
        for r in rows
    ]
    print(
        tabulate(
            table,
            headers=["Fixture", "Runs", "MatchScore σ", "Faithfulness σ", "Recall σ", "Latency σ"],
            tablefmt="simple",
        )
    )
    print("=" * 72)


# ── Regression baseline + diff ──────────────────────────────────────────────────

BASELINE_PATH = Path(__file__).parent / "baseline.json"

# Metrics tracked in the regression baseline: (metric_key, higher_is_better).
BASELINE_METRICS: list[tuple[str, bool]] = [
    ("schema_compliance_rate", True),
    ("json_parse_error_rate", False),
    ("gap_faithfulness", True),
    ("gap_recall", True),
    ("plan_completeness_rate", True),
    ("date_consistency_rate", True),
    ("p95_latency_s", False),
    ("avg_cost_usd", False),
    ("match_score_in_range_rate", True),
    ("hidden_expectation_coverage_rate", True),
    ("prerequisite_ordering_rate", True),
    ("contextual_depth", True),
]

REGRESSION_ABS_TOL = 0.05  # absolute tolerance for rate/score metrics (0–1 scale)
REGRESSION_REL_TOL = 0.20  # relative tolerance for latency / cost metrics


def _baseline_value(v: Any) -> Any:
    import math

    if isinstance(v, float) and math.isnan(v):
        return None
    return v


def save_baseline(metrics: dict, path: Path) -> None:
    snapshot = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "metrics": {k: _baseline_value(metrics.get(k)) for k, _ in BASELINE_METRICS},
    }
    path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print(f"\n[baseline] Saved baseline snapshot → {path}")


def _fmt_val(v: Any) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.4f}"
    return str(v)


def compare_baseline(metrics: dict, path: Path) -> bool:
    """Diffs current metrics vs. the saved baseline. Returns True when no regression."""
    import math

    if not path.exists():
        print(f"\n[baseline] No baseline at {path} — run with --save-baseline first.")
        return True

    baseline = json.loads(path.read_text(encoding="utf-8"))
    base_metrics = baseline.get("metrics", {})
    rows: list[list[str]] = []
    regressed = False

    for key, higher_is_better in BASELINE_METRICS:
        cur = metrics.get(key)
        base = base_metrics.get(key)
        if (
            cur is None
            or (isinstance(cur, float) and math.isnan(cur))
            or base is None
        ):
            rows.append([key, _fmt_val(base), _fmt_val(cur), "—", "SKIP"])
            continue

        delta = cur - base
        tol = abs(base) * REGRESSION_REL_TOL if key in ("p95_latency_s", "avg_cost_usd") else REGRESSION_ABS_TOL
        is_regression = (delta < -tol) if higher_is_better else (delta > tol)
        improved = (delta > tol) if higher_is_better else (delta < -tol)
        status = "REGRESSED" if is_regression else ("improved" if improved else "ok")
        if is_regression:
            regressed = True
        rows.append([key, _fmt_val(base), _fmt_val(cur), f"{delta:+.4f}", status])

    print("\n" + "=" * 72)
    print(f"  Regression diff vs baseline ({baseline.get('generated_at', '?')})")
    print("=" * 72)
    print(tabulate(rows, headers=["Metric", "Baseline", "Current", "Δ", "Status"], tablefmt="simple"))
    print("=" * 72)
    print(
        "REGRESSION DETECTED — one or more metrics dropped beyond tolerance."
        if regressed
        else "No regressions beyond tolerance."
    )
    return not regressed


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="readmycareer.com agent harness eval")
    parser.add_argument(
        "--base-url",
        default="http://localhost:3000",
        help="Next.js server address (default: http://localhost:3000)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=90,
        help="Request timeout in seconds (default: 90)",
    )
    parser.add_argument(
        "--skip-llm-judge",
        action="store_true",
        help="Skip LLM-as-judge (No GOOGLE_API_KEY required, for fast execution)",
    )
    parser.add_argument(
        "--fixtures",
        default=str(Path(__file__).parent / "fixtures" / "agent_fixtures.json"),
        help="Path to the fixture file",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Run each fixture N times and report output variance (default: 1)",
    )
    parser.add_argument(
        "--save-baseline",
        action="store_true",
        help="Save the aggregate metrics as the regression baseline (eval/baseline.json)",
    )
    parser.add_argument(
        "--compare-baseline",
        action="store_true",
        help="Diff aggregate metrics against eval/baseline.json; fail on regression",
    )
    args = parser.parse_args()
    repeat = max(1, args.repeat)

    endpoint = f"{args.base_url}/api/analyze"

    # Initialize LLM judge
    llm_model = None
    if not args.skip_llm_judge:
        if not GOOGLE_API_KEY:
            print(
                "ERROR: GOOGLE_API_KEY is not set.\n"
                "       Use --skip-llm-judge to skip the LLM judge."
            )
            return 1
        try:
            import google.generativeai as genai

            genai.configure(api_key=GOOGLE_API_KEY)
            llm_model = genai.GenerativeModel(JUDGE_MODEL)
        except ImportError:
            print(
                "ERROR: google-generativeai package is not installed.\n"
                "       Run 'pip install google-generativeai' or use --skip-llm-judge"
            )
            return 1

    # Load fixtures
    fixtures_path = Path(args.fixtures)
    if not fixtures_path.exists():
        print(f"ERROR: Fixture file not found: {fixtures_path}")
        return 1
    fixtures: list[dict] = json.loads(fixtures_path.read_text(encoding="utf-8"))
    print(f"\nLoaded {len(fixtures)} fixtures: {fixtures_path}")
    print(f"Endpoint: {endpoint}")
    judge_status = "OFF" if args.skip_llm_judge else f"ON ({JUDGE_MODEL})"
    print(f"Timeout: {args.timeout}s | LLM judge: {judge_status}")
    print()

    results: list[dict] = []

    def process_one(fixture: dict, i: int, client: httpx.Client) -> dict:
        """Runs a single fixture: analyze + LLM judge + cost estimate, with progress prints."""
        print(f"[{i}/{len(fixtures)}] {fixture['id']}")
        print(f"  → {fixture['description']}")

        result = run_fixture(fixture, client, endpoint)

        if result.get("error"):
            print(f"  ✗ Error: {result['error']}")
        else:
            status_icon = "✓" if result["json_parse_ok"] else "✗"
            schema_status = "Valid" if result["schema_valid"] else f"Error ({len(result['schema_errors'])} errors)"
            print(
                f"  {status_icon} HTTP {result['status_code']} | "
                f"{result['latency_s']:.1f}s | "
                f"Schema: {schema_status} | "
                f"todos/week>=3: {result['plan_completeness']} | "
                f"Date continuity: {result['date_consistent']} | "
                f"Score in range: {result.get('match_score_in_range', 'N/A')} | "
                f"Gap recall: {result.get('gap_recall', 'N/A')}"
            )

            # LLM-as-judge
            if result["json_parse_ok"] and llm_model is not None:
                print("  → LLM judging faithfulness...", end="", flush=True)
                result["gap_faithfulness"] = judge_gap_faithfulness(
                    fixture, result["response_json"], llm_model
                )
                print(f" {result['gap_faithfulness']:.2f}")
                print("  → LLM judging contextual depth...", end="", flush=True)
                result["contextual_depth"] = judge_contextual_depth(
                    fixture, result["response_json"], llm_model
                )
                print(f" {result['contextual_depth']:.2f}")

        # Cost estimation
        pt, ct, cost = estimate_cost(fixture, result.get("response_json"))
        result["prompt_tokens"] = pt
        result["completion_tokens"] = ct
        result["cost_usd"] = cost
        print()
        return result

    with httpx.Client(timeout=args.timeout) as client:
        for run_idx in range(repeat):
            if repeat > 1:
                print(f"\n────── Repeat run {run_idx + 1}/{repeat} ──────")
            for i, fixture in enumerate(fixtures, 1):
                result = process_one(fixture, i, client)
                result["run_index"] = run_idx
                results.append(result)

    # Aggregate and print results
    metrics = compute_metrics(results)
    passed = all_thresholds_met(metrics)
    print_summary(metrics, passed)

    # Consistency report (only meaningful with --repeat > 1)
    if repeat > 1:
        print_consistency(compute_consistency(results))

    # Save CSV
    output_path = Path(__file__).parent / "agent_harness_results.csv"
    save_csv(results, output_path)
    print(f"\nDetailed results saved to: {output_path}")

    # Render the human-readable Markdown companion alongside the CSV.
    report_path = (
        Path(__file__).parent.parent / "documents" / "agent-eval-report.md"
    )
    save_markdown_report(results, metrics, passed, report_path)
    print(f"Markdown report saved to:   {report_path}")

    # Regression baseline handling
    if args.save_baseline:
        save_baseline(metrics, BASELINE_PATH)
    no_regression = True
    if args.compare_baseline:
        no_regression = compare_baseline(metrics, BASELINE_PATH)

    return 0 if (passed and no_regression) else 1


if __name__ == "__main__":
    sys.exit(main())