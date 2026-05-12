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

# gemini-2.0-flash pricing (USD per 1M tokens, for input ≤128k)
PRICE_INPUT_PER_1M = 0.075
PRICE_OUTPUT_PER_1M = 0.30

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
    "project_portfolio_strength_rate": 0.80,   # fixtures with projects must have ≥1 portfolio strength
    "project_plan_integration_rate": 0.70,     # fixtures with projects must reference a project in ≥1 todo
}

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
        "latency_s": None,
        "status_code": None,
        "json_parse_ok": False,
        "schema_valid": False,
        "schema_errors": [],
        "gap_faithfulness": None,
        "plan_completeness": False,
        "date_consistent": False,
        "match_score_in_range": False,
        "category_diversity_ok": False,
        "project_portfolio_strength": False,
        "project_plan_integration": False,
        "overall_match_score": None,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "cost_usd": 0.0,
        "response_json": None,
        "error": None,
    }

    t0 = time.time()
    try:
        resp = client.post(endpoint, json=fixture["request"])
        result["latency_s"] = time.time() - t0
        result["status_code"] = resp.status_code

        if resp.status_code != 200:
            result["error"] = f"HTTP {resp.status_code}: {resp.text[:300]}"
            return result

        data = resp.json()
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
        "total_fixtures": n,
        "successful_fixtures": len(successful),
    }


# ── Output ────────────────────────────────────────────────────────────────────


def _pass_fail(condition: bool) -> str:
    return "PASS" if condition else "FAIL"


def _fmt_nan(v: float, fmt: str) -> str:
    import math
    return "N/A (--skip-llm-judge)" if math.isnan(v) else format(v, fmt)


def print_summary(metrics: dict, all_pass: bool) -> None:
    print()
    print("=" * 72)
    print("  readmycareer.com — Agent Output Quality Evaluation")
    print("=" * 72)

    rows = [
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
    ]

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
    ]
    # gap_faithfulness: skip check if NaN (judge was skipped)
    if not math.isnan(metrics["gap_faithfulness"]):
        checks.append(metrics["gap_faithfulness"] >= THRESHOLDS["gap_faithfulness"])
    return all(checks)


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
    args = parser.parse_args()

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
            llm_model = genai.GenerativeModel("gemini-2.0-flash-lite")
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
    print(f"Timeout: {args.timeout}s | LLM judge: {'OFF' if args.skip_llm_judge else 'ON'}")
    print()

    results: list[dict] = []

    with httpx.Client(timeout=args.timeout) as client:
        for i, fixture in enumerate(fixtures, 1):
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
                    f"Category diversity: {result.get('category_diversity_ok', 'N/A')}"
                )

                # LLM-as-judge
                if result["json_parse_ok"] and llm_model is not None:
                    print("  → LLM judging faithfulness...", end="", flush=True)
                    result["gap_faithfulness"] = judge_gap_faithfulness(
                        fixture, result["response_json"], llm_model
                    )
                    print(f" {result['gap_faithfulness']:.2f}")

            # Cost estimation
            pt, ct, cost = estimate_cost(fixture, result.get("response_json"))
            result["prompt_tokens"] = pt
            result["completion_tokens"] = ct
            result["cost_usd"] = cost

            results.append(result)
            print()

    # Aggregate and print results
    metrics = compute_metrics(results)
    passed = all_thresholds_met(metrics)
    print_summary(metrics, passed)

    # Save CSV
    output_path = Path(__file__).parent / "agent_harness_results.csv"
    save_csv(results, output_path)
    print(f"\nDetailed results saved to: {output_path}")

    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())