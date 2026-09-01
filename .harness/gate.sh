#!/usr/bin/env bash
# Plan gate: PLAN.md must be approved before any code edit.
# Shared by Claude Code (PreToolUse hook) and Codex (AGENTS.md contract).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAN="$ROOT/PLAN.md"
TASK="$ROOT/TASK.md"

status() { if [ -f "$PLAN" ]; then sed -n 's/^status: *//p' "$PLAN" | head -1; else echo none; fi; }

# Paths always writable regardless of plan status (planning artifacts + scratch).
allowed() {
  case "${1#"$ROOT"/}" in
    PLAN.md|TASK.md|AGENTS.md|CLAUDE.md|CHANGELOG.md|README.md|documents/*|.harness/*|.claude/*|/tmp/*|/private/tmp/*) return 0 ;;
    jest.config.mjs|playwright.config.ts|.github/*) return 0 ;;
    *) return 1 ;;
  esac
}

case "${1:-check}" in
check) # stdin: Claude Code PreToolUse hook JSON
  { [ -n "${HARNESS_OFF:-}" ] || [ -f "$ROOT/.harness/off" ]; } && exit 0
  f=$(python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path") or d.get("notebook_path") or "")')
  [ -z "$f" ] && exit 0
  allowed "$f" && exit 0
  s=$(status)
  if [ "$s" = approved ] && [ -f "$TASK" ]; then exit 0; fi
  echo "BLOCKED: PLAN.md status=$s (needs 'approved' + TASK.md). Run /plan-harness plan, then verify, before editing $f. Override: HARNESS_OFF=1" >&2
  exit 2 ;;
status)
  echo "plan=$(status) task=$([ -f "$TASK" ] && echo present || echo missing)" ;;
init)
  [ -f "$PLAN" ] && { echo "PLAN.md already exists (status=$(status)) — archive it first"; exit 1; }
  cat > "$PLAN" <<'P'
---
status: draft
title: TITLE_PLACEHOLDER
updated: DATE_PLACEHOLDER
---

## 목표 / 완료 정의(DoD)

## 범위 밖

## 확정된 결정 (사용자 선택으로 해소된 암묵지)

## 접근 방식

## 영향 파일

## 리스크 & 검증 방법
P
  sed -i '' "s/TITLE_PLACEHOLDER/${2:-untitled}/; s/DATE_PLACEHOLDER/$(date +%F)/" "$PLAN"
  printf '# TASK\n\n> PLAN.md 승인 후 생성. 같은 group = 병렬, group 은 알파벳 순 직렬.\n\n' > "$TASK"
  echo "created PLAN.md + TASK.md" ;;
approve)
  grep -q '^- \[ \] T' "$TASK" 2>/dev/null || { echo "TASK.md has no atomic tasks yet"; exit 1; }
  sed -i '' 's/^status: .*/status: approved/' "$PLAN"
  echo "plan approved" ;;
tasks)
  sed -n "s/^- \[ \] \(T[0-9]*\) \[group:${2:-[A-Z]}\].*/\1/p" "$TASK" ;;
done)
  sed -i '' "s/^- \[ \] $2 /- [x] $2 /" "$TASK"; echo "$2 done" ;;
prompt) # doc-only task brief; conversation context is deliberately excluded
  case "${3:-impl}" in
    impl)  role="Follow .claude/agents/impl.md. Implement exactly task $2. Do NOT write or edit any *.test.ts or e2e/*.spec.ts — a test-author agent owns those, in parallel with you." ;;
    tests) role="Follow .claude/agents/test-author.md. Write the Jest unit tests (and a Playwright spec if the DoD is user-visible) for task $2, derived from PLAN.md's DoD — not from the current implementation, which may be unfinished. Do NOT edit implementation files. Your tests are allowed to fail." ;;
    refactor) role="Follow .claude/agents/refactorer.md. Run pnpm test, fix the IMPLEMENTATION until green (root cause, not symptom), then pnpm test:e2e. Never weaken, skip, or delete a test to make it pass." ;;
    *) echo "unknown role: $3 (impl|tests|refactor)" >&2; exit 1 ;;
  esac
  cat <<P
You are working on ONE atomic task in $ROOT.
Sole context: $ROOT/PLAN.md and $ROOT/TASK.md. There is no prior conversation to rely on —
anything not written in those documents was never decided.

$role

Obey CLAUDE.md / AGENTS.md rules for this repo.
When done, run the task's 검증 command and paste the output.
Report: files changed, verification output, anything that contradicts PLAN.md.
Do NOT edit PLAN.md or TASK.md.
P
  ;;
codex) # background Codex worker for one task: gate.sh codex <ID> [impl|tests|refactor]
  mkdir -p "$ROOT/.harness/logs"
  r="${3:-impl}"
  ( cd "$ROOT" && codex exec --full-auto "$("$0" prompt "$2" "$r")" ) > "$ROOT/.harness/logs/$2-$r.log" 2>&1 &
  echo "codex $r worker started for $2 -> .harness/logs/$2-$r.log" ;;
stopcheck) # stdin: Claude Code Stop hook JSON. exit 2 = keep working.
  { [ -n "${HARNESS_OFF:-}" ] || [ -f "$ROOT/.harness/off" ]; } && exit 0
  cd "$ROOT"
  changed=$(git status --porcelain -- agents app mcp-skills | awk '{print $NF}')
  [ -z "$changed" ] && { rm -f "$ROOT/.harness/loop-count"; exit 0; }

  n=$(cat "$ROOT/.harness/loop-count" 2>/dev/null || echo 0)
  if [ "$n" -ge "${HARNESS_MAX_LOOPS:-5}" ]; then
    rm -f "$ROOT/.harness/loop-count"
    echo "harness: test loop hit ${HARNESS_MAX_LOOPS:-5} attempts — stopping, tests still red. Report this to the user." >&2
    exit 0
  fi
  bump() { echo $((n + 1)) > "$ROOT/.harness/loop-count"; }

  # 1) every changed runtime module needs a sibling unit test
  missing=""
  for f in $changed; do
    case "$f" in
      agents/*.ts|mcp-skills/*/src/*.ts)
        case "$f" in *.test.ts|*.d.ts) continue ;; esac
        [ -f "${f%.ts}.test.ts" ] || missing="$missing ${f%.ts}.test.ts" ;;
    esac
  done
  if [ -n "$missing" ]; then
    bump
    echo "harness: 단위 테스트 누락 —$missing. 주요 기능에 대한 Jest 테스트를 작성한 뒤 'pnpm test' 로 통과시켜라." >&2
    exit 2
  fi

  # 2) unit tests must be green (refactor until they are)
  if ! out=$(pnpm test 2>&1); then
    bump
    echo "harness: Jest 실패. 테스트를 통과할 때까지 구현을 리팩터링하라 (테스트를 약화시키지 말 것).

$(echo "$out" | tail -40)" >&2
    exit 2
  fi

  # 3) only then, the e2e gate
  if ! out=$(pnpm test:e2e 2>&1); then
    # Missing browser binaries are an unprovisioned environment, not a red test —
    # no amount of refactoring fixes it, so report instead of looping.
    # Covers both a missing install and a corrupt/partial one (browser aborts on launch).
    if echo "$out" | grep -qE "Executable doesn't exist|browserType.launch|Host system is missing dependencies"; then
      rm -f "$ROOT/.harness/loop-count"
      echo "harness: e2e 게이트 생략 — Playwright 브라우저를 실행할 수 없음(미설치 또는 손상). 사용자에게 'pnpm exec playwright uninstall && pnpm exec playwright install chromium' 실행을 요청하고, e2e 미검증 상태임을 보고하라." >&2
      exit 0
    fi
    bump
    echo "harness: Playwright e2e 실패. 단위 테스트는 통과했으니 통합 경로를 고쳐라.

$(echo "$out" | tail -40)" >&2
    exit 2
  fi

  rm -f "$ROOT/.harness/loop-count"
  exit 0 ;;
archive)
  s="$(date +%F)-$(sed -n 's/^title: *//p' "$PLAN" | head -1 | tr ' /' '--' | tr -cd 'A-Za-z0-9-')"
  mkdir -p "$ROOT/documents/plans/$s"
  mv "$PLAN" "$TASK" "$ROOT/documents/plans/$s/"
  echo "archived to documents/plans/$s" ;;
*)
  echo "usage: gate.sh {check|stopcheck|status|init <title>|approve|tasks <group>|done <ID>|prompt <ID>|codex <ID>|archive}"; exit 1 ;;
esac
