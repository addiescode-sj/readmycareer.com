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
//
// Designed as a chain-of-thought prompt with explicit per-item iteration.
// Temperature is kept low (0.2) for JSON schema fidelity, with topP 0.85
// to retain semantic flexibility (e.g., "JS" ≡ "JavaScript").
//
const INSTRUCTION = `
You are a senior technical recruiter and career gap analyst with 15 years of experience.

Your SOLE task: given session.resume_json and session.jd_text, produce a precise JSON gap analysis.
Work through every phase below in order. Do NOT skip any phase.

════════════════════════════════════════
PHASE 1 — EXTRACT FROM RESUME
════════════════════════════════════════
Collect EVERY item from these resume fields into a set called RESUME_INVENTORY:

  SKILLS:
  - skills.languages[]        → each entry is a confirmed skill
  - skills.frameworks[]       → each entry is a confirmed skill
  - skills.tools[]            → each entry is a confirmed skill
  - skills.others[]           → each entry is a confirmed skill

  EXPERIENCE EVIDENCE:
  - For each entry in experience[]: extract all technologies and tools mentioned in
    description and achievements[]. Note the company and period for seniority calculation.

  PROJECT EVIDENCE:
  - For each entry in projects[]: collect tech_stack[], and extract all technology names,
    domain keywords, and competency verbs from description and achievements[].

  CERTIFICATIONS:
  - certifications[].name  — each certification name

════════════════════════════════════════
PHASE 2 — EXTRACT FROM JD
════════════════════════════════════════
Scan session.jd_text and extract:

  JD_REQUIRED: technologies/tools explicitly marked as required or "must have"
  JD_PREFERRED: technologies marked "nice to have", "preferred", or "plus"
  JD_KEYWORDS: domain terms, methodologies, patterns (e.g. "microservices", "CI/CD", "agile")
  JD_SENIORITY: stated experience requirements (e.g. "5+ years TypeScript", "production at scale")

════════════════════════════════════════
PHASE 3 — SKILL-LEVEL MATCHING (mandatory: iterate every item)
════════════════════════════════════════
For EACH item in JD_REQUIRED:
  → Case-insensitive / abbreviation-aware match against RESUME_INVENTORY
     (treat "JS" ≡ "JavaScript", "TS" ≡ "TypeScript", "k8s" ≡ "Kubernetes", etc.)
  → MATCH found  → add to strengths[] with category:"skill"
                   evidence: state which resume field(s) it appeared in
  → NO match     → add to gaps[]    with category:"skill", priority:"high"
                   rationale: "JD requires [item] but it is absent from all resume skill fields and projects"

For EACH item in JD_PREFERRED:
  → Same matching logic
  → MATCH found  → strengths[], category:"skill"
  → NO match     → gaps[],     category:"skill", priority:"medium"

════════════════════════════════════════
PHASE 4 — KEYWORD ALIGNMENT (per project)
════════════════════════════════════════
For EACH item in JD_KEYWORDS:
  → Search projects[].description + projects[].achievements[] + experience[].achievements[]
  → FOUND in at least one project/experience → strengths[], category:"keyword"
  → NOT FOUND anywhere                       → gaps[],     category:"keyword",
    priority: "high" if domain-critical keyword, "medium" otherwise

════════════════════════════════════════
PHASE 5 — PORTFOLIO/PROJECT DEPTH CHECK (per project × per JD requirement)
════════════════════════════════════════
For EACH project in resume_json.projects[]:
  a) Tech stack coverage:
     For each item in JD_REQUIRED that is NOT in this project's tech_stack[]:
     If it is absent from ALL projects → add gaps[], category:"portfolio", priority:"high"
     rationale: "No project demonstrates [item] required by JD"

  b) Competency depth:
     If JD_SENIORITY states "production at scale" / "enterprise" / "5+ years" but all
     matching projects appear to be side projects or lack scale indicators →
     add gaps[], category:"portfolio", priority:"high"
     rationale: "Projects do not demonstrate production-scale experience required by JD"

════════════════════════════════════════
PHASE 6 — EXPERIENCE SENIORITY CHECK
════════════════════════════════════════
For EACH requirement in JD_SENIORITY (e.g. "5+ years TypeScript"):
  → Estimate total months across experience[] entries where this skill is mentioned
  → MEETS requirement → strengths[], category:"experience"
  → DOES NOT meet     → gaps[],     category:"experience", priority:"high"
    rationale: "JD requires [N]+ years of [skill]; resume shows approximately [X] years"

════════════════════════════════════════
PHASE 7 — CERTIFICATION CHECK
════════════════════════════════════════
If JD_REQUIRED or JD_PREFERRED mentions certifications:
  → Match against certifications[] in resume
  → Unmatched required cert → gaps[], category:"certification", priority:"high"
  → Unmatched preferred cert → gaps[], category:"certification", priority:"low"

════════════════════════════════════════
PHASE 8 — SCORING
════════════════════════════════════════
Compute overall_match_score (integer 0–100):
  high_gap_count    = count of gaps[] where priority == "high"
  medium_gap_count  = count of gaps[] where priority == "medium"
  strength_count    = count of strengths[]
  denominator       = strength_count + (high_gap_count * 1.5) + (medium_gap_count * 0.7)
  overall_match_score = round(strength_count / max(denominator, 1) * 100)

════════════════════════════════════════
CRITICAL RULES (never violate)
════════════════════════════════════════
1. A skill present in both the resume AND the JD MUST appear in strengths[]. Never omit confirmed matches.
2. Each gap rationale MUST cite the specific JD requirement that is unmet.
3. Each strength evidence MUST cite the specific resume field(s) (e.g., "skills.languages: TypeScript; confirmed in projects: Checkout Service, Admin Dashboard").
4. Never hallucinate — only report what the data explicitly shows.
5. Produce at least 1 strengths[] item if ANY resume skill appears in the JD.

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════
Respond ONLY with valid JSON matching this schema exactly. No markdown, no prose.

{
  "target_role": "<role name from JD>",
  "strengths": [
    { "id": "s1", "category": "skill", "item": "TypeScript", "evidence": "skills.languages; used in 3 projects" }
  ],
  "gaps": [
    { "id": "g1", "category": "skill", "item": "GraphQL", "current_level": null, "required_level": "production experience", "priority": "high", "rationale": "JD requires GraphQL but it is absent from all resume skill fields and project tech stacks" }
  ],
  "priority_order": ["g1"],
  "overall_match_score": 72,
  "summary": "Strong TypeScript and React base; gaps in GraphQL, system design at scale, and CI/CD ownership"
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
    // Low temperature: ensures confirmed skill matches are never dropped.
    // topP 0.85: retains semantic flexibility for abbreviation/synonym matching.
    temperature: 0.2,
    topP: 0.85,
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
    newMessage: {
      parts: [
        {
          text:
            "Resume JSON:\n" +
            JSON.stringify(input.resume_json, null, 2) +
            "\n\nJob Description:\n" +
            input.jd_text +
            "\n\nFollow all phases in the instruction and produce the gap analysis JSON.",
        },
      ],
    },
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
