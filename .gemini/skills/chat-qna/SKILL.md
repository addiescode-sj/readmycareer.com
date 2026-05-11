---
name: chat-qna
description: Expertise in developing and modifying the ChatQnAAgent. Use when the user asks to update the AI career coach chat logic, context injection, chat history handling, follow-up suggestion generation, or source citation behavior in agents/chat-qna/.
---

# Chat QnA Agent

## Responsibilities

Provides conversational career coaching grounded in the user's resume, gap analysis, and career plan. Answers follow-up questions, explains plan rationale, and suggests next steps. Returns structured responses with cited sources and follow-up question suggestions.

## I/O Specifications

- **Input**: `userMessage` (string), `sessionContext` containing:
  - `resume_json` (ResumeJson | null)
  - `gap_analysis` (GapAnalysisOutput | null)
  - `career_plan` (CareerPlanOutput | null)
  - `chat_history` (array)
- **Output**: `ChatQnAOutput` — `{ answer, sources, follow_up_suggestions, updated_chat_history }`
- **Location**: `agents/chat-qna/index.ts` — exports `ChatQnAAgent`
- **Orchestration**: Called from `agents/orchestrator.ts` → `runChatQnA()` via Google ADK `Runner`

## Key Design Decisions

- **ADK Runner**: Unlike the gap analyzer and planner (which call Gemini directly), ChatQnAAgent runs through the Google ADK `Runner` with `InMemorySessionService`. Session state keys follow `SESSION_KEYS` from `agents/types.ts`.
- **Context grounding**: All answers must be grounded in the injected session context. The agent should cite which part of the gap analysis or career plan informed its answer.
- **Chat history**: The agent receives prior `chat_history` as session state and must return `updated_chat_history` in its output.

## Data Transfer Rules

- Always use types from `agents/types.ts` (`ChatQnAOutput`, `SESSION_KEYS`)
- Session state keys: `SESSION_KEYS.RESUME_JSON`, `SESSION_KEYS.GAP_ANALYSIS`, `SESSION_KEYS.CAREER_PLAN`, `SESSION_KEYS.CHAT_HISTORY`
- Never access Pinecone, Supabase, or the file system directly from this agent
