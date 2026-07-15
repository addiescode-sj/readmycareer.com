# Handoff — 작업 인수인계

> 세션 간 "다음 할 일"을 보관하는 문서. `/handoff` 스킬이 읽고 갱신한다.
> 각 항목은 새 세션에서 컨텍스트 없이도 재개할 수 있을 만큼 적어둘 것.

마지막 갱신: 2026-07-13

## 🔜 To Do
<!-- 우선순위 높은 순으로. 형식:
- [ ] **<제목>** — <한 줄 설명>
  - 파일: `path/a`, `path/b`
  - 이유: <왜 필요한가>
  - 완료 기준(DoD): <무엇이 되면 끝인가>
-->

- [ ] **AI SDK 점진적 교체 마무리** — `GeminiAdapter`의 컨텍스트 캐시 경로와 OpenAI adapter를 나머지 스택처럼 Vercel AI SDK로 옮긴다.
  - 파일: `agents/lib/adapters/gemini-adapter.ts`, `agents/lib/adapters/openai-adapter.ts`, `agents/lib/model-adapter.ts`
  - 이유: v0.8.0에서 `/api/chat`과 resume-optimizer는 이미 AI SDK(`streamText`/`generateObject`)로 이관했지만, `GeminiAdapter`의 캐시 경로(`GoogleAICacheManager`)와 OpenAI adapter는 여전히 provider SDK를 직접 호출한다 — 마이그레이션이 절반만 끝난 상태. AI SDK google provider의 `cachedContent` provider option이 기존 캐시 레지스트리(TTL, 동시 생성 dedup) 의미론과 맞는지 검증 없이 그대로 바꾸면 캐시 재사용이 깨질 수 있어 보류돼 있었다.
  - 완료 기준(DoD): gap-analyzer/planner 캐시 경로가 AI SDK를 통해 호출되고 기존 캐시 히트/미스 동작이 eval 회귀 없이 유지됨. OpenAI adapter가 `@ai-sdk/openai` 기반으로 전환되고 `provider="openai"` 경로가 기존과 동일하게 동작함.

- [ ] **Streaming UI 최적화** — `/api/chat`과 `/api/analyze`의 스트리밍 표시 경험을 다듬는다.
  - 파일: `app/src/components/chat/ChatMessageParts.tsx`, `app/src/hooks/useCareerCoachChat.ts`, `app/src/components/ui/AnalysisProgressOverlay.tsx`, `app/src/app/api/analyze/route.ts`
  - 이유: v0.8.0에서 채팅은 reasoning/tool-call 제너레이티브 UI를, 분석은 토큰 스트리밍 "AI Reasoning" 패널을 처음 도입했지만 최소 구현 상태다 — 토큰 단위로 매 청크 리렌더, reasoning 블록 자동 접기/펼치기 없음, 분석 진행률(%)이 SSE progress 이벤트 기반 추정치라 실제 토큰 스트림과 어긋날 수 있음. 스트리밍 UX를 실제로 다듬어본 적은 없다.
  - 완료 기준(DoD): 긴 응답에서 체감 렉/버벅임 없이 부드럽게 렌더링되고(스로틀링/배칭 검토), reasoning 스트림 UI가 실제 사용자 테스트를 거쳐 다듬어짐.

- [ ] **관측성(observability) 확대** — `/api/chat`과 `career_plan_jobs`에 텔레메트리를 추가한다.
  - 파일: `app/src/app/api/chat/route.ts`, `agents/lib/observability.ts`, `app/src/app/api/analyze/route.ts`, `supabase/migrations/20260713000000_add_career_plan_jobs.sql`
  - 이유: 현재 `agent_runs`/`/admin` 관측성은 gap-analysis·planner·resume-optimizer 단계만 커버한다. v0.8.0에서 `/api/chat`을 `streamText`로 새로 구현했지만 `onMetric`/`agent_runs` 연동이 없어 채팅 비용·레이턴시·토큰 사용량이 전혀 집계되지 않는다. `career_plan_jobs`(체크포인트 재개 여부, fingerprint mismatch 빈도)도 로그로만 남고 집계되지 않는다.
  - 완료 기준(DoD): 채팅 턴마다 `agent_runs`에 stage=`chat`으로 비용/레이턴시/토큰이 기록되고 `/admin/observability`에 반영됨. `career_plan_jobs`의 재개/리플레이/fingerprint mismatch 발생률을 확인할 수 있는 집계(로그든 뷰든)가 생김.

## 🚧 In Progress
<!-- 현재 진행 중. To Do와 같은 형식 + `시작: <날짜>` 한 줄 추가 -->

## ✅ Done
<!-- 완료 항목. 형식:
- [x] **<제목>** — <한 줄> (완료: <날짜>, 커밋: <hash 또는 -->)
-->

- [x] **eval 파이썬 하네스를 TypeScript로 이관** — Python 평가 스크립트 5종을 `@readmycareer/eval` TS 워크스페이스 패키지(tsx 실행)로 재작성. RAGAS 4지표는 JS 포트가 없어 네이티브로 재구현, 모든 경계를 Zod로 검증, 임계값·CSV·리포트 출력 보존(임계값 미하향). 어드버서리얼 parity 리뷰로 검증, render 출력은 기존 CSV 대비 바이트 동일 확인. (완료: 2026-06-16, 커밋: fdce719, 7000857)
