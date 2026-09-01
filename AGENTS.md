# readmycareer.com — Agent Guidelines

## Project Overview

readmycareer.com is an AI career coaching service. Users upload a resume and paste a job description to receive a personalized gap analysis, a week-by-week career roadmap, an AI career coach chat, and — once all checklist items are complete — an ATS-optimized resume.

## Architecture

```
[User]
   │  Upload resume (PDF/DOCX) + paste JD text + enter target role/company
   ▼
/api/resume  →  mcp-skills/pdf-word-to-json  →  ResumeJson
/api/analyze →  career-knowledge-base (Pinecone RAG)  →  JdSearchResult[]
                         │
                         ▼
              agents/orchestrator.ts :: runCareerAnalysis()
                         │
                  ┌──────┴──────┐
                  ▼             ▼
          GapAnalyzerAgent   (Step 1) → GapAnalysisOutput
                  │
                  ▼
            PlannerAgent    (Step 2) → CareerPlanOutput
                  │
             [saved to Supabase: career_plans, gap_analyses, roadmaps]
                  │
                  ▼ (user completes all todos)
       ResumeOptimizerAgent (Step 3) → OptimizedResumeOutput
                  │
             [saved to Supabase: optimized_resumes]

[Chat]  →  ChatQnAAgent  →  ChatQnAOutput  (stateful, per-session)
```

Each step runs inside a **quality gate loop** (up to `MAX_QUALITY_RETRIES = 2`) that validates schema compliance and plan completeness before accepting a result.

## Workspace Skills (Progressive Disclosure)

Detailed I/O specs, constraints, and architecture notes for each agent and MCP skill are packaged as [Gemini CLI workspace skills](https://geminicli.com/docs/cli/skills/) in `.gemini/skills/`. The global context (this file) stays lightweight; detailed context is injected only when needed.

| Skill | Activates when working on |
|---|---|
| `.gemini/skills/gap-analyzer/` | `agents/gap-analyzer/index.ts` |
| `.gemini/skills/planner/` | `agents/planner/index.ts` |
| `.gemini/skills/chat-qna/` | `agents/chat-qna/index.ts` |
| `.gemini/skills/resume-optimizer/` | `agents/resume-optimizer/index.ts` |
| `.gemini/skills/mcp-skills/` | `mcp-skills/*/src/index.ts` |

## Coding Standards

- **Agent framework**: Google ADK TypeScript (`@google/adk`)
- **MCP runtime**: `@modelcontextprotocol/sdk`
- **Schema validation**: Zod at every agent I/O boundary
- **Language**: TypeScript ESM, Node ≥ 20
- **LLM model**: `gemini-3.1-flash-lite-preview` by default (all agents and MCP skills). Model ids live in one registry, `agents/lib/models.ts` (`GEMINI_MODEL` / `OPENAI_MODEL`) — never hardcode a model string. In-process code imports from there (app via `@readmycareer/agents/models`); MCP skills run as separate processes and read the same `GEMINI_MODEL` env var, so setting it once switches everything. Token **pricing** (`MODEL_PRICING`) is loaded from `config/model-pricing.json`, the single source the Python eval harness reads too — so live `/admin` cost and offline eval cost stay in sync.
- **Model calls go through the `ModelAdapter` interface** (`agents/lib/model-adapter.ts`) — never construct a provider SDK client inside an agent or the orchestrator. Gemini is the default; the gap-analysis stage is provider-swappable (`provider` arg / `MODEL_PROVIDER` env) via `agents/lib/adapters/`. To add a provider, implement `ModelAdapter` and register it in the `getModelAdapter` factory.
- **Observability**: the orchestrator records per-stage telemetry through `agents/lib/observability.ts` and forwards each metric via the `onMetric` callback. Agents stay free of telemetry/DB concerns; the API route persists metrics to `agent_runs`.
- All agent I/O types must be defined in `agents/types.ts`
- MCP skills are called via `callMcpTool()` in `agents/lib/mcp-client.ts` — never spawned directly
- Agents must not access Supabase, Pinecone, or the file system directly; all external access goes through MCP tool calls or is handled in the API route layer
- DB operations (fetching inputs, storing results) happen in `app/src/app/api/` routes, not inside agents

## Plan Harness (Claude Code + Codex 공통 — 필수)

이 저장소의 모든 비자명한 작업은 문서 기반 하네스를 통과해야 한다. 대화 히스토리가 아니라 `PLAN.md` / `TASK.md` 가 유일한 컨텍스트다.

SOP 전문: `.claude/skills/plan-harness/SKILL.md` — **작업 시작 전에 이 파일을 읽을 것.** Codex 도 동일 파일을 따른다.

```
plan   .harness/gate.sh init "<title>"   → PLAN.md 작성 (암묵지는 추측 금지, 사용자에게 선택지로 질문)
verify 자체 반박 리뷰 → TASK.md 원자 태스크 분해 → 사용자 승인 → .harness/gate.sh approve
run    그룹별 병렬 실행. 워커 프롬프트는 .harness/gate.sh prompt <ID> 출력 그대로만 사용
       Codex: .harness/gate.sh codex <ID>   (백그라운드, 로그 .harness/logs/<ID>.log)
done   .harness/gate.sh done <ID> → 전부 완료 후 .harness/gate.sh archive
```

- `PLAN.md` 의 `status` 가 `approved` 가 아니면 코드 편집 금지. Claude Code 는 PreToolUse 훅이 하드 블록하고, Codex 는 편집 전 `.harness/gate.sh status` 를 직접 확인해야 한다.
- 승인 전 편집 허용 경로: `PLAN.md`, `TASK.md`, `documents/**`, `.harness/**`, `.claude/**`, `/tmp/**`.
- 워커(서브에이전트)는 `PLAN.md` + `TASK.md` 만 읽는다. 이전 대화 요약을 프롬프트에 붙이지 말 것.
- 긴급 우회: `HARNESS_OFF=1`.

### 테스트 게이트 (구현 직후 자동)

```
pnpm test        # Jest — agents/ + mcp-skills/ 단위 테스트 (ESM+TS, jest.config.mjs)
pnpm test:e2e    # Playwright — e2e/*.spec.ts, webServer 가 pnpm dev 자동 기동
.harness/gate.sh stopcheck   # 1) 테스트 존재 → 2) Jest 통과 → 3) e2e 통과 순으로 강제
```

- Claude Code 는 `Stop` 훅이 `stopcheck` 를 자동 실행한다. **Codex 는 작업 종료 전 직접 실행할 것.**
- 변경된 `agents/**/x.ts`, `mcp-skills/*/src/x.ts` 에는 `x.test.ts` 가 반드시 있어야 한다.
- Jest 가 빨간 동안에는 세션을 끝낼 수 없다. **테스트를 약화시키지 말고 구현을 리팩터링**한다.
- 단위 테스트가 전부 통과한 뒤에만 Playwright e2e 가 실행된다.
- 재시도 상한은 `HARNESS_MAX_LOOPS`(기본 5). 초과하면 게이트가 물러나고 실패 상태를 사용자에게 보고해야 한다.

### 역할 분리 병렬 워커

태스크 하나당 역할 셋. `impl` 과 `test-author` 는 쓰기 영역이 겹치지 않아 병렬, `refactorer` 는 그 뒤 직렬.

| 역할 | 쓰는 파일 | 금지 |
|---|---|---|
| `impl` | 태스크의 `파일:` 목록 | `*.test.ts`, `e2e/*.spec.ts` |
| `test-author` | `*.test.ts`, `e2e/*.spec.ts`, 픽스처 | 구현 파일 |
| `refactorer` | 구현 파일 | 테스트 약화·skip·삭제 |

```
.harness/gate.sh codex T1 impl     # 병렬
.harness/gate.sh codex T1 tests    # 병렬
.harness/gate.sh codex T1 refactor # 위 둘이 끝난 뒤에만
```

- 역할 정의 원문: `.claude/agents/{impl,test-author,refactorer}.md` (Codex 도 이 파일을 읽는다).
- 워커 프롬프트는 `.harness/gate.sh prompt <ID> <role>` 출력 그대로 쓴다. 대화 요약 첨부 금지.
- **테스트는 구현이 아니라 PLAN.md 의 DoD 에서 파생한다.** 그래서 `test-author` 가 `impl` 과 동시에 돈다.
- `refactorer` 를 `impl` 과 동시에 돌리지 말 것 — 같은 파일을 쓴다.
