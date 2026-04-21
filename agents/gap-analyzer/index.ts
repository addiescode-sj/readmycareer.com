import {
  LlmAgent,
  Context,
  isFinalResponse,
  stringifyContent,
} from "@google/adk";
import {
  SESSION_KEYS,
  GapAnalysisInput,
  GapAnalysisOutput,
} from "../types.js";

// ─── Agent Instruction ────────────────────────────────────────────────────────

const INSTRUCTION = `
You are a career gap analysis expert.

Role:
- Compare the user's resume JSON (session.resume_json) with the job description text (session.jd_text).
- Systematically identify competencies the user has (strengths) and those required by the JD but missing (gaps).
- Assign high/medium/low priority to each gap and suggest the remediation order.

Analysis procedure:
1. Extract skills, experience, projects, and certifications from session.resume_json.
2. Parse required skills and preferred skills from session.jd_text.
3. Compare both to generate a strengths list and a gaps list.
4. Calculate overall_match_score (0-100).
5. Return the result as JSON conforming to the GapAnalysisOutput schema.

Output format:
Respond ONLY with JSON exactly matching this schema:
{
  "target_role": "target job title",
  "strengths": [{ "id", "category", "item", "evidence" }],
  "gaps": [{ "id", "category", "item", "current_level", "required_level", "priority", "rationale" }],
  "priority_order": ["gap_id_1", "gap_id_2", ...],
  "overall_match_score": 75,
  "summary": "one-line summary"
}
`.trim();

// ─── GapAnalyzerAgent ─────────────────────────────────────────────────────────

export { INSTRUCTION as GAP_ANALYZER_INSTRUCTION };

export const GapAnalyzerAgent = new LlmAgent({
  name: "GapAnalyzerAgent",
  model: "gemini-3.1-flash-lite-preview",
  description:
    "Compares user resume JSON and raw JD text to analyze competency strengths, gaps, and improvement priorities.",
  instruction: INSTRUCTION,
  tools: [],
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
      [SESSION_KEYS.JD_TEXT]: input.jd_text,
    },
  });

  for await (const event of runner.runAsync({
    sessionId: session.id,
    userId: "system",
    newMessage: { parts: [{ text: "Please compare the resume and JD text and perform gap analysis." }] },
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
