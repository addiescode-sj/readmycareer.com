# 에이전트 출력 품질 리포트

> `eval/agent_harness.py`가 매 실행마다 **자동 생성** — 직접 수정하지 마세요.
> 원본 케이스별 수치: [`eval/agent_harness_results.csv`](../eval/agent_harness_results.csv).
> 갱신 방법: `pnpm dev` 실행 후 `pnpm eval:agents`(또는 `pnpm eval`).

- **생성 시각:** 2026-06-01 20:31:43
- **결과:** ❌ **FAIL** — 일부 게이트 지표가 기준 미달
- **케이스:** 3/3 성공
- **LLM 심사 모델:** `gemini-3.1-flash-lite-preview`

## 종합 지표

| 지표                  | 점수      | 기준      | 상태   |
|---------------------|---------|---------|------|
| 스키마 준수율             | 100.00% | >= 95%  | PASS |
| JSON 파싱 오류율         | 0.00%   | <  5%   | PASS |
| 갭 충실도 (LLM 심사)      | 0.6000  | >= 0.7  | FAIL |
| 플랜 완성도              | 100.00% | >= 90%  | PASS |
| 날짜 연속성              | 100.00% | = 100%  | PASS |
| p50 지연시간            | 14.1s   | —       | INFO |
| p95 지연시간            | 16.7s   | < 30.0s | PASS |
| 요청당 평균 비용           | $0.0009 | < $0.01 | PASS |
| 적합도 점수 범위 적중        | 0.00%   | >= 80%  | FAIL |
| 갭 재현율 (라벨 대비)       | 41.67%  | >= 50%  | FAIL |
| 갭 정밀도 (INFO)        | 42.22%  | —       | INFO |
| 카테고리 다양성 (≥3)       | 33.33%  | = 100%  | FAIL |
| 프로젝트 포트폴리오 강점       | 100.00% | >= 80%  | PASS |
| 프로젝트-플랜 연계          | 33.33%  | >= 70%  | FAIL |
| 숨은 기대 커버리지          | 33.33%  | >= 66%  | FAIL |
| 선수(prerequisite) 순서 | 100.00% | = 100%  | PASS |
| 맥락 깊이 (LLM 심사)      | 0.5000  | >= 0.7  | FAIL |

## 케이스별 점수

| 케이스                         | 지연    | 스키마   |   충실도 |   깊이 |   재현율 | todo≥3   | 날짜   | 숨은기대   |   적합도 | 비용      |
|-----------------------------|-------|-------|-------|------|-------|----------|------|--------|-------|---------|
| fx_junior_frontend_fintech  | 14.1s | ✓     |   0.7 |  0.4 |  0.5  | ✓        | ✓    | ✗      |    23 | $0.0008 |
| fx_python_backend_to_nodejs | 11.4s | ✓     |   0.7 |  0.4 |  0.75 | ✓        | ✓    | ✓      |    45 | $0.0008 |
| fx_fullstack_global_tech    | 16.7s | ✓     |   0.4 |  0.7 |  0    | ✓        | ✓    | ✗      |    88 | $0.0011 |

범례: ✓ / ✗ = 케이스별 통과 / 실패 · 충실도·깊이 = LLM 심사 (0–1) ·
재현율 = 라벨 대비 (0–1) · 적합도 = `overall_match_score` (0–100).

## 지표 설명

| 지표 | 기준 | 의미 |
| --- | --- | --- |
| **스키마 준수율** (Schema Compliance) | ≥ 95% | 응답 JSON이 `CareerPlanOutput` 스키마(`gap_analysis` + `weeks`, 필수 필드 포함)를 통과한 비율. 에이전트 출력의 구조적 유효성. |
| **JSON 파싱 오류율** (JSON Parse Error) | < 5% | 응답 본문을 JSON으로 아예 파싱하지 못한 비율(`1 − 성공/전체`). 낮을수록 좋음. |
| **갭 충실도** (Gap Faithfulness, LLM 심사) | ≥ 0.70 | 각 갭이 JD/이력서 근거에 기반했는지(환각이 아닌지)를 LLM 심사가 0–1로 채점. `--skip-llm-judge` 시 `SKIP`. |
| **플랜 완성도** (Plan Completeness) | ≥ 90% | 모든 주차가 todo를 3개 이상 가진 플랜의 비율. |
| **날짜 연속성** (Date Consistency) | = 100% | 주차별 날짜 구간이 시간순으로 연속(end ≥ start, 다음 주 시작이 이전 주 종료 +2일 이내)인 플랜 비율. |
| **지연시간** (p50 / p95 Latency) | p95 < 30s | `/api/analyze` 응답 시간의 중앙값 / 95퍼센타일. p50은 참고(INFO). |
| **요청당 평균 비용** (Avg Cost / Request) | < $0.01 | 요청당 추정 비용(USD). prompt+completion 토큰 × 단가(`config/model-pricing.json`). |
| **적합도 점수 범위 적중** (Match Score In Range) | ≥ 80% | `overall_match_score`가 fixture의 기대 범위 안에 든 비율 — 모델이 적합도를 과대/과소 평가하는지 점검. |
| **갭 재현율** (Gap Recall, 라벨 대비) | ≥ 50% | fixture에 라벨된 갭 키워드(`expected_gaps_keywords`) 중 분석이 실제로 짚어낸 비율(각 갭 `item`+`rationale`에 대소문자 무시 부분일치). 골든셋 대비 내용 정확도. |
| **갭 정밀도** (Gap Precision) | INFO | 모델이 제시한 갭 중 라벨 키워드를 1개 이상 맞춘 비율. 라벨이 비포괄적이라(라벨 밖의 정당한 갭은 오탐처럼 보임) 게이트 없이 참고용. |
| **카테고리 다양성** (Category Diversity, ≥3) | = 100% | 갭+강점이 3개 이상 카테고리(`skill`/`experience`/`certification`/`portfolio`/`keyword`)에 걸치는지(+fixture가 명시한 카테고리 포함). 단조로운 분석 방지. |
| **프로젝트 포트폴리오 강점** (Project Portfolio Strength) | ≥ 80% | 이력서에 프로젝트가 있는 fixture에서 `portfolio` 카테고리 강점을 1개 이상 짚었는지(프로젝트 없으면 자동 통과). |
| **프로젝트-플랜 연계** (Project Plan Integration) | ≥ 70% | 프로젝트가 있는 fixture에서 주간 todo 1개 이상이 기존 프로젝트명을 참조하는지(부분일치). 보유 자산 위에 플랜을 쌓는지. |
| **숨은 기대 커버리지** (Hidden Expectation Coverage) | ≥ 66% | JD에 문자 그대로 없지만 reference 코퍼스가 직무/티어에 연결하는 *암묵적* 기대를 1개 이상 표면화했는지(README 갭 영역 #2). RAG grounding 지표 — reference 코퍼스 시딩 필요. |
| **선수(prerequisite) 순서** (Prerequisite Ordering) | = 100% | fixture가 선언한 `[before, after]` 쌍마다, 의존 대상보다 기초 갭이 더 낮게 랭크되지 않는지(랭크 = 우선순위 가중치 → 배열 인덱스 순). README 갭 영역 #5. |
| **맥락 깊이** (Contextual Depth, LLM 심사) | ≥ 0.70 | 키워드 매칭을 넘어선 종합 깊이 — 스킬 전이성, 회사 단계/티어 적합, 시장 적합성(README 갭 영역 #1/#3/#4)을 LLM 심사가 0–1로 채점. `--skip-llm-judge` 시 `SKIP`. |

**상태 범례:** `PASS` / `FAIL` = 기준 충족 / 미달 · `INFO` = 측정만 하고 게이트 없음 · `SKIP` = LLM 심사 미수행(`--skip-llm-judge`).

> 비용 산출 상세 기준은 [비용 산출 기준](./cost-calculation.ko.md) 문서를 참고하세요.

