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
  → NO match     → add to gaps[]    with category:"skill", priority:"high", requirement_type:"required"
                   rationale: "JD requires [item] but it is absent from all resume skill fields and projects"

For EACH item in JD_PREFERRED:
  → Same matching logic
  → MATCH found  → strengths[], category:"skill"
  → NO match     → gaps[],     category:"skill", priority:"medium", requirement_type:"preferred"

════════════════════════════════════════
PHASE 4 — KEYWORD ALIGNMENT (per project)
════════════════════════════════════════
For EACH item in JD_KEYWORDS:
  → Search projects[].description + projects[].achievements[] + experience[].achievements[]
  → FOUND in at least one project/experience → strengths[], category:"keyword"
  → NOT FOUND anywhere                       → gaps[],     category:"keyword",
    priority: "high" if domain-critical keyword, "medium" otherwise
    requirement_type: "required" if domain-critical keyword, "preferred" otherwise

════════════════════════════════════════
PHASE 5 — PORTFOLIO/PROJECT DEPTH CHECK (per JD requirement)
════════════════════════════════════════
First, build a set called ALL_PROJECT_STACKS by collecting every item in
tech_stack[] from ALL projects in resume_json.projects[].

  a) Tech stack coverage (iterate per requirement, NOT per project):
     For EACH item in JD_REQUIRED:
       If the item is absent from ALL_PROJECT_STACKS →
         add gaps[], category:"portfolio", priority:"high", requirement_type:"required"
         rationale: "No project demonstrates [item] required by JD"
       Otherwise → no portfolio gap for this item

  b) Competency depth:
     If JD_SENIORITY states "production at scale" / "enterprise" / "5+ years" but all
     matching projects appear to be side projects or lack scale indicators →
     add gaps[], category:"portfolio", priority:"high", requirement_type:"required"
     rationale: "Projects do not demonstrate production-scale experience required by JD"

  c) Portfolio strengths (iterate per project):
     For EACH project in resume_json.projects[]:
       MATCHED = items in project.tech_stack[] that intersect JD_REQUIRED ∪ JD_PREFERRED ∪ JD_KEYWORDS
       If MATCHED is non-empty AND no existing strengths[] entry already has item == project.name:
         → Add to strengths[], category:"portfolio"
           item: project.name
           evidence: "Side project '{project.name}' demonstrates: {MATCHED items joined by ', '}{'; deployed at: ' + project.url if project.url is not null}"

════════════════════════════════════════
PHASE 6 — EXPERIENCE SENIORITY CHECK
════════════════════════════════════════
For EACH requirement in JD_SENIORITY (e.g. "5+ years TypeScript"):
  → Estimate total months across experience[] entries where this skill is mentioned
  → MEETS requirement → strengths[], category:"experience"
  → DOES NOT meet     → gaps[],     category:"experience", priority:"high", requirement_type:"required"
    rationale: "JD requires [N]+ years of [skill]; resume shows approximately [X] years"

════════════════════════════════════════
PHASE 7 — CERTIFICATION CHECK
════════════════════════════════════════
If JD_REQUIRED or JD_PREFERRED mentions certifications:
  → Match against certifications[] in resume
  → Unmatched required cert  → gaps[], category:"certification", priority:"high", requirement_type:"required"
  → Unmatched preferred cert → gaps[], category:"certification", priority:"low",  requirement_type:"preferred"

════════════════════════════════════════
PHASE 8 — SCORING
════════════════════════════════════════
Compute overall_match_score (integer 0–100):
  required_gap_count  = count of gaps[] where requirement_type == "required"
  preferred_gap_count = count of gaps[] where requirement_type == "preferred"
  strength_count      = count of strengths[]
  denominator         = strength_count + (required_gap_count * 2.0) + (preferred_gap_count * 0.5)
  overall_match_score = round(strength_count / max(denominator, 1) * 100)

  Rationale: required gaps penalize 2× because they are disqualifying; preferred gaps penalize 0.5×
  because they are bonus qualifications that do not block candidacy.

════════════════════════════════════════
CRITICAL RULES (never violate)
════════════════════════════════════════
1. A skill present in both the resume AND the JD MUST appear in strengths[]. Never omit confirmed matches.
2. Each gap rationale MUST cite the specific JD requirement that is unmet.
3. Each strength evidence MUST cite the specific resume field(s) (e.g., "skills.languages: TypeScript; confirmed in projects: Checkout Service, Admin Dashboard").
4. Never hallucinate — only report what the data explicitly shows.
5. Produce at least 1 strengths[] item if ANY resume skill appears in the JD.
6. Never add the same gap item twice. Before adding any item to gaps[], check that no existing
   gap[] entry has the same combination of category + item. Deduplication applies across all phases.

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
    { "id": "g1", "category": "skill", "item": "GraphQL", "current_level": null, "required_level": "production experience", "priority": "high", "requirement_type": "required", "rationale": "JD requires GraphQL but it is absent from all resume skill fields and project tech stacks" }
  ],
  "priority_order": ["g1"],
  "overall_match_score": 72,
  "summary": "Strong TypeScript and React base; gaps in GraphQL, system design at scale, and CI/CD ownership"
}
`.trim();

// ─── Locale-aware instruction builder ────────────────────────────────────────
//
// The base INSTRUCTION contains English template rationale text (e.g., "JD requires X but...").
// Models strongly follow system-instruction examples regardless of user-prompt directives.
// Appending the language requirement directly to the system instruction overrides that bias.

// ─── Locale-aware instruction builder ────────────────────────────────────────
//
// Problem: the base INSTRUCTION contains English rationale template strings in Phase 3/5/6
// (e.g. "JD requires [item] but it is absent from all resume skill fields...").
// LLMs treat few-shot examples as the highest-authority signal and reproduce them literally,
// so a trailing language directive alone is not sufficient.
//
// Solution: prepend a language block BEFORE Phase 1 (highest positional authority) AND
// append another after the output format (final-instruction recency effect).
// Both blocks include an explicit rationale rewrite example to break the English template bias.

const LANG_PREFIX: Record<"ko" | "en", string> = {
  ko: `
════════════════════════════════════════
⚠️ OUTPUT LANGUAGE — READ BEFORE ANY ANALYSIS (overrides all examples below)
════════════════════════════════════════
ALL natural-language text you write — including rationale, evidence, and summary fields —
MUST be written in Korean (한국어). This applies regardless of whether the JD or resume is in English.

Technical proper nouns (Python, TypeScript, CI/CD, LangGraph, AWS, etc.) may stay in English.
Every explanatory sentence MUST be in Korean.

Example of CORRECT Korean rationale:
  "JD에서 Python 3년 이상의 경력을 필수로 요구하지만, 이력서의 모든 기술 스택 및 프로젝트에서 Python이 확인되지 않습니다."

Example of WRONG English rationale (DO NOT produce this):
  "JD requires 3+ years of Python experience, but it is absent from all resume skill fields."

`,
  en: `
════════════════════════════════════════
⚠️ OUTPUT LANGUAGE — READ BEFORE ANY ANALYSIS (overrides all examples below)
════════════════════════════════════════
ALL natural-language text (rationale, evidence, summary) MUST be in English.

`,
};

const LANG_SUFFIX: Record<"ko" | "en", string> = {
  ko: `

════════════════════════════════════════
⚠️ FINAL REMINDER — OUTPUT LANGUAGE
════════════════════════════════════════
Every rationale, evidence, and summary string MUST be in Korean (한국어).
The English template strings shown in the phases above are structural guides only —
write the ACTUAL text in Korean.
`,
  en: `

════════════════════════════════════════
⚠️ FINAL REMINDER — OUTPUT LANGUAGE
════════════════════════════════════════
Every rationale, evidence, and summary string MUST be in English.
`,
};

// English rationale template strings present in the base INSTRUCTION.
// For Korean locale these are replaced with Korean equivalents so the model
// cannot fall back to reproducing them literally in English.
const KO_TEMPLATE_REPLACEMENTS: Array<[string, string]> = [
  // Phase 3 — required skill gap
  [
    `rationale: "JD requires [item] but it is absent from all resume skill fields and projects"`,
    `rationale: "[item]은(는) JD 필수 요건이나 이력서의 기술 스택 및 모든 프로젝트에서 확인되지 않습니다"`,
  ],
  // Phase 3 — requirement_type values stay in English (schema enum)
  [
    `priority:"high", requirement_type:"required"`,
    `priority:"high", requirement_type:"required"`,
  ],
  [
    `priority:"medium", requirement_type:"preferred"`,
    `priority:"medium", requirement_type:"preferred"`,
  ],
  // Phase 5a — portfolio gap
  [
    `rationale: "No project demonstrates [item] required by JD"`,
    `rationale: "[item]을(를) 활용한 프로젝트가 이력서에 없습니다"`,
  ],
  // Phase 5b — production-scale gap
  [
    `rationale: "Projects do not demonstrate production-scale experience required by JD"`,
    `rationale: "JD가 요구하는 프로덕션 규모의 경험을 증명하는 프로젝트가 없습니다"`,
  ],
  // Phase 5c — portfolio strength evidence
  [
    `evidence: "Side project '{project.name}' demonstrates: {MATCHED items joined by ', '}{'; deployed at: ' + project.url if project.url is not null}"`,
    `evidence: "사이드 프로젝트 '{project.name}': {MATCHED 항목 나열}{'; 배포 URL: ' + project.url (URL이 있는 경우)}"`,
  ],
  // Phase 6 — seniority gap
  [
    `rationale: "JD requires [N]+ years of [skill]; resume shows approximately [X] years"`,
    `rationale: "JD는 [skill] [N]년 이상을 요구하나, 이력서상 경력은 약 [X]년으로 추정됩니다"`,
  ],
  // OUTPUT FORMAT example — requirement_type + rationale
  [
    `"priority": "high", "requirement_type": "required", "rationale": "JD requires GraphQL but it is absent from all resume skill fields and project tech stacks"`,
    `"priority": "high", "requirement_type": "required", "rationale": "GraphQL은 JD 필수 요건이나 이력서의 모든 기술 스택 및 프로젝트에서 확인되지 않습니다"`,
  ],
  // OUTPUT FORMAT example — summary
  [
    `"summary": "Strong TypeScript and React base; gaps in GraphQL, system design at scale, and CI/CD ownership"`,
    `"summary": "TypeScript와 React 기반이 탄탄하나, GraphQL, 대규모 시스템 설계, CI/CD 소유 경험에 격차가 있습니다"`,
  ],
  // CRITICAL RULES section — evidence example
  [
    `(e.g., "skills.languages: TypeScript; confirmed in projects: Checkout Service, Admin Dashboard")`,
    `(예: "skills.languages: TypeScript; 프로젝트 확인됨: Checkout Service, Admin Dashboard")`,
  ],
];

export function getGapAnalyzerInstruction(locale: "ko" | "en"): string {
  if (locale === "en") {
    return LANG_PREFIX.en + INSTRUCTION + LANG_SUFFIX.en;
  }
  // Replace all English template strings with Korean equivalents before wrapping.
  let instruction = INSTRUCTION;
  for (const [en, ko] of KO_TEMPLATE_REPLACEMENTS) {
    instruction = instruction.replace(en, ko);
  }
  return LANG_PREFIX.ko + instruction + LANG_SUFFIX.ko;
}

// Legacy export kept for any direct consumers of the base instruction
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
