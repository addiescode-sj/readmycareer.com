---
name: handoff
description: Read documents/handoff.md, reconcile its checklist against git/file state, surface mismatches, and let the user pick the next task to work on. Use when the user runs /handoff, wants to resume work, choose the next todo, mark work done, or add a new todo to the handoff list. Bare /handoff reconciles and picks the next task; /handoff add <description> appends a todo.
---

# Handoff workflow

세션 간 "다음 할 일"을 보관하는 `documents/handoff.md`를 읽고 갱신하는 스킬이다.
원칙: **읽기·git 대조는 자동으로, 문서 변경(완료 이동/추가)은 항상 사용자 확인 후에 한다.** 안내 출력은 한국어, 문서 본문 형식은 고정 템플릿을 따른다.

문서 경로: `documents/handoff.md` (프로젝트 루트 기준).

## 항목 형식 (문서 내 고정 구조)

```
- [ ] **<제목>** — <한 줄 설명>
  - 파일: `path/a`, `path/b`
  - 이유: <왜 필요한가>
  - 완료 기준(DoD): <무엇이 되면 끝인가>
```

섹션: `## 🔜 To Do` / `## 🚧 In Progress` (`시작: <날짜>` 추가) / `## ✅ Done` (`- [x]` + `(완료: <날짜>, 커밋: <hash 또는 -->)`).

## Mode A — `/handoff` (기본: reconcile + 다음 작업 선택)

1. **Read** — Read `documents/handoff.md`.
   - 파일이 없으면: 새로 만들지 사용자에게 물어보고, 동의 시 표준 템플릿(아래 "Template" 참조)으로 생성한 뒤 종료.

2. **Reconcile (read-only)** — 완료 여부를 자동 대조한다. 문서는 아직 수정하지 않는다.
   - `git log --oneline -20` 으로 최근 커밋을, `git status --short` 로 미커밋 변경을 본다.
   - 각 To Do / In Progress 항목의 "파일" 경로가 최근 커밋이나 작업 트리에서 다뤄졌으면 → **"이미 완료됐을 수 있음" 후보**로 표시.
   - 각 Done 항목의 커밋 hash가 실제 git 히스토리에 존재하는지 가볍게 확인(`git cat-file -e <hash>` 또는 log 대조). 없으면 mismatch로 표시.
   - **불일치(mismatch) 목록을 한국어로 보고**한다. 자동으로 옮기지 않는다.

3. **Confirm & move** — mismatch가 있으면 사용자에게 "이 항목을 Done으로 옮길까요?"를 확인한다.
   - 동의한 항목만 Edit으로 해당 블록을 Done 섹션으로 이동: `[ ]`→`[x]`, `(완료: <오늘 날짜>, 커밋: <hash 또는 -->)` 기록.
   - `마지막 갱신:` 줄을 오늘 날짜로 갱신. 날짜는 환경의 현재 날짜를 사용(추측 금지).

4. **Pick next** — 남은 To Do / In Progress를 번호 매겨 보여준다.
   - 항목이 1~4개면 `AskUserQuestion`(header `다음 작업`)으로 선택하게 한다.
   - 4개 초과면 번호 목록을 텍스트로 출력하고 사용자 입력을 받는다.
   - 남은 항목이 없으면 그 사실을 알리고 `/handoff add`로 추가하도록 안내 후 종료.

5. **Load context & start** — 선택 항목의 파일·이유·DoD를 한국어로 요약한다.
   - 해당 블록을 `## 🚧 In Progress`로 옮기고 `시작: <오늘 날짜>` 줄을 추가(Edit).
   - 관련 파일을 Read하여 컨텍스트를 적재한 뒤 작업을 시작한다.

## Mode B — `/handoff add <description>`

1. Read `documents/handoff.md`.
2. 사용자 설명을 항목 형식으로 정리한다. 파일/이유/DoD가 불명확하면 한 번만 짧게 물어보고, 그래도 불명확하면 `<미정>`으로 채운다.
3. `## 🔜 To Do` 섹션 맨 위(우선순위 높음)에 새 블록을 Edit으로 추가. `마지막 갱신:` 갱신.
4. 추가된 항목을 사용자에게 확인 출력.

## Template (문서가 없을 때 생성용)

```markdown
# Handoff — 작업 인수인계

> 세션 간 "다음 할 일"을 보관하는 문서. `/handoff` 스킬이 읽고 갱신한다.
> 각 항목은 새 세션에서 컨텍스트 없이도 재개할 수 있을 만큼 적어둘 것.

마지막 갱신: <오늘 날짜>

## 🔜 To Do

## 🚧 In Progress

## ✅ Done
```

## Notes

- 커밋 생성은 강제하지 않는다. hash 기록은 사용자가 이미 커밋한 경우에만 참조한다. (커밋이 필요하면 프로젝트의 Conventional Commits 규칙을 따른다.)
- 문서를 수정할 때는 항상 Edit로 최소 변경만 한다. 형식·이모지 헤더를 임의로 바꾸지 않는다.
- `git` 명령은 모두 read-only(log/status/cat-file)만 사용한다.
