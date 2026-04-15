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
import { GAP_ANALYZER_INSTRUCTION } from "./gap-analyzer/index.js";
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

const MODEL_NAME = "gemini-2.5-flash";

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
    console.log("[CACHE] 이력서 캐시 HIT →", cached.cacheName);
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
              text: `[이력서 데이터 — 이 내용을 분석에 활용하세요]\n${JSON.stringify(resumeJson, null, 2)}`,
            },
          ],
        },
        {
          role: "model",
          parts: [{ text: "이력서 데이터를 확인했습니다. 분석을 시작할 준비가 되었습니다." }],
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

    console.log("[CACHE] 이력서 캐시 생성 완료 →", cache.name);
    return cache.name || null;
  } catch (err: any) {
    if (CACHE_FALLBACK_ON_ERROR) {
      console.warn("[CACHE] 캐시 생성 실패 (캐싱 없이 진행):", err?.message ?? err);
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
}

async function callGemini(opts: CallGeminiOptions): Promise<string | null> {
  const { apiKey, systemInstruction, userPrompt, cachedContentName, maxOutputTokens = 8192 } = opts;
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
          },
        });
      }

      const text = result.response.text();
      const usage = result.response.usageMetadata;
      if (usage) {
        console.log(
          `[GEMINI] 토큰 사용: 입력=${usage.promptTokenCount}, 출력=${usage.candidatesTokenCount}, 캐시=${usage.cachedContentTokenCount ?? 0}`
        );
      }
      return text;
    } catch (err: any) {
      const status: number = err?.status ?? err?.statusCode ?? 0;
      const isRetryable = status === 429 || status >= 500;

      if (isRetryable && attempt < MAX_API_RETRIES - 1) {
        const delay = exponentialDelay(attempt);
        console.warn(
          `[GEMINI] HTTP ${status} — ${Math.round(delay / 1000)}s 후 재시도 (${attempt + 1}/${MAX_API_RETRIES - 1})`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      console.error("[GEMINI] 호출 실패:", err?.message ?? err);
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
    return { valid: false, errors: ["응답이 JSON 객체가 아닙니다"] };
  }
  const d = data as Record<string, unknown>;

  if (!d.target_role || typeof d.target_role !== "string") errors.push("target_role(string) 누락");
  if (!Array.isArray(d.strengths)) errors.push("strengths(array) 누락");
  if (!Array.isArray(d.gaps) || d.gaps.length === 0) errors.push("gaps(array) 비어있음");
  if (!Array.isArray(d.priority_order)) errors.push("priority_order(array) 누락");
  if (
    typeof d.overall_match_score !== "number" ||
    d.overall_match_score < 0 ||
    d.overall_match_score > 100
  ) {
    errors.push("overall_match_score는 0~100 사이 숫자여야 합니다");
  }
  if (!d.summary || typeof d.summary !== "string") errors.push("summary(string) 누락");

  // Check structure of each gap item
  if (Array.isArray(d.gaps)) {
    const VALID_CATEGORIES = new Set(["skill", "experience", "certification", "portfolio", "keyword"]);
    const VALID_PRIORITIES = new Set(["high", "medium", "low"]);
    for (const [i, gap] of (d.gaps as any[]).entries()) {
      if (!gap?.id) errors.push(`gaps[${i}].id 누락`);

      const cat = (gap?.category || "").toLowerCase();
      const hasValidCat = [...VALID_CATEGORIES].some(v => cat.includes(v));
      if (!hasValidCat) errors.push(`gaps[${i}].category 유효하지 않음: ${gap?.category}`);

      const prio = (gap?.priority || "").toLowerCase();
      if (!VALID_PRIORITIES.has(prio)) errors.push(`gaps[${i}].priority 유효하지 않음: ${gap?.priority}`);

      if (!gap?.rationale) errors.push(`gaps[${i}].rationale 누락`);
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
    return { valid: false, errors: ["응답이 JSON 객체가 아닙니다"] };
  }

  // Orchestrator return structure: { ...normalizedPlan, career_plan, gap_analysis }
  const d = data as Record<string, unknown>;
  const raw = (d.career_plan ?? d) as Record<string, unknown>;
  const weeks = (raw.weeks ?? raw.weekly_schedule ?? []) as any[];

  if (!raw.summary) errors.push("summary 누락");
  if (weeks.length === 0) {
    errors.push("weeks 배열이 비어있습니다");
    return { valid: false, errors };
  }
  if (weeks.length < Math.ceil(expectedWeeks * 0.8)) {
    errors.push(`weeks 수 부족: ${weeks.length}개 (최소 ${Math.ceil(expectedWeeks * 0.8)}개 필요)`);
  }

  // Plan Completeness: todos ≥ MIN_TODOS_PER_WEEK (as defined in harness-eval.md)
  for (const [i, w] of weeks.entries()) {
    const todos: unknown[] = w?.todos ?? [];
    if (todos.length < QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK) {
      errors.push(
        `week ${i + 1} todos 부족: ${todos.length}개 (최소 ${QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK}개)`
      );
    }

    // Date Consistency: check date_range format and order
    if (!w?.date_range?.start || !w?.date_range?.end) {
      errors.push(`week ${i + 1} date_range 누락`);
    } else {
      const start = Date.parse(w.date_range.start);
      const end = Date.parse(w.date_range.end);
      if (isNaN(start) || isNaN(end)) {
        errors.push(`week ${i + 1} date_range 날짜 형식 오류`);
      } else if (end < start) {
        errors.push(`week ${i + 1} end(${w.date_range.end}) < start(${w.date_range.start})`);
      } else if (i > 0) {
        const prevEnd = Date.parse(weeks[i - 1]?.date_range?.end ?? "");
        const gapDays = (start - prevEnd) / 86_400_000;
        if (gapDays > QUALITY_THRESHOLDS.DATE_GAP_TOLERANCE_DAYS) {
          errors.push(
            `week ${i} → week ${i + 1} 날짜 불연속 (${Math.round(gapDays)}일 공백)`
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
      console.log(`[QUALITY GATE][${label}] 할당량 회복을 위해 ${waitTime / 1000}초 대기 후 시도 ${attempt + 1} 시작...`);
      await new Promise(r => setTimeout(r, waitTime));
    }

    const retryFeedback =
      attempt === 0
        ? ""
        : `\n\n⚠️ 품질 검증 실패 (이전 시도 오류):\n${lastErrors.map((e) => `- ${e}`).join("\n")}\n참고: "category"는 반드시 {skill, experience, certification, portfolio, keyword} 중 하나여야 하며, "priority"는 반드시 {high, medium, low} 소문자로 출력하세요.`;

    const text = await callFn(retryFeedback);

    if (!text) {
      lastErrors = ["LLM 응답 없음 (API 오류)"];
      console.warn(`[QUALITY GATE][${label}] 시도 ${attempt + 1}: 응답 없음`);
      continue;
    }

    // JSON parsing (Parse Error Rate metric)
    let parsed: unknown;
    try {
      // Remove ```json ... ``` markdown fence
      const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e: any) {
      lastErrors = [`JSON 파싱 실패: ${e.message}`, `응답 미리보기: ${text.slice(0, 200)}`];
      console.warn(`[QUALITY GATE][${label}] 시도 ${attempt + 1}: JSON 파싱 오류`);
      continue;
    }

    // Quality validation (Schema, Plan Completeness, Date Consistency)
    const { valid, errors } = validateFn(parsed);
    if (valid) {
      if (attempt > 0) {
        console.log(`[QUALITY GATE][${label}] ${attempt + 1}회 시도 만에 품질 기준 통과`);
      }
      return parsed as T;
    }

    lastErrors = errors;
    console.warn(`[QUALITY GATE][${label}] 시도 ${attempt + 1}/${MAX_QUALITY_RETRIES + 1} 실패:`, errors);
  }

  throw new Error(
    `[QUALITY GATE][${label}] ${MAX_QUALITY_RETRIES + 1}회 시도 후 품질 기준 미달.\n마지막 오류: ${lastErrors.join(" | ")}`
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
      "커리어 성장을 위한 주차별 플랜입니다.",
    start_date: careerPlanData.start_date || startDate,
    duration_weeks: careerPlanData.duration_weeks || durationWeeks,
    weeks: rawWeeks.map((w: any, idx: number) => ({
      week_number: w.week_number || w.week || idx + 1,
      date_range: w.date_range || { start: startDate, end: startDate },
      theme: w.theme || "학습 및 준비",
      milestone: w.milestone || deepPlan.timeline_milestones?.[idx]?.milestone || null,
      todos: (w.todos || w.action_items || w.learning_objectives || []).map(
        (t: any, tIdx: number) => ({
          id: t.id || `todo_${idx + 1}_${tIdx}`,
          title: typeof t === "string" ? t : t.title || t.item || "태스크",
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
// Resume + JD → gap analysis + career plan
// - Re-analysis of the same resume reduces input tokens via context caching.
// - Each stage output is automatically retried if it fails quality criteria.
// - Progress is forwarded via the onProgress callback for SSE streaming.

export async function runCareerAnalysis(
  resumeJson: ResumeJson,
  jdResults: JdSearchResult[],
  durationWeeks: number,
  startDate: string,
  targetRole: string,
  targetCompany: string,
  onProgress?: (step: string, detail?: string) => void
): Promise<CareerPlanOutput & { gap_analysis: any }> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY 또는 GEMINI_API_KEY가 설정되지 않았습니다.");

  // ── Step 0: Prepare resume cache ─────────────────────────────────────────
  // Strip personal contact info — not needed for analysis, reduces token usage.
  const resumeForAnalysis = omitPersonal(resumeJson);
  onProgress?.("cache", "이력서 컨텍스트 캐시 확인 중...");
  const gapCacheName = await getOrCreateResumeCache(apiKey, GAP_ANALYZER_INSTRUCTION, resumeForAnalysis);

  // ── Step 1: Gap analysis (with quality gate) ─────────────────────────────
  onProgress?.("gap_analysis", "이력서 ↔ JD 갭 분석 중...");
  console.log("[ORCHESTRATOR] Step 1: Gap Analysis 시작...");

  const gapAnalysisData = await runWithQualityGate<any>(
    (retryFeedback) => {
      const prompt = `
아래 목표 기업/직무와 JD 검색 결과, 이력서(캐시에 포함됨)를 비교하여 갭 분석을 수행하세요.
JSON만 출력하세요.

## 사용자가 지정한 목표 (절대 변경 금지)
- target_company: ${targetCompany}
- target_role: ${targetRole}

⚠️ 출력 JSON의 "target_role" 필드는 반드시 위 "${targetRole}" 값을 사용하세요.
⚠️ 갭 분석/강점/약점은 모두 위 목표 기업·직무 맥락에서 판단하세요.
⚠️ 아래 JD 검색 결과가 비어있거나 목표와 무관해 보이더라도, target_role을 임의로 변경하지 마세요.
   대신 일반적으로 알려진 "${targetCompany} ${targetRole}"의 직무 요구사항을 바탕으로 분석하세요.

## 필수 필드:
"target_role"(string), "strengths"(array), "gaps"(array, 반드시 1개 이상),
"priority_order"(array), "overall_match_score"(0~100 number), "summary"(string)

## 유효한 값 제약:
- category: 반드시 {"skill", "experience", "certification", "portfolio", "keyword"} 중 하나여야 함.
- priority: 반드시 {"high", "medium", "low"} 소문자여야 함.

## JD 검색 결과 (${jdResults.length}건):
${jdResults.length > 0 ? JSON.stringify(jdResults, null, 2) : "(검색 결과 없음 — 목표 기업·직무에 대한 일반적 지식을 활용하세요)"}
${retryFeedback}
`.trim();

      return callGemini({
        apiKey,
        systemInstruction: GAP_ANALYZER_INSTRUCTION,
        userPrompt: prompt,
        cachedContentName: gapCacheName,
        maxOutputTokens: 8192,
      });
    },
    validateGapAnalysis,
    "GapAnalysis"
  );

  console.log(
    `[ORCHESTRATOR] Step 1 완료 — match_score=${gapAnalysisData.overall_match_score}, gaps=${gapAnalysisData.gaps?.length}`
  );

  // ── Step 2: Career plan generation (with quality gate) ───────────────────
  onProgress?.("planning", `${durationWeeks}주 커리어 플랜 생성 중...`);
  console.log("[ORCHESTRATOR] Step 2: Career Planning 시작...");

  // Reuse resume cache for plan generation (maximize savings for same resume + different goal)
  const planCacheName = await getOrCreateResumeCache(apiKey, PLANNER_INSTRUCTION, resumeForAnalysis);

  const careerPlanData = await runWithQualityGate<any>(
    (retryFeedback) => {
      const prompt = `
아래 목표 기업/직무 및 갭 분석 결과를 바탕으로 ${durationWeeks}주 커리어 플랜을 JSON만 출력하세요.

## 사용자가 지정한 목표 (절대 변경 금지)
- target_company: ${targetCompany}
- target_role: ${targetRole}

⚠️ 모든 주차별 학습/태스크는 "${targetCompany} ${targetRole}" 지원 준비 맥락에서 설계하세요.

## 필수 구조:
{
  "summary": "플랜 요약",
  "weeks": [
    {
      "week_number": 1,
      "date_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
      "theme": "주차 주제",
      "milestone": "마일스톤 또는 null",
      "todos": [
        { "id": "t1", "title": "할일", "description": "설명", "category": "skill",
          "priority": "high", "estimated_hours": 2, "done": false, "resources": [] }
      ]
    }
  ],
  "timeline": { "milestones": [], "gantt_rows": [] }
}

⚠️ 매 주차 todos는 최소 ${QUALITY_THRESHOLDS.MIN_TODOS_PER_WEEK}개 이상이어야 합니다.
⚠️ date_range는 YYYY-MM-DD 형식이며 주차 간 날짜가 연속되어야 합니다.

## 갭 분석 결과:
${JSON.stringify(gapAnalysisData, null, 2)}

시작일: ${startDate} / 기간: ${durationWeeks}주
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
    `[ORCHESTRATOR] Step 2 완료 — weeks=${careerPlanData.weeks?.length ?? careerPlanData.career_plan?.weeks?.length}`
  );

  onProgress?.("done", "분석 완료");

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
