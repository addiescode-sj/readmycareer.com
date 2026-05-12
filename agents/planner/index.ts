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
import {
  SESSION_KEYS,
  PlannerInput,
  CareerPlanOutput,
} from "../types.js";

// ─── MCP Skill Tool: career-plan-generator.generate_plan ─────────────────────

const generatePlanTool = new FunctionTool({
  name: "generate_career_plan",
  description:
    "career-plan-generator MCP 스킬을 호출하여 갭 분석 결과로 주차별 플랜과 Timeline JSON을 생성합니다.",
  parameters: z.object({
    target_jd: z.object({
      title: z.string(),
      company: z.string().nullable(),
      required_skills: z.array(z.string()),
      preferred_skills: z.array(z.string()),
    }),
    gap_analysis: z.object({
      gaps: z.array(
        z.object({
          id: z.string(),
          category: z.enum(["skill", "experience", "certification", "portfolio", "keyword"]),
          item: z.string(),
          current_level: z.string().nullable(),
          required_level: z.string().nullable(),
          priority: z.enum(["high", "medium", "low"]),
          requirement_type: z.enum(["required", "preferred"]).default("required"),
          rationale: z.string(),
        })
      ),
      strengths: z.array(z.string()),
    }),
    duration_weeks: z.number().int().min(1).max(52),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    existing_projects: z
      .array(
        z.object({
          name: z.string(),
          tech_stack: z.array(z.string()),
          description: z.string().nullable(),
          achievements: z.array(z.string()),
          url: z.string().nullable(),
        })
      )
      .optional()
      .describe("User's existing side projects — passed through to MCP for project-leveraging tasks"),
    preferences: z
      .object({
        hours_per_week: z.number().default(10),
        learning_style: z.enum(["online_course", "book", "project", "mixed"]).default("mixed"),
      })
      .optional(),
  }),
  execute: async (args, _ctx?: Context) => {
    return callMcpTool("career-plan-generator", "generate_plan", args as Record<string, unknown>);
  },
});

// ─── Agent Instruction ────────────────────────────────────────────────────────

const INSTRUCTION = `
당신은 커리어 플래닝 전문가입니다.

역할:
- session.gap_analysis에 저장된 GapAnalyzerAgent의 분석 결과를 읽어옵니다.
- session.resume_json이 있으면 projects[]를 추출하여 기존 사이드 프로젝트를 플랜에 반영합니다.
- generate_career_plan 툴을 호출하여 주차별 커리어 준비 플랜을 생성합니다.
- UI에서 바로 렌더링 가능한 타임라인(Gantt)과 주차별 투두리스트 JSON을 반환합니다.

실행 절차:
1. session.gap_analysis에서 gaps, strengths, target_role 추출.
2. session.resume_json이 있으면 session.resume_json.projects[] 목록도 추출 (기존 사이드 프로젝트).
3. 사용자가 지정한 duration_weeks와 start_date 확인.
4. generate_career_plan 툴 호출 시 gap_analysis, duration_weeks, start_date와 함께 existing_projects도 전달.
5. 생성된 CareerPlanOutput을 session.career_plan에 저장.

출력 형식:
UI 렌더링을 위해 다음 JSON 스키마를 정확히 준수하세요:
{
  "plan_id": "uuid",
  "created_at": "ISO8601",
  "summary": "플랜 요약",
  "weeks": [
    {
      "week_number": 1,
      "date_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
      "theme": "주차 핵심 주제",
      "milestone": "마일스톤 또는 null",
      "todos": [{ "id", "title", "description", "category", "priority", "estimated_hours", "done", "resources" }]
    }
  ],
  "timeline": {
    "milestones": [{ "week": 1, "date": "YYYY-MM-DD", "label": "..." }],
    "gantt_rows": [{ "task", "start_week", "end_week", "category" }]
  }
}
`.trim();

// ─── PlannerAgent ─────────────────────────────────────────────────────────────

export { INSTRUCTION as PLANNER_INSTRUCTION };

export const PlannerAgent = new LlmAgent({
  name: "PlannerAgent",
  model: "gemini-3.1-flash-lite-preview",
  description:
    "GapAnalyzerAgent의 갭 분석 결과를 받아 주차별 커리어 플랜과 타임라인 JSON을 생성합니다.",
  instruction: INSTRUCTION,
  tools: [
    generatePlanTool,
    new AgentTool({ agent: GapAnalyzerAgent }),
  ],
  outputKey: SESSION_KEYS.CAREER_PLAN,
  generateContentConfig: {
    responseMimeType: "application/json",
  },
});

// ─── Standalone Runner (for development / testing) ───────────────────────────

export async function runPlanner(input: PlannerInput): Promise<CareerPlanOutput> {
  const { Runner, InMemorySessionService } = await import("@google/adk");

  const sessionService = new InMemorySessionService();
  const runner = new Runner({
    appName: "readmycareer",
    agent: PlannerAgent,
    sessionService: sessionService,
  });

  const session = await sessionService.createSession({
    appName: "readmycareer",
    userId: "system",
    state: {
      [SESSION_KEYS.GAP_ANALYSIS]: input.gap_analysis,
      ...(input.resume_projects
        ? { [SESSION_KEYS.RESUME_JSON]: { projects: input.resume_projects } }
        : {}),
    },
  });

  const prompt = `${input.duration_weeks}주 플랜을 시작일 ${input.start_date}로 생성해주세요.`;

  for await (const event of runner.runAsync({
    sessionId: session.id,
    userId: "system",
    newMessage: { parts: [{ text: prompt }] },
  })) {
    if (isFinalResponse(event)) {
      const text = stringifyContent(event) || "{}";
      return JSON.parse(text) as CareerPlanOutput;
    }
  }

  const finalSession = await sessionService.getSession({
    appName: "readmycareer",
    sessionId: session.id,
    userId: "system",
  });

  return finalSession!.state[SESSION_KEYS.CAREER_PLAN] as CareerPlanOutput;
}
