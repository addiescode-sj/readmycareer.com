---
name: plan-harness
description: Document-driven plan → verify → atomic task → parallel execution harness. Use when the user runs /plan-harness, starts any non-trivial feature or refactor, says 계획 세워/플랜/PLAN.md/TASK.md, or asks to execute tasks in parallel with subagents. Enforces that no code is written before PLAN.md is approved, and that every worker reads PLAN.md/TASK.md instead of conversation history.
---

# Plan Harness

Four phases. Never skip forward. `.harness/gate.sh` is the enforcement point — a
PreToolUse hook blocks every code edit while `PLAN.md` status is not `approved`.

Invocation: `/plan-harness [plan|verify|run|status|archive]` (default: infer from
`.harness/gate.sh status`).

## Phase 1 — plan

1. `.harness/gate.sh init "<title>"` (fails if a plan is already live → finish or `archive` it).
2. Investigate the codebase first — read the files the change touches, trace the real flow.
3. Fill `PLAN.md`. Every section, no placeholders.
4. **암묵지 규칙 (hard):** every time you are about to assume something the user has not
   stated — data shape, UX behavior, error handling, migration strategy, library choice,
   scope boundary — STOP and use `AskUserQuestion` with 2–4 concrete options and their
   trade-offs. Do not "reasonable-default" it. Record the answer verbatim under
   *확정된 결정*. That section is the contract workers rely on.
5. Do **not** write code. The hook will block you anyway.

## Phase 2 — verify

Adversarial review of your own PLAN.md. It fails verification if any is true:

- A DoD item is not objectively checkable (no command, no observable outcome).
- 영향 파일 lists a path you have not opened.
- An unanswered question survives anywhere in the doc ("TBD", "아마", "확인 필요").
- A decision in *확정된 결정* was made by you, not by the user.
- Repo rules are violated: workspace boundaries, agent/DB boundaries, DESIGN.md tokens,
  next-intl for all strings, `pnpm eval` gate for agent/MCP/RAG changes (see CLAUDE.md).

Then break the plan into atomic tasks in `TASK.md`. Atomic = one worker, one concern,
independently verifiable, no coordination with a sibling task.

```
- [ ] T1 [group:A] **<title>** — <one-line summary>
  - 파일: `path/a`, `path/b`
  - 의존: 없음 | T0
  - DoD: <observable outcome>
  - 검증: `pnpm --filter @readmycareer/app exec tsc --noEmit`
```

`group:` = parallel batch. Same letter runs concurrently, so **two tasks in one group must
never touch the same file**. Groups run in alphabetical order.

Present the plan + task list to the user and ask for approval. On approval:
`.harness/gate.sh approve` (this is the only thing that unlocks editing).

## Phase 3 — run (역할 분리 서브에이전트)

그룹 단위로 진행하고, 그룹 안의 태스크는 동시에 던진다. 태스크 하나마다 역할이 셋이며
**앞의 둘은 병렬, 세 번째는 그 뒤에 직렬**이다.

| 역할 | 에이전트 | 쓰는 파일 | 안 건드리는 파일 |
|---|---|---|---|
| 구현 | `impl` | 태스크의 `파일:` 목록 | `*.test.ts`, `e2e/*.spec.ts` |
| 테스트 작성 | `test-author` | `*.test.ts`, `e2e/*.spec.ts`, 픽스처 | 구현 파일 전부 |
| 리팩터링 | `refactorer` | 구현 파일 | 테스트 (약화·삭제 금지) |

쓰기 영역이 겹치지 않으므로 `impl` 과 `test-author` 는 충돌 없이 병렬로 돈다. 핵심은
**테스트가 완성된 구현이 아니라 PLAN.md 의 DoD 에서 파생**된다는 것 — 구현을 보고 짠
테스트는 이미 통과하는 것만 확인한다.

**Claude Code** — 한 메시지에 `Agent` 호출을 몰아서:

```
Agent(subagent_type="impl",        prompt=`.harness/gate.sh prompt T1 impl`)
Agent(subagent_type="test-author", prompt=`.harness/gate.sh prompt T1 tests`)
Agent(subagent_type="impl",        prompt=`.harness/gate.sh prompt T2 impl`)
Agent(subagent_type="test-author", prompt=`.harness/gate.sh prompt T2 tests`)
```

둘이 모두 끝난 뒤, 빨간 테스트가 있으면 태스크마다 하나씩:

```
Agent(subagent_type="refactorer",  prompt=`.harness/gate.sh prompt T1 refactor`)
```

**Codex** — 같은 프롬프트를 백그라운드로:

```
.harness/gate.sh codex T1 impl
.harness/gate.sh codex T1 tests
# 둘 다 끝난 뒤
.harness/gate.sh codex T1 refactor      # 로그: .harness/logs/T1-<role>.log
```

섞어 쓰기 권장: 넓고 기계적인 편집은 Codex, 판단이 필요한 부분은 Claude 서브에이전트.

규칙:

- 워커 프롬프트는 `gate.sh prompt` 출력 **그대로**. 대화 요약을 덧붙이지 말 것 — 문서가 유일한 인터페이스다.
- `refactorer` 는 `impl` 과 절대 동시에 돌리지 않는다(같은 파일을 쓴다).
- 한 그룹 안에서 서로 다른 태스크가 같은 파일을 쓰면 그건 그룹 분리 실패다 → Phase 2 로 돌아간다.
- 그룹이 끝나면 검증 명령을 직접 돌리고 통과분마다 `.harness/gate.sh done <ID>`.
- 워커가 PLAN.md 와의 모순을 보고하면 즉시 중단. 계획이 틀린 것이므로 임의 판단하지 말고 Phase 1/2 로 되돌아간다.

최대 5개까지 필요하면 `reviewer`(DESIGN.md·i18n·경계 규칙 점검), `migrator`(supabase/ SQL + RLS)
를 추가한다. 그 이상은 조정 비용이 이득을 넘는다.

## Phase 3.5 — test gate (자동, Stop 훅)

구현이 끝나 세션을 종료하려는 순간 `.harness/gate.sh stopcheck` 가 자동 실행된다.
`agents/`, `mcp-skills/`, `app/` 에 변경이 있으면 아래를 순서대로 강제하고, 실패하면
세션 종료를 막고(exit 2) 사유를 돌려준다:

1. **단위 테스트 존재** — 변경된 `agents/**/x.ts`, `mcp-skills/*/src/x.ts` 마다
   `x.test.ts` 가 있어야 한다. 없으면 작성하라는 요구가 돌아온다.
2. **`pnpm test` (Jest) 통과** — 실패 시 통과할 때까지 **구현을 리팩터링**한다.
   테스트 완화·삭제·`skip` 은 금지. 테스트가 잘못 짜였다면 그 근거를 남기고 고친다.
3. **`pnpm test:e2e` (Playwright) 통과** — 단위 테스트가 모두 초록일 때만 실행된다.
   `webServer` 가 `pnpm dev` 를 자동 기동하며 이미 3000 이 떠 있으면 재사용한다.

예외: Playwright 브라우저 바이너리가 없으면(`Executable doesn't exist`) 이는 테스트 실패가
아니라 미프로비저닝 환경이므로 게이트가 루프를 돌지 않고 통과시키되, **e2e 미검증 상태를
사용자에게 보고**하고 `playwright install chromium` 을 요청해야 한다.

무한 루프 방지: 시도 횟수는 `.harness/loop-count` 에 누적되고 `HARNESS_MAX_LOOPS`
(기본 5) 를 넘으면 게이트가 스스로 물러나며 "테스트가 여전히 빨간 상태"를 사용자에게
보고하게 한다. 그 시점에는 임의로 계속 고치지 말고 사용자에게 상황을 알린다.

테스트 범위: 단위 테스트는 `agents/` + `mcp-skills/` 만(순수 TS 로직·Zod 경계).
`app/` UI 회귀는 `e2e/*.spec.ts` 가 담당한다. PLAN.md 의 각 DoD 는 둘 중 하나에
대응하는 검증 명령을 가져야 한다.

Codex 에서는 훅이 없으므로 **작업 종료 전 `.harness/gate.sh stopcheck` 를 직접 실행**하고
exit 2 면 계속 고친다.

## Phase 4 — archive

All tasks `[x]` → verify the full DoD → commit (project 커밋 workflow) →
`.harness/gate.sh archive` (moves the pair to `documents/plans/<date>-<title>/`) →
update `documents/handoff.md`.

## Session recovery

A new session starts from `PLAN.md` + `TASK.md` only. Read them, run
`.harness/gate.sh status`, resume at the first unchecked task. Do not ask the user
to re-explain what the docs already record; if the docs do not record it, it was
never decided — go ask with `AskUserQuestion`.
