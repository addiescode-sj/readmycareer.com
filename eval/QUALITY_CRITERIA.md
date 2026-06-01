# Output Quality Verification Criteria

> The contract by which readmycareer.com decides whether an agent / RAG change is
> good enough to ship. This document explains **what** we measure, **how** each
> metric is computed, **what threshold** gates a release, and **why** that metric
> exists. It is the human-readable companion to [`eval/run_evals.sh`](./run_evals.sh),
> [`eval/agent_harness.py`](./agent_harness.py), and [`eval/ragas_eval.py`](./ragas_eval.py).

---

## 1. Philosophy — quality = closing the five contextual gaps

[README §1](../README.md) defines the product's reason to exist: keyword matching
between a résumé and a job description misses five **contextual gaps**:

| # | Contextual gap (README §1) |
|---|---|
| 1 | Technical terminology & stack mismatch (skill transferability) |
| 2 | Hidden & implicit expectations |
| 3 | Company stage & culture fit |
| 4 | Skill lifecycle & market trends |
| 5 | Unstructured progression trajectories (prerequisite order) |

[README §2](../README.md) is our answer: seed the **Pinecone RAG vector DB** with a
reference corpus (Categories A–D) so the agents can reason about context that is not
written in any single JD. The corpus is maintained as report files in a Google Drive
folder and synced into Pinecone as `doc_type: "reference"` chunks via the
`career-knowledge-base` MCP skill's `sync-drive` tool.

**Therefore output quality is not "valid JSON" — it is "did the reference corpus
actually reduce the five gaps?"** The eval suite is structured to answer exactly
that question, on top of the baseline correctness/cost/latency checks.

---

## 2. Two evaluation layers

| Layer | Script | Question it answers |
|---|---|---|
| **Retrieval quality** | `ragas_eval.py` | Does the RAG layer fetch the *right* reference context and answer faithfully to it? |
| **Agent output quality** | `agent_harness.py` | Given that context, does the end-to-end `/api/analyze` output show the contextual depth the corpus is meant to enable? |

Both run from the single entry point:

```bash
bash eval/run_evals.sh                    # full suite (server + RAG + agent)
bash eval/run_evals.sh --skip-rag         # agent layer only (no Pinecone)
bash eval/run_evals.sh --skip-llm-judge   # skip LLM-as-judge metrics (fast)
```

A non-zero exit from either layer fails the suite. **Per [CLAUDE.md](../CLAUDE.md)
eval discipline, thresholds are never lowered to make a change pass** — extend the
dataset/fixtures instead.

---

## 3. Layer A — RAG retrieval quality (`ragas_eval.py`)

Driven by [`eval/eval_dataset.json`](./eval_dataset.json). Each case is run through
the live retrieve → generate pipeline against Pinecone, then scored.

### 3.1 RAGAS metrics (baseline)

| Metric | What it measures | Threshold |
|---|---|---|
| **Faithfulness** | Answer is grounded in retrieved context (no hallucination) | ≥ 0.70 |
| **Answer Relevancy** | Answer actually addresses the question | ≥ 0.70 |
| **Context Precision** | Retrieved chunks are relevant (low noise) | ≥ 0.70 |
| **Context Recall** | Retrieved context covers what the ground truth needs | ≥ 0.70 |

### 3.2 Reference Grounding (added for the report corpus)

| Metric | What it measures | Threshold |
|---|---|---|
| **Reference Grounding Rate** | For cases that *target* the reference corpus, the share where retrieval actually returned a `doc_type == "reference"` chunk | ≥ 0.80 |

- **Why it exists:** the RAGAS metrics can score well even if the answer is grounded
  in JD chunks rather than the newly uploaded report files. Reference Grounding is
  the direct check that the **uploaded reports are being used, not merely present**.
- **How it's computed:** reference-targeted cases carry `doc_type`, `expected_doc_type`,
  and `expected_tags`. Retrieval is filtered with `{"doc_type": {"$eq": "reference"}}`
  (mirroring the `career-knowledge-base` `search` tool); a case is *grounded* if at
  least one returned match has the expected `doc_type`. Tag overlap is reported as a
  secondary, informational signal (not gated), because tag taxonomy may evolve.
- **Coverage:** one case per README §2 category —
  A (skill taxonomy / synonyms), B (role & company tier), C (learning pathways),
  D (hiring trends). These map 1:1 to gaps #1, #2/#3, #5, and #4 respectively.

---

## 4. Layer B — agent output quality (`agent_harness.py`)

Driven by [`eval/fixtures/agent_fixtures.json`](./fixtures/agent_fixtures.json) (three
realistic résumé + JD personas). Each fixture is POSTed to `/api/analyze` and the SSE
`result` payload is validated.

### 4.1 Baseline correctness, cost & latency

| Metric | What it measures | Threshold |
|---|---|---|
| **Schema Compliance Rate** | Output matches the `CareerPlanOutput` JSON schema | ≥ 95% |
| **JSON Parse Error Rate** | Fraction of responses that fail to parse | < 5% |
| **Gap Faithfulness** (LLM-judge) | Gaps are tied to JD evidence | ≥ 0.70 |
| **Plan Completeness Rate** | Every week has ≥ 3 todos | ≥ 90% |
| **Date Consistency Rate** | Weekly date ranges are contiguous (≤ 2-day gap) | = 100% |
| **p95 Latency** | 95th-percentile response time | < 30 s |
| **Avg Cost / Request** | Estimated per-request cost (gemini pricing) | < $0.01 |
| **Match Score In Range** | `overall_match_score` falls in the fixture's expected band | ≥ 80% |
| **Category Diversity** | ≥ 3 distinct categories across gaps + strengths | = 100% |
| **Project Portfolio Strength** | Résumés with projects yield ≥ 1 portfolio strength | ≥ 80% |
| **Project Plan Integration** | ≥ 1 todo references an existing project by name | ≥ 70% |

### 4.2 RAG-grounding metrics (added for the report corpus)

These three metrics are the agent-side measure of whether the reference corpus
reduced the five gaps. Each is **fixture-driven**: a fixture that does not declare the
relevant expectation field is treated as *not applicable* and passes, so the metrics
can be rolled out incrementally.

| Metric | Gap addressed | What it measures | Threshold |
|---|---|---|---|
| **Hidden Expectation Coverage** | #2 | Gap analysis surfaces ≥ 1 implicit expectation that is *not* spelled out in the JD (e.g. idempotency / observability / SLOs for the role + tier) | ≥ 66% |
| **Prerequisite Ordering** | #5 | No foundational gap is ranked *below* an advanced gap that depends on it (e.g. Docker/Node.js before Kubernetes/NestJS/system design) | = 100% |
| **Contextual Depth** (LLM-judge) | #1, #3, #4 | Holistic 0–1 score for skill transferability / synonym resolution, company-tier fit, and market relevance — i.e. reasoning *beyond* keyword restatement | ≥ 0.70 |

**How each is computed**

- **Hidden Expectation Coverage** — lenient OR-match: the fixture lists candidate
  implicit expectations (`expected_hidden_expectations`); a fixture passes if any one
  appears anywhere in `gap_analysis` (case-insensitive substring). Lenient by design —
  we require evidence of *some* implicit reasoning, not an exhaustive checklist.
- **Prerequisite Ordering** — the fixture lists `expected_prerequisite_pairs`
  `[before, after]`. For each pair we locate the first gap mentioning each term and
  compare rank, where `rank = (priority_weight, array_index)` and
  `high < medium < low`. The prerequisite must not rank *strictly below* its
  dependant. Pairs whose terms are not both present are skipped. Gated at 100% because
  it is a logical-consistency invariant, like Date Consistency — a single inversion is
  a real defect.
- **Contextual Depth** — Gemini Flash judges the gap analysis (summary + sampled
  strengths/gaps) against the candidate's target role + company, scoring how much
  context it adds beyond keyword matching. Skipped (reported `SKIP`, excluded from the
  pass/fail decision) when `--skip-llm-judge` is set, identical to Gap Faithfulness.

---

## 5. Traceability matrix — every gap is measured

| Contextual gap (README §1) | Retrieval check | Agent-output check |
|---|---|---|
| #1 Stack mismatch / transferability | Reference Grounding (Cat A) | Contextual Depth |
| #2 Hidden & implicit expectations | Reference Grounding (Cat B) | Hidden Expectation Coverage |
| #3 Company stage & culture fit | Reference Grounding (Cat B) | Contextual Depth |
| #4 Skill lifecycle & market trends | Reference Grounding (Cat D) | Contextual Depth |
| #5 Unstructured progression | Reference Grounding (Cat C) | Prerequisite Ordering |

---

## 6. Pass/fail gating & artifacts

- The suite **PASSES** only when every gated metric in both layers meets its
  threshold. LLM-judge metrics (`Gap Faithfulness`, `Contextual Depth`) and the
  Reference Grounding section are skipped — not failed — when their inputs are
  unavailable (`--skip-llm-judge`, no reference-targeted cases).
- Always inspect the CSVs, not just the PASS/FAIL line:
  - `eval/agent_harness_results.csv` — per-fixture detail (includes `gap_recall`,
    `gap_precision`, `hidden_expectation_coverage`, `prerequisite_ordering_ok`,
    `contextual_depth`, `run_index`).
  - `eval/ragas_results.csv` — per-case RAGAS scores.
  - `eval/grounding_results.csv` — per-case citation/grounding records (which Pinecone
    sources each answer used; `grounded` for reference-targeted cases).
  - `eval/model_comparison.csv` — cross-model quality/latency/cost comparison.

## 7. Extending coverage

1. **New retrieval case** → add to `eval/eval_dataset.json`. To exercise the report
   corpus, set `doc_type`/`expected_doc_type` to `"reference"`, a `category`, and
   `expected_tags` aligned with the `sync-drive` metadata.
2. **New agent persona** → add to `eval/fixtures/agent_fixtures.json`, including the
   RAG-grounding fields (`expected_hidden_expectations`, `expected_prerequisite_pairs`)
   where they apply.
3. **Never** weaken a threshold in `agent_harness.py` / `ragas_eval.py` to make a
   regression pass — fix the agent, prompt, chunking, or corpus instead.

---

## 8. Content-accuracy, variance & regression (v0.6.0)

The original quality gate validates *form* (schema, completeness, dates). These additions
measure *content* — accuracy against labels, run-to-run stability, and regressions over time.

### 8.1 Gap accuracy vs. labels (`agent_harness.py`)

| Metric | What it measures | Threshold |
|---|---|---|
| **Gap Recall** | Labeled gap keywords (`expected_gaps_keywords`) surfaced anywhere in `gaps[]` / total labeled keywords | ≥ 50% (gated; raise as the golden set matures) |
| **Gap Precision** | Gap items that hit ≥ 1 labeled keyword / total gap items | INFO only — labels are intentionally non-exhaustive, so this is never gated |

Both are `None` (N/A, skipped) for a fixture that declares no `expected_gaps_keywords`.

### 8.2 Consistency / variance — `--repeat N`

Runs each fixture `N` times and reports the **stdev** of `overall_match_score`,
`gap_faithfulness`, `gap_recall`, and `latency_s` per fixture. This quantifies the
non-determinism the retry gate otherwise hides. Opt-in (default `N=1`) to avoid burning API
quota on normal runs.

### 8.3 Regression baseline + diff — `--save-baseline` / `--compare-baseline`

`--save-baseline` snapshots the aggregate metrics to `eval/baseline.json`.
`--compare-baseline` diffs the current run against it and **exits non-zero on regression**
(absolute tolerance `0.05` for rate/score metrics; relative `0.20` for latency/cost). Use it
in CI or after a prompt/model change to catch quality drops, not just hard threshold breaches.

### 8.4 Grounding / Citation Rate (`ragas_eval.py`)

The former *Reference Grounding Rate* is reported as the **Grounding / Citation Rate**: the
share of reference-targeted cases whose retrieved top-K includes the expected source, plus a
**Citation Coverage** (share of all cases whose answer is backed by ≥ 1 retrieved source). Both
are the retrieval-level inverse of hallucination and complement RAGAS Faithfulness. Per-case
cited sources (title, `doc_type`, score) are written to `eval/grounding_results.csv`.

### 8.5 Cross-model comparison — `model_comparison.py`

Runs the fixtures once per provider (`gemini`, `openai`) and compares gap recall, faithfulness,
schema compliance, p95 latency, and cost. A provider with no API key is reported as
`SKIPPED (no key)` — **never fabricated**. Output: `eval/model_comparison.csv`.

### 8.6 Published results table — `render_results.py`

Renders the committed eval CSVs into the README "Quality & Evaluation" section between the
`<!-- EVAL:START -->` / `<!-- EVAL:END -->` markers, so the published numbers stay reproducible
from artifacts rather than hand-maintained.

> Live operational metrics (per-stage latency, retries, token/cache usage, cost) are separate
> from this offline suite: they are recorded to the `agent_runs` table at runtime and surfaced
> at `/admin/observability`. The cost model there mirrors `agent_harness.py` so live and offline
> cost reconcile.
