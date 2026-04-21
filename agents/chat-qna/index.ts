import {
  LlmAgent,
  AgentTool,
  FunctionTool,
  Context,
  isFinalResponse,
  stringifyContent,
} from "@google/adk";
import { z } from "zod";
import { callMcpTool } from "../lib/mcp-client.js";
import { GapAnalyzerAgent } from "../gap-analyzer/index.js";
import { PlannerAgent } from "../planner/index.js";
import {
  SESSION_KEYS,
  ChatQnAInput,
  ChatQnAOutput,
  ChatMessage,
} from "../types.js";

// ─── MCP Skill Tools ──────────────────────────────────────────────────────────

const ragSearchTool = new FunctionTool({
  name: "rag_search",
  description:
    "career-knowledge-base MCP 스킬로 RAG Vector DB에서 커리어/JD 관련 문서를 검색합니다.",
  parameters: z.object({
    query: z.string().describe("사용자 질문 기반 검색 쿼리"),
    top_k: z.number().int().min(1).max(10).default(5),
    filter: z
      .object({
        doc_type: z.enum(["jd", "reference", "all"]).default("all"),
      })
      .optional(),
  }),
  execute: async (args, _ctx?: Context) => {
    return callMcpTool("career-knowledge-base", "search", args as Record<string, unknown>);
  },
});

const getSessionContextTool = new FunctionTool({
  name: "get_session_context",
  description:
    "현재 세션에 저장된 이력서, 갭 분석 결과, 커리어 플랜 등의 컨텍스트를 가져옵니다.",
  parameters: z.object({
    keys: z
      .array(
        z.enum([
          SESSION_KEYS.RESUME_JSON,
          SESSION_KEYS.GAP_ANALYSIS,
          SESSION_KEYS.CAREER_PLAN,
          SESSION_KEYS.JD_TEXT,
        ])
      )
      .describe("가져올 세션 키 목록"),
  }),
  execute: async (args: Record<string, unknown>, ctx?: Context) => {
    const keys = args["keys"] as string[];
    const state = ctx?.state ?? {};
    return keys.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (state as Record<string, unknown>)[key] ?? null;
      return acc;
    }, {});
  },
});

const appendChatHistoryTool = new FunctionTool({
  name: "append_chat_history",
  description: "채팅 히스토리에 새 메시지를 추가하고 세션에 저장합니다.",
  parameters: z.object({
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        timestamp: z.string(),
      })
    ),
  }),
  execute: async (args: Record<string, unknown>, ctx?: Context) => {
    const state = ctx?.state as unknown as Record<string, unknown>;
    if (!state) return { success: false };
    const existing: ChatMessage[] =
      (state[SESSION_KEYS.CHAT_HISTORY] as ChatMessage[]) ?? [];
    const newMessages = args["messages"] as ChatMessage[];
    const updated = [...existing, ...newMessages];
    state[SESSION_KEYS.CHAT_HISTORY] = updated;
    return { updated_count: updated.length };
  },
});

// ─── Agent Instruction ────────────────────────────────────────────────────────

const INSTRUCTION = `
당신은 readmycareer.com의 커리어 상담 AI입니다.

역할:
- 사용자의 채팅 질의에 대해 정확하고 개인화된 답변을 제공합니다.
- RAG(Vector DB) 검색 결과와 이전 에이전트들의 분석 컨텍스트를 함께 활용합니다.

사용 가능한 컨텍스트 소스 (우선순위 순):
1. session.gap_analysis   → 개인화된 갭 분석 결과
2. session.career_plan    → 주차별 커리어 플랜
3. session.resume_json    → 사용자 이력서 데이터
4. rag_search 툴         → Vector DB의 JD/레퍼런스 문서
5. GapAnalyzerAgent      → 실시간 갭 분석 (컨텍스트 없을 때)
6. PlannerAgent          → 실시간 플랜 생성 (컨텍스트 없을 때)

답변 절차:
1. get_session_context 툴로 현재 세션 데이터를 확인합니다.
2. 질문 유형에 따라 적절한 소스를 선택합니다:
   - "내 강점/약점?" → gap_analysis 우선
   - "이번 주 할 일?" → career_plan 우선
   - "이 기술 뭐야?" → rag_search 우선
   - "처음부터 분석해줘" → GapAnalyzerAgent / PlannerAgent 호출
3. 답변과 함께 출처(sources)와 후속 질문 제안(follow_up_suggestions)을 포함합니다.
4. append_chat_history 툴로 대화 내용을 세션에 저장합니다.

출력 형식:
{
  "answer": "답변 내용 (마크다운 허용)",
  "sources": [{ "type": "rag|gap_analysis|career_plan|resume", "excerpt": "...", "doc_title": "..." }],
  "follow_up_suggestions": ["후속 질문 1", "후속 질문 2"],
  "updated_chat_history": [{ "role", "content", "timestamp" }]
}
`.trim();

// ─── ChatQnAAgent ─────────────────────────────────────────────────────────────

export const ChatQnAAgent = new LlmAgent({
  name: "ChatQnAAgent",
  model: "gemini-3.1-flash-lite-preview",
  description:
    "사용자 채팅 질의에 RAG + 이전 에이전트 컨텍스트를 결합하여 개인화된 답변을 생성합니다.",
  instruction: INSTRUCTION,
  tools: [
    ragSearchTool,
    getSessionContextTool,
    appendChatHistoryTool,
    new AgentTool({ agent: GapAnalyzerAgent }),
    new AgentTool({ agent: PlannerAgent }),
  ],
  outputKey: SESSION_KEYS.CHAT_HISTORY,
  generateContentConfig: {
    responseMimeType: "application/json",
  },
});

// ─── Standalone Runner (for development / testing) ───────────────────────────

export async function runChatQnA(input: ChatQnAInput): Promise<ChatQnAOutput> {
  const { Runner, InMemorySessionService } = await import("@google/adk");

  const sessionService = new InMemorySessionService();
  const runner = new Runner({
    appName: "readmycareer",
    agent: ChatQnAAgent,
    sessionService: sessionService,
  });

  const session = await sessionService.createSession({
    appName: "readmycareer",
    userId: "user",
    state: {
      [SESSION_KEYS.RESUME_JSON]: input.session_context.resume_json ?? null,
      [SESSION_KEYS.GAP_ANALYSIS]: input.session_context.gap_analysis ?? null,
      [SESSION_KEYS.CAREER_PLAN]: input.session_context.career_plan ?? null,
      [SESSION_KEYS.CHAT_HISTORY]: input.session_context.chat_history ?? [],
    },
  });

  for await (const event of runner.runAsync({
    sessionId: session.id,
    userId: "user",
    newMessage: { parts: [{ text: input.user_message }] },
  })) {
    if (isFinalResponse(event)) {
      const text = stringifyContent(event) || "{}";
      return JSON.parse(text) as ChatQnAOutput;
    }
  }

  const finalSession = await sessionService.getSession({
    appName: "readmycareer",
    sessionId: session.id,
    userId: "user",
  });

  return finalSession!.state[SESSION_KEYS.CHAT_HISTORY] as ChatQnAOutput;
}
