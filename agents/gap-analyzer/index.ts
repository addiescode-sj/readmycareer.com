import {
  LlmAgent,
  FunctionTool,
  Context,
  isFinalResponse,
  stringifyContent,
} from "@google/adk";
import { z } from "zod";
import { callMcpTool } from "../lib/mcp-client.js";
import {
  SESSION_KEYS,
  GapAnalysisInput,
  GapAnalysisOutput,
  omitPersonal,
} from "../types.js";

// ─── MCP Skill Tool: career-knowledge-base.search ────────────────────────────

const searchKnowledgeBaseTool = new FunctionTool({
  name: "search_knowledge_base",
  description:
    "career-knowledge-base MCP 스킬을 호출하여 JD/커리어 레퍼런스 문서를 검색합니다.",
  parameters: z.object({
    query: z.string().describe("검색 쿼리"),
    top_k: z.number().int().min(1).max(10).default(5),
    filter: z
      .object({
        doc_type: z.enum(["jd", "reference", "all"]).default("jd"),
        tags: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  execute: async (args, _ctx?: Context) => {
    return callMcpTool("career-knowledge-base", "search", args as Record<string, unknown>);
  },
});

// ─── Agent Instruction ────────────────────────────────────────────────────────

const INSTRUCTION = `
당신은 커리어 갭 분석 전문가입니다.

역할:
- 사용자의 이력서 JSON(session.resume_json)과 JD 검색 결과(session.jd_search_results)를 비교 분석합니다.
- 사용자가 보유한 역량(strengths)과 JD 기준으로 부족한 역량(gaps)을 체계적으로 식별합니다.
- 각 갭에 대해 high/medium/low 우선순위를 부여하고 보완 순서를 제안합니다.

분석 절차:
1. session.resume_json에서 skills, experience, projects, certifications 섹션을 추출합니다.
2. session.jd_search_results에서 required_skills와 preferred_skills를 파악합니다.
3. 두 데이터를 비교하여 strengths와 gaps 목록을 생성합니다.
4. overall_match_score(0~100)를 산출합니다.
5. 결과를 GapAnalysisOutput 스키마에 맞는 JSON으로 반환합니다.

출력 형식:
반드시 다음 JSON 스키마를 정확히 준수하여 응답하세요:
{
  "target_role": "지원 직무명",
  "strengths": [{ "id", "category", "item", "evidence" }],
  "gaps": [{ "id", "category", "item", "current_level", "required_level", "priority", "rationale" }],
  "priority_order": ["gap_id_1", "gap_id_2", ...],
  "overall_match_score": 75,
  "summary": "한 줄 요약"
}
`.trim();

// ─── GapAnalyzerAgent ─────────────────────────────────────────────────────────

export { INSTRUCTION as GAP_ANALYZER_INSTRUCTION };

export const GapAnalyzerAgent = new LlmAgent({
  name: "GapAnalyzerAgent",
  model: "gemini-2.5-flash",
  description:
    "사용자 이력서 JSON과 JD 데이터를 비교하여 보유/부족 역량과 보완 우선순위를 분석합니다.",
  instruction: INSTRUCTION,
  tools: [searchKnowledgeBaseTool],
  outputKey: SESSION_KEYS.GAP_ANALYSIS,
  generateContentConfig: {
    responseMimeType: "application/json",
  },
});

// ─── Standalone Runner (for development / testing) ───────────────────────────

export async function runGapAnalyzer(
  input: GapAnalysisInput
): Promise<GapAnalysisOutput> {
  const { Runner, InMemorySessionService } = await import("@google/adk");

  const sessionService = new InMemorySessionService();
  const runner = new Runner({
    appName: "readmycareer",
    agent: GapAnalyzerAgent,
    sessionService: sessionService,
  });

  const session = await sessionService.createSession({
    appName: "readmycareer",
    userId: "system",
    state: {
      [SESSION_KEYS.RESUME_JSON]: input.resume_json,
      [SESSION_KEYS.JD_SEARCH_RESULTS]: input.jd_search_results,
    },
  });

  for await (const event of runner.runAsync({
    sessionId: session.id,
    userId: "system",
    newMessage: { parts: [{ text: "이력서와 JD를 비교하여 갭 분석을 수행해주세요." }] },
  })) {
    if (isFinalResponse(event)) {
      const text = stringifyContent(event) || "{}";
      return JSON.parse(text) as GapAnalysisOutput;
    }
  }

  const finalSession = await sessionService.getSession({
    appName: "readmycareer",
    sessionId: session.id,
    userId: "system",
  });

  return finalSession!.state[SESSION_KEYS.GAP_ANALYSIS] as GapAnalysisOutput;
}
