import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAICacheManager } from "@google/generative-ai/server";
import { createHash } from "crypto";
import {
  Runner,
  InMemorySessionService,
  isFinalResponse,
  stringifyContent,
} from "@google/adk";
import { ChatQnAAgent } from "./chat-qna/index.js";
import { getGapAnalyzerInstruction } from "./gap-analyzer/index.js";
import { PLANNER_INSTRUCTION } from "./planner/index.js";
import {
  SESSION_KEYS,
  ResumeJson,
  JdSearchResult,
  CareerPlanOutput,
  ChatQnAOutput,
  omitPersonal,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_NAME = "gemini-3.1-flash-lite-preview";

/** Applies the same thresholds as harness-eval.md at runtime */
const QUALITY_THRESHOLDS = {
  MIN_TODOS_PER_WEEK: 3,       // Plan Completeness ≥ 90%
  DATE_GAP_TOLERANCE_DAYS: 2,  // Date Consistency 100%
};

/** Max retry attempts when quality criteria are not met (total attempts = 1 + MAX_QUALITY_RETRIES) */
const MAX_QUALITY_RETRIES = 2;

/** Max retry attempts for API 429/5xx errors */
const MAX_API_RETRIES = 3;

/** Context cache TTL in seconds. Reuses the cache for re-analysis requests with the same resume. */
const CACHE_TTL_SECONDS = 3600; // 1 hour

/** Silently ignores cache creation failures (e.g., insufficient token count) and proceeds without caching */
const CACHE_FALLBACK_ON_ERROR = true;

// ── Context cache registry ────────────────────────────────────────────────────
// Key: SHA-256(systemInstruction + resumeJson)
// Value: { cacheName, expiresAt }
// Avoids re-billing input tokens when the same resume is re-analyzed.

const cacheRegistry = new Map<string, { cacheName: string; expiresAt: number }>();

function hashResume(systemInstruction: string, resumeJson: unknown): string {
  return createHash("sha256")
    .update(systemInstruction + JSON.stringify(resumeJson))
    .digest("hex")
    .slice(0, 32);
}

async function getOrCreateResumeCache(
  apiKey: string,
  systemInstruction: string,
  resumeJson: unknown
): Promise<string | null> {
  const key = hashResume(systemInstruction, resumeJson);
  const now = Date.now();
  const cached = cacheRegistry.get(key);

  if (cached && cached.expiresAt > now) {
    console.log("[CACHE] Resume cache HIT →", cached.cacheName);
    return cached.cacheName;
  }

  try {
    const cacheManager = new GoogleAICacheManager(apiKey);
    const cache = await cacheManager.create({
      model: MODEL_NAME,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `[Resume data — use this for analysis]\n${JSON.stringify(resumeJson, null, 2)}`,
            },
          ],
        },
        {
          role: "model",
          parts: [{ text: "Resume data confirmed. Ready to begin analysis." }],
        },
      ],
      systemInstruction: systemInstruction,
      ttlSeconds: CACHE_TTL_SECONDS,
      displayName: `resume-${key.slice(0, 8)}`,
    });

    cacheRegistry.set(key, {
      cacheName: cache.name!,
      expiresAt: now + (CACHE_TTL_SECONDS - 60) * 1000, // 60-second buffer
    });

    console.log("[CACHE] Resume cache created →", cache.name);
    return cache.name || null;
  } catch (err: any) {
    if (CACHE_FALLBACK_ON_ERROR) {
      console.warn("[CACHE] Cache creation failed (proceeding without cache):", err?.message ?? err);
      return null;
    }
    throw err;
  }
}

// ── Exponential backoff ───────────────────────────────────────────────────────

function exponentialDelay(attempt: number, baseMs = 2000, maxMs = 60_000): number {
  // 2^attempt * baseMs + jitter (0~1000ms)
  const delay = Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 1000, maxMs);
  return delay;
}

// ── Gemini SDK call (API retry + response extraction) ─────────────────────────

interface CallGeminiOptions {
  apiKey: string;
  systemInstruction: string;
  userPrompt: string;
  cachedContentName?: string | null;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
}

async function callGemini(opts: CallGeminiOptions): Promise<string | null> {
  const {
    apiKey,
    systemInstruction,
    userPrompt,
    cachedContentName,
    maxOutputTokens = 8192,
    // Low temperature: prevents the model from dropping confirmed skill matches.
    // topP 0.85: retains semantic flexibility for abbreviation/synonym matching.
    temperature = 0.2,
    topP = 0.85,
  } = opts;
  const genai = new GoogleGenerativeAI(apiKey);

  for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
    try {
      let result: any;

      if (cachedContentName) {
        // With a cache, systemInstruction is included in the cache and can be omitted
        const model = genai.getGenerativeModel({ model: MODEL_NAME });
        result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          cachedContent: cachedContentName,
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens,
            temperature,
            topP,
          },
        } as any);
      } else {
        const model = genai.getGenerativeModel({
          model: MODEL_NAME,
          systemInstruction,
        });
        result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens,
            temperature,
            topP,
          },
        });
      }

      const text = result.response.text();
      const usage = result.response.usageMetadata;
      if (usage) {
        console.log(
          `[GEMINI] Token usage: input=${usage.promptTokenCount}, output=${usage.candidatesTokenCount}, cache=${usage.cachedContentTokenCount ?? 0}`
        );
      }
      return text;
    } catch (err: any) {
      const status: number = err?.status ?? err?.statusCode ?? 0;
      const isRetryable = status === 429 || status >= 500;

      if (isRetryable && attempt < MAX_API_RETRIES - 1) {
        const delay = exponentialDelay(attempt);
        console.warn(
          `[GEMINI] HTTP ${status} — retrying in ${Math.round(delay / 1000)}s (${attempt + 1}/${MAX_API_RETRIES - 1})`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      console.error("[GEMINI] Call failed:", err?.message ?? err);
      return null;
    }
  }
  return null;
}

// ── Quality validator ─────────────────────────────────────────────────────────
// Applies the same thresholds from harness-eval.md (Schema Compliance, Plan Completeness,
// Date Consistency) at runtime. The agent retries when criteria are not met.

function validateGapAnalysis(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Response is not a JSON object"] };
  }
  const d = data as Record<string, unknown>;

  if (!d.target_role || typeof d.target_role !== "string") errors.push("target_role(string) missing");
  if (!Array.isArray(d.strengths)) errors.push("strengths(array) missing");
  if (!Array.isArray(d.gaps) || d.gaps.length === 0) errors.push("gaps(array) empty or missing");
  if (!Array.isArray(d.priority_order)) errors.push("priority_order(array) missing");
  if (
    typeof d.overall_match_score !== "number" ||
    d.overall_match_score < 0 ||
    d.overall_match_score > 100
  ) {
    errors.push("overall_match_score must be a number between 0 and 100");
  }
  if (!d.summary || typeof d.summary !== "string") errors.push("summary(string) missing");

  // Check structure of each gap item
  if (Array.isArray(d.gaps)) {
    const VALID_CATEGORIES = new Set(["skill", "experience", "certification", "portfolio", "keyword"]);
    const VALID_PRIORITIES = new Set(["high", "medium", "low"]);
    for (const [i, gap] of (d.gaps as any[]).entries()) {
      if (!gap?.id) errors.push(`gaps[${i}].id missing`);

      const cat = (gap?.category || "").toLowerCase();
      const hasValidCat = [...VALID_CATEGORIES].some(v => cat.includes(v));
      if (!hasValidCat) errors.push(`gaps[${i}].category invalid: ${gap?.category}`);

      const prio = (gap?.priority || "").toLowerCase();
      if (!VALID_PRIORITIES.has(prio)) errors.push(`gaps[${i}].priority invalid: ${gap?.priority}`);

      if (!gap?.rationale) errors.push(`gaps[${i}].rationale missing`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateCareerPlan(
  data: unknown,
  expectedWeeks: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Response is not a JSON object"] };
  }

  // Orchestrator return structure: { ...normalizedPlan, career_plan, gap_analysis }
  const d = data as Record<string, unknown>;
  const raw = (d.career_plan ?? d) as Record<string, unknown>;
  const weeks = (raw.weeks ?? raw.weekly_schedule ?? []) as any[];

  if (!raw.summary) errors.push("summary missing");
  if (weeks.length === 0) {
    errors.push("weeks array is empty");
    return { valid: false, errors };
  }
  if (weeks.length < Math.ceil(expectedWeeks * 0.8)) {
    errors.push(`weeks count insufficient: ${weeks.length} (minimum ${Math.ceil(expectedWeeks * 0.8)} required)`);
  }

  // Plan Completeness: todos ≥ MIN_TODOS_PER_WEEK (as defined in harness-eval.md)
  for (const [i, w] of weeks.entries()) {
    const todos: unknown[] = w?.todos ?? [];
    if (todos.length < QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK) {
      errors.push(
        `week ${i + 1} todos insufficient: ${todos.length} (minimum ${QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK})`
      );
    }

    // Date Consistency: check date_range format and order
    if (!w?.date_range?.start || !w?.date_range?.end) {
      errors.push(`week ${i + 1} date_range missing`);
    } else {
      const start = Date.parse(w.date_range.start);
      const end = Date.parse(w.date_range.end);
      if (isNaN(start) || isNaN(end)) {
        errors.push(`week ${i + 1} date_range format invalid`);
      } else if (end < start) {
        errors.push(`week ${i + 1} end(${w.date_range.end}) < start(${w.date_range.start})`);
      } else if (i > 0) {
        const prevEnd = Date.parse(weeks[i - 1]?.date_range?.end ?? "");
        const gapDays = (start - prevEnd) / 86_400_000;
        if (gapDays > QUALITY_THRESHOLDS.DATE_GAP_TOLERANCE_DAYS) {
          errors.push(
            `week ${i} → week ${i + 1} date discontinuity (${Math.round(gapDays)}-day gap)`
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Quality gate retry loop ───────────────────────────────────────────────────
// Re-runs the agent until harness-eval.md thresholds are satisfied.
// On retry, the previous error list is injected into the prompt to guide self-correction.

async function runWithQualityGate<T>(
  callFn: (retryFeedback: string) => Promise<string | null>,
  validateFn: (parsed: unknown) => { valid: boolean; errors: string[] },
  label: string
): Promise<T> {
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= MAX_QUALITY_RETRIES; attempt++) {
    if (attempt > 0) {
      const waitTime = 5000;
      console.log(`[QUALITY GATE][${label}] Waiting ${waitTime / 1000}s before attempt ${attempt + 1}...`);
      await new Promise(r => setTimeout(r, waitTime));
    }

    const retryFeedback =
      attempt === 0
        ? ""
        : `\n\n⚠️ Quality validation failed (errors from previous attempt):\n${lastErrors.map((e) => `- ${e}`).join("\n")}\nNote: "category" must be one of {skill, experience, certification, portfolio, keyword}, and "priority" must be one of {high, medium, low} in lowercase.`;

    const text = await callFn(retryFeedback);

    if (!text) {
      lastErrors = ["No LLM response (API error)"];
      console.warn(`[QUALITY GATE][${label}] Attempt ${attempt + 1}: no response`);
      continue;
    }

    // JSON parsing (Parse Error Rate metric)
    let parsed: unknown;
    try {
      // Remove ```json ... ``` markdown fence
      const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      lastErrors = [`JSON parse failed: ${e.message}`, `Response preview: ${text.slice(0, 200)}`];
      console.warn(`[QUALITY GATE][${label}] Attempt ${attempt + 1}: JSON parse error`);
      continue;
    }

    // Quality validation (Schema, Plan Completeness, Date Consistency)
    const { valid, errors } = validateFn(parsed);
    if (valid) {
      if (attempt > 0) {
        console.log(`[QUALITY GATE][${label}] Passed quality check on attempt ${attempt + 1}`);
      }
      return parsed as T;
    }

    lastErrors = errors;
    console.warn(`[QUALITY GATE][${label}] Attempt ${attempt + 1}/${MAX_QUALITY_RETRIES + 1} failed:`, errors);
  }

  throw new Error(
    `[QUALITY GATE][${label}] Quality criteria not met after ${MAX_QUALITY_RETRIES + 1} attempts.\nLast errors: ${lastErrors.join(" | ")}`
  );
}

// ── Response normalization ────────────────────────────────────────────────────

function normalizePlan(
  careerPlanData: any,
  gapAnalysisData: any,
  durationWeeks: number,
  startDate: string
): CareerPlanOutput & { gap_analysis: any } {
  const rawPlan = careerPlanData.career_plan || careerPlanData;
  const deepPlan = rawPlan.career_plan || rawPlan;
  const rawWeeks = deepPlan.weeks || deepPlan.weekly_schedule || deepPlan.weekly_plan || [];

  const normalized: any = {
    plan_id: careerPlanData.plan_id || `plan_${Date.now()}`,
    created_at: careerPlanData.created_at || new Date().toISOString(),
    summary:
      deepPlan.summary ||
      deepPlan.plan_overview?.primary_objective ||
      "Weekly career growth plan.",
    start_date: careerPlanData.start_date || startDate,
    duration_weeks: careerPlanData.duration_weeks || durationWeeks,
    weeks: rawWeeks.map((w: any, idx: number) => ({
      week_number: w.week_number || w.week || idx + 1,
      date_range: w.date_range || { start: startDate, end: startDate },
      theme: w.theme || "Learning & Preparation",
      milestone: w.milestone || deepPlan.timeline_milestones?.[idx]?.milestone || null,
      todos: (w.todos || w.action_items || w.learning_objectives || []).map(
        (t: any, tIdx: number) => ({
          id: t.id || `todo_${idx + 1}_${tIdx}`,
          title: typeof t === "string" ? t : t.title || t.item || "Task",
          description: t.description || null,
          category: t.category || "skill",
          priority: t.priority || "medium",
          estimated_hours: t.estimated_hours || 2,
          done: t.done ?? false,
          resources: t.resources || [],
        })
      ),
    })),
    timeline: deepPlan.timeline || {
      milestones: (deepPlan.timeline_milestones || []).map((m: any, i: number) => ({
        week: i + 1,
        date: m.target_date || "",
        label: m.milestone || "",
      })),
      gantt_rows: [],
    },
    end_date: "",
    gap_analysis: gapAnalysisData,
  };

  if (normalized.weeks.length > 0) {
    normalized.end_date = normalized.weeks[normalized.weeks.length - 1].date_range.end;
  }

  return normalized;
}

// ── runCareerAnalysis ─────────────────────────────────────────────────────────
// Resume + raw JD text → gap analysis + career plan
// - Re-analysis of the same resume reduces input tokens via context caching.
// - Each stage output is automatically retried if it fails quality criteria.
// - Career trend reference documents from Vector DB supplement the planning step.
// - Progress is forwarded via the onProgress callback for SSE streaming.

export async function runCareerAnalysis(
  resumeJson: ResumeJson,
  jdText: string,
  referenceResults: JdSearchResult[],
  durationWeeks: number,
  startDate: string,
  targetRole: string,
  targetCompany: string,
  onProgress?: (step: string, detail?: string) => void,
  locale?: "ko" | "en"
): Promise<CareerPlanOutput & { gap_analysis: any }> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set.");

  // Declared as a leading directive so it appears before the JD text in every prompt.
  // Placing it after the JD risks the model matching the JD's language instead of the user's.
  const langDirective =
    locale === "en"
      ? "⚠️ OUTPUT LANGUAGE REQUIREMENT: You MUST write ALL natural-language text fields (rationale, summary, evidence, theme, milestone, todo titles/descriptions) in English regardless of the language of the Job Description or resume."
      : "⚠️ 출력 언어 요구사항: JD나 이력서의 언어에 관계없이, 모든 자연어 텍스트 필드(rationale, summary, evidence, theme, milestone, todo 제목/설명)를 반드시 한국어로 작성하세요.";

  // ── Step 0: Prepare resume cache ─────────────────────────────────────────
  // Strip personal contact info — not needed for analysis, reduces token usage.
  const resumeForAnalysis = omitPersonal(resumeJson);
  // Build locale-aware gap analyzer instruction so the language requirement is in the system
  // instruction itself — models follow system-instruction examples more strongly than user-prompt directives.
  const gapInstruction = getGapAnalyzerInstruction(locale ?? "ko");
  onProgress?.("cache");
  const gapCacheName = await getOrCreateResumeCache(apiKey, gapInstruction, resumeForAnalysis);

  // ── Step 1: Gap analysis (with quality gate) ─────────────────────────────
  // Uses the user-provided raw JD text directly for precise gap identification.
  onProgress?.("gap_analysis");
  console.log("[ORCHESTRATOR] Step 1: Gap Analysis started...");

  const gapAnalysisData = await runWithQualityGate<any>(
    (retryFeedback) => {
      // When no cache is available, include the full resume JSON inline so the model
      // always has the data it needs. With a cache, the resume is already in context.
      const resumeSection = gapCacheName
        ? "(Resume JSON is included in the context cache above — use it for all phase comparisons.)"
        : `## Resume JSON (use this for all phase comparisons):
${JSON.stringify(resumeForAnalysis, null, 2)}`;

      const prompt = `
${langDirective}

Follow ALL 8 phases in your instruction exactly. Work through each phase in order.
Do NOT skip Phase 3 (Skill-Level Matching) — iterate over EVERY item in JD_REQUIRED and JD_PREFERRED.
Output JSON only — no markdown, no prose.

## User-Specified Target (do NOT change)
- target_company: ${targetCompany}
- target_role: ${targetRole}

⚠️ The "target_role" field in the output JSON MUST be "${targetRole}".
⚠️ Evaluate ALL strengths and gaps in the context of the above target company/role.
⚠️ A skill that appears in BOTH the resume AND the JD MUST be listed in strengths[]. Never omit confirmed matches.

## Required output fields:
"target_role"(string), "strengths"(array), "gaps"(array, ≥1 item),
"priority_order"(array), "overall_match_score"(0–100 integer), "summary"(string)

## Valid value constraints:
- category: exactly one of {"skill", "experience", "certification", "portfolio", "keyword"}
- priority: exactly one of {"high", "medium", "low"} in lowercase

${resumeSection}

## Job Description:
${jdText}
${retryFeedback}
`.trim();

      return callGemini({
        apiKey,
        systemInstruction: gapInstruction,
        userPrompt: prompt,
        cachedContentName: gapCacheName,
        maxOutputTokens: 8192,
        temperature: 0.2,
        topP: 0.85,
      });
    },
    validateGapAnalysis,
    "GapAnalysis"
  );

  console.log(
    `[ORCHESTRATOR] Step 1 complete — match_score=${gapAnalysisData.overall_match_score}, gaps=${gapAnalysisData.gaps?.length}`
  );

  // ── Step 2: Career plan generation (with quality gate) ───────────────────
  // Uses gap analysis results + career trend reference documents from Vector DB.
  onProgress?.("planning");
  console.log("[ORCHESTRATOR] Step 2: Career Planning started...");

  // Reuse resume cache for plan generation (maximize savings for same resume + different goal)
  const planCacheName = await getOrCreateResumeCache(apiKey, PLANNER_INSTRUCTION, resumeForAnalysis);

  const careerPlanData = await runWithQualityGate<any>(
    (retryFeedback) => {
      const prompt = `
${langDirective}

Based on the target company/role, gap analysis, and career trend context below, output a ${durationWeeks}-week career plan as JSON only.

## User-Specified Target (do NOT change)
- target_company: ${targetCompany}
- target_role: ${targetRole}

⚠️ All weekly learning tasks must be designed in the context of preparing for "${targetCompany} ${targetRole}".

## Required structure:
{
  "summary": "plan summary",
  "weeks": [
    {
      "week_number": 1,
      "date_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
      "theme": "weekly theme",
      "milestone": "milestone or null",
      "todos": [
        { "id": "t1", "title": "task", "description": "description", "category": "skill",
          "priority": "high", "estimated_hours": 2, "done": false, "resources": [] }
      ]
    }
  ],
  "timeline": { "milestones": [], "gantt_rows": [] }
}

⚠️ Each week MUST have at least ${QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK} todos.
⚠️ date_range must be in YYYY-MM-DD format and dates must be consecutive across weeks.

## Gap Analysis Results:
${JSON.stringify(gapAnalysisData, null, 2)}

## Industry & Career Trend Context (supplementary reference):
${
  referenceResults.length > 0
    ? JSON.stringify(referenceResults, null, 2)
    : "(No reference data available — rely on general knowledge for career trends)"
}

Start date: ${startDate} / Duration: ${durationWeeks} weeks
${retryFeedback}
`.trim();

      return callGemini({
        apiKey,
        systemInstruction: PLANNER_INSTRUCTION,
        userPrompt: prompt,
        cachedContentName: planCacheName,
        maxOutputTokens: 16384,
      });
    },
    (parsed) => validateCareerPlan(parsed, durationWeeks),
    "CareerPlan"
  );

  console.log(
    `[ORCHESTRATOR] Step 2 complete — weeks=${careerPlanData.weeks?.length ?? careerPlanData.career_plan?.weeks?.length}`
  );

  onProgress?.("done");

  return normalizePlan(careerPlanData, gapAnalysisData, durationWeeks, startDate);
}

// ── runChatQnA ────────────────────────────────────────────────────────────────

export async function runChatQnA(
  sessionContext: {
    resume_json?: ResumeJson;
    gap_analysis?: unknown;
    career_plan?: CareerPlanOutput;
    chat_history?: unknown[];
  },
  userMessage: string
): Promise<ChatQnAOutput> {
  const sessionService = new InMemorySessionService();
  const runner = new Runner({
    appName: "readmycareer",
    agent: ChatQnAAgent,
    sessionService,
  });

  const session = await sessionService.createSession({
    appName: "readmycareer",
    userId: "user",
    state: {
      [SESSION_KEYS.RESUME_JSON]: sessionContext.resume_json ?? null,
      [SESSION_KEYS.GAP_ANALYSIS]: sessionContext.gap_analysis ?? null,
      [SESSION_KEYS.CAREER_PLAN]: sessionContext.career_plan ?? null,
      [SESSION_KEYS.CHAT_HISTORY]: sessionContext.chat_history ?? [],
    },
  });

  let lastText: string | null = null;

  for await (const event of runner.runAsync({
    sessionId: session.id,
    userId: "user",
    newMessage: { parts: [{ text: userMessage }] },
  })) {
    if (isFinalResponse(event)) {
      lastText = stringifyContent(event);
    }
  }

  if (lastText) {
    try {
      return JSON.parse(lastText) as ChatQnAOutput;
    } catch {
      // Wrap plain text responses that are not valid JSON
      return {
        answer: lastText,
        sources: [],
        follow_up_suggestions: [],
        updated_chat_history: [],
      };
    }
  }

  const finalSession = await sessionService.getSession({
    appName: "readmycareer",
    sessionId: session.id,
    userId: "user",
  });

  return (finalSession?.state?.[SESSION_KEYS.CHAT_HISTORY] ?? {}) as ChatQnAOutput;
}
