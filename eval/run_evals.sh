#!/usr/bin/env bash
# =============================================================================
# readmycareer.com — Integrated Eval Execution Script
# =============================================================================
#
# Usage:
#   bash eval/run_evals.sh                     # Full execution (Server + RAG + Agent)
#   bash eval/run_evals.sh --skip-rag          # Skip RAG eval (Pinecone not required)
#   bash eval/run_evals.sh --skip-llm-judge    # Skip LLM judge (Fast execution)
#   bash eval/run_evals.sh --skip-rag --skip-llm-judge  # Fastest execution
#
# Prerequisites:
#   - eval/.venv exists or requirements.txt installed in system Python 3
#   - GOOGLE_API_KEY set in .env (for agent harness)
#   - For RAG eval: PINECONE_API_KEY, PINECONE_INDEX_NAME required
#   - Before Agent harness: Development server must be running via 'pnpm dev'
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVAL_DIR="$SCRIPT_DIR"
ROOT_DIR="$(dirname "$EVAL_DIR")"

# ── Flag Parsing ──────────────────────────────────────────────────────────────

SKIP_RAG=false
SKIP_LLM_JUDGE=false
BASE_URL="http://localhost:3000"

for arg in "$@"; do
  case "$arg" in
    --skip-rag)        SKIP_RAG=true ;;
    --skip-llm-judge)  SKIP_LLM_JUDGE=true ;;
    --base-url=*)      BASE_URL="${arg#*=}" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,2\}//'
      exit 0
      ;;
  esac
done

# ── Python Interpreter Selection ──────────────────────────────────────────────

VENV_PYTHON="$EVAL_DIR/.venv/bin/python"
if [[ -f "$VENV_PYTHON" ]]; then
  PYTHON="$VENV_PYTHON"
elif command -v python3 &>/dev/null; then
  PYTHON="python3"
else
  echo "ERROR: Python 3 not found."
  echo "       cd eval && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

# ── Header ────────────────────────────────────────────────────────────────────

echo "========================================================================"
echo "  readmycareer.com — Evaluation Suite"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Python: $PYTHON"
echo "  Options: skip-rag=$SKIP_RAG, skip-llm-judge=$SKIP_LLM_JUDGE"
echo "========================================================================"

EXIT_RAG=0
EXIT_AGENT=0

# ── [1/2] RAG Retrieval Quality (ragas_eval.py) ───────────────────────────────

if [[ "$SKIP_RAG" == "false" ]]; then
  echo ""
  echo "────────────────────────────────────────────────────────────────────"
  echo "  [1/2] RAG Retrieval Quality Evaluation (ragas_eval.py)"
  echo "────────────────────────────────────────────────────────────────────"
  echo "  Metrics: Faithfulness, Answer Relevancy, Context Precision, Context Recall,"
  echo "           Reference Grounding (report corpus actually retrieved)"
  echo ""
  set +e
  "$PYTHON" "$EVAL_DIR/ragas_eval.py"
  EXIT_RAG=$?
  set -e
  echo ""
  if [[ $EXIT_RAG -eq 0 ]]; then
    echo "  [1/2] RAG eval: PASS"
  else
    echo "  [1/2] RAG eval: FAIL (exit $EXIT_RAG)"
  fi
else
  echo ""
  echo "  [1/2] RAG eval skipped (--skip-rag)"
  EXIT_RAG=0
fi

# ── [2/2] Agent Output Quality (agent_harness.py) ─────────────────────────────

echo ""
echo "────────────────────────────────────────────────────────────────────"
echo "  [2/2] Agent Output Quality Evaluation (agent_harness.py)"
echo "────────────────────────────────────────────────────────────────────"
echo "  Metrics: Schema Compliance, Gap Faithfulness, Plan Completeness,"
echo "           Date Consistency, p95 Latency, Avg Cost,"
echo "           Hidden Expectation Coverage, Prerequisite Ordering, Contextual Depth"
echo ""

# Check server response
SERVER_OK=false
for endpoint in "$BASE_URL/api/analyze" "$BASE_URL"; do
  if curl -sf --max-time 3 "$endpoint" >/dev/null 2>&1; then
    SERVER_OK=true
    break
  fi
done

if [[ "$SERVER_OK" == "false" ]]; then
  echo "  WARNING: Server is not responding at ($BASE_URL)"
  echo "           Please run 'pnpm dev' first and try again."
  echo "  [2/2] Agent eval: SKIP (Server not running)"
  EXIT_AGENT=1
else
  HARNESS_ARGS="--base-url $BASE_URL"
  if [[ "$SKIP_LLM_JUDGE" == "true" ]]; then
    HARNESS_ARGS="$HARNESS_ARGS --skip-llm-judge"
  fi

  set +e
  "$PYTHON" "$EVAL_DIR/agent_harness.py" $HARNESS_ARGS
  EXIT_AGENT=$?
  set -e

  echo ""
  if [[ $EXIT_AGENT -eq 0 ]]; then
    echo "  [2/2] Agent eval: PASS"
  else
    echo "  [2/2] Agent eval: FAIL (exit $EXIT_AGENT)"
  fi
fi

# ── Final Summary ─────────────────────────────────────────────────────────────

echo ""
echo "========================================================================"
echo "  COMBINED RESULTS"
echo "========================================================================"
printf "  %-40s %s\n" "RAG Retrieval Quality (ragas_eval.py):" \
  "$( [[ $SKIP_RAG == true ]] && echo 'SKIP' || ([[ $EXIT_RAG -eq 0 ]] && echo 'PASS' || echo 'FAIL') )"
printf "  %-40s %s\n" "Agent Output Quality (agent_harness.py):" \
  "$( [[ $EXIT_AGENT -eq 0 ]] && echo 'PASS' || echo 'FAIL' )"
echo "------------------------------------------------------------------------"

FINAL_EXIT=0
if [[ $EXIT_RAG -ne 0 ]] || [[ $EXIT_AGENT -ne 0 ]]; then
  FINAL_EXIT=1
  echo "  Overall: FAIL — One or more evaluations fell below threshold"
else
  echo "  Overall: PASS"
fi
echo "========================================================================"

# Result file locations
if [[ -f "$EVAL_DIR/ragas_results.csv" ]]; then
  echo "  RAG Results:   eval/ragas_results.csv"
fi
if [[ -f "$EVAL_DIR/agent_harness_results.csv" ]]; then
  echo "  Agent Results: eval/agent_harness_results.csv"
fi
echo "  Criteria:      eval/QUALITY_CRITERIA.md (metric definitions & thresholds)"

exit $FINAL_EXIT