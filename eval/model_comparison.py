"""
Cross-model comparison harness (model_comparison.py)
====================================================

Runs the agent fixtures against POST /api/analyze once per LLM provider and compares
output quality, latency, and cost side by side. This is the eval-layer half of the
model-abstraction work: the same fixtures, the same scorers, different providers.

Each provider's gap-analysis stage runs on that provider (planning stays on Gemini),
selected via the `provider` field the analyze route now accepts.

If a provider's API key is absent, that provider is reported as `SKIPPED (no key)` —
no numbers are fabricated.

Execution:
    # Run server first: pnpm dev (in root directory)
    cd eval && source .venv/bin/activate
    python model_comparison.py
    python model_comparison.py --providers gemini,openai --skip-llm-judge
"""

from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

import httpx

# Reuse the single-fixture runner, scorers, and cost model from the agent harness so the
# comparison stays consistent with the primary eval.
from agent_harness import (
    GOOGLE_API_KEY,
    JUDGE_MODEL,
    compute_metrics,
    estimate_cost,
    judge_contextual_depth,
    judge_gap_faithfulness,
    run_fixture,
)

# Provider → environment variable that must be present for a live run.
PROVIDER_KEY_ENV = {
    "gemini": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "openai": ("OPENAI_API_KEY",),
}


def provider_key_available(provider: str) -> bool:
    return any(os.environ.get(env) for env in PROVIDER_KEY_ENV.get(provider, ()))


def run_provider(
    provider: str,
    fixtures: list[dict],
    endpoint: str,
    timeout: int,
    llm_model,
) -> dict | None:
    """Runs all fixtures for one provider and returns its aggregate metrics (or None if skipped)."""
    if not provider_key_available(provider):
        keys = " / ".join(PROVIDER_KEY_ENV.get(provider, ("?",)))
        print(f"\n[{provider}] SKIPPED — none of [{keys}] is set in the environment.")
        return None

    print(f"\n===== Provider: {provider} =====")
    results: list[dict] = []
    with httpx.Client(timeout=timeout) as client:
        for i, fixture in enumerate(fixtures, 1):
            print(f"  [{i}/{len(fixtures)}] {fixture['id']}")
            # Inject the provider override into the request body.
            fx = dict(fixture)
            fx["request"] = dict(fixture["request"], provider=provider)
            result = run_fixture(fx, client, endpoint)

            if result.get("error"):
                print(f"    ✗ {result['error']}")
            elif result["json_parse_ok"] and llm_model is not None:
                result["gap_faithfulness"] = judge_gap_faithfulness(
                    fx, result["response_json"], llm_model
                )
                result["contextual_depth"] = judge_contextual_depth(
                    fx, result["response_json"], llm_model
                )

            pt, ct, cost = estimate_cost(fx, result.get("response_json"))
            result["prompt_tokens"] = pt
            result["completion_tokens"] = ct
            result["cost_usd"] = cost
            results.append(result)

    return compute_metrics(results)


def _fmt(metrics: dict | None, key: str, fmt: str) -> str:
    import math

    if metrics is None:
        return "SKIPPED (no key)"
    v = metrics.get(key)
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "N/A"
    return format(v, fmt)


def main() -> int:
    parser = argparse.ArgumentParser(description="readmycareer.com cross-model comparison")
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--providers", default="gemini,openai", help="Comma-separated provider list")
    parser.add_argument(
        "--fixtures",
        default=str(Path(__file__).parent / "fixtures" / "agent_fixtures.json"),
    )
    parser.add_argument("--skip-llm-judge", action="store_true")
    args = parser.parse_args()

    endpoint = f"{args.base_url}/api/analyze"
    providers = [p.strip() for p in args.providers.split(",") if p.strip()]

    import json

    fixtures: list[dict] = json.loads(Path(args.fixtures).read_text(encoding="utf-8"))

    # Optional LLM judge (shared across providers for a fair faithfulness comparison).
    llm_model = None
    if not args.skip_llm_judge:
        if not GOOGLE_API_KEY:
            print("WARN: GOOGLE_API_KEY not set — running comparison without the LLM judge.")
        else:
            try:
                import google.generativeai as genai

                genai.configure(api_key=GOOGLE_API_KEY)
                llm_model = genai.GenerativeModel(JUDGE_MODEL)
            except ImportError:
                print("WARN: google-generativeai not installed — running without the LLM judge.")

    print("=" * 72)
    print("  readmycareer.com — Cross-Model Comparison")
    print(f"  Providers: {', '.join(providers)} | Endpoint: {endpoint}")
    print("=" * 72)

    per_provider: dict[str, dict | None] = {}
    for provider in providers:
        per_provider[provider] = run_provider(
            provider, fixtures, endpoint, args.timeout, llm_model
        )

    # ── Comparison table ────────────────────────────────────────────────────────
    cols = [
        ("Gap Recall", "gap_recall", ".2%"),
        ("Gap Faithfulness", "gap_faithfulness", ".3f"),
        ("Schema Compliance", "schema_compliance_rate", ".2%"),
        ("p95 Latency (s)", "p95_latency_s", ".1f"),
        ("Avg Cost (USD)", "avg_cost_usd", ".4f"),
    ]

    print("\n" + "=" * 72)
    print("  Comparison")
    print("=" * 72)
    header = "Metric".ljust(22) + "".join(p.ljust(20) for p in providers)
    print(header)
    print("-" * len(header))
    for label, key, fmt in cols:
        row = label.ljust(22) + "".join(_fmt(per_provider[p], key, fmt).ljust(20) for p in providers)
        print(row)
    print("=" * 72)

    # ── CSV ──────────────────────────────────────────────────────────────────────
    out_path = Path(__file__).parent / "model_comparison.csv"
    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["metric"] + providers)
        for label, key, fmt in cols:
            writer.writerow([label] + [_fmt(per_provider[p], key, fmt) for p in providers])
    print(f"\nComparison written to: {out_path}")

    skipped = [p for p, m in per_provider.items() if m is None]
    if skipped:
        print(f"Note: skipped providers (no key): {', '.join(skipped)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
