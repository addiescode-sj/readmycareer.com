// ─── ResumeOptimizerAgent ─────────────────────────────────────────────────────
// Synthesizes an ATS-optimized resume from gap analysis + completed todos.
// Calls Gemini directly (no MCP subprocess) so it works in any Node.js runtime,
// including Vercel serverless functions.

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  OptimizedResumeInput,
  OptimizedResumeOutput,
  OptimizedResumeData,
} from "../types.js";

const MODEL_NAME = "gemini-3.1-flash-lite-preview";
const MAX_RETRIES = 2;

// ── Keyword extractor ─────────────────────────────────────────────────────────

function extractKeywords(input: OptimizedResumeInput): { required: string[]; preferred: string[] } {
  const isRequired = (g: typeof input.gap_analysis.gaps[number]) =>
    g.requirement_type === "required" || (!g.requirement_type && g.priority === "high");

  const requiredGaps = input.gap_analysis.gaps.filter(isRequired).map(g => g.item);
  const preferredGaps = input.gap_analysis.gaps.filter(g => !isRequired(g)).map(g => g.item);
  const fromStrengths = input.gap_analysis.strengths.map(s => s.item);

  const dedup = (items: string[], seen: Set<string>): string[] => {
    const result: string[] = [];
    for (const kw of items) {
      const norm = kw.trim().toLowerCase();
      if (!seen.has(norm)) { seen.add(norm); result.push(kw.trim()); }
    }
    return result;
  };

  const seen = new Set<string>();
  return {
    required: dedup(requiredGaps, seen).slice(0, 12),
    preferred: dedup([...preferredGaps, ...fromStrengths], seen).slice(0, 8),
  };
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystemInstruction(language: "ko" | "en"): string {
  if (language === "ko") {
    return `당신은 ATS(Applicant Tracking System) 최적화 전문가입니다. 제공된 이력서 데이터와 JD 키워드를 바탕으로 타겟 직무에 최적화된 이력서를 생성합니다.

규칙:
- 모든 자연어 텍스트는 한국어로 작성하세요.
- 테이블 형식 금지. 불렛포인트만 사용하세요.
- 하이라이트는 최대 5개, 강인한 동사로 시작하는 간결한 문장으로 작성하세요.
- 커버레터는 5-6문장의 단일 단락으로 작성하세요.
- 반드시 JSON 형식으로만 출력하세요. 마크다운 코드 블록 없이.

CRITICAL — 날짜 무결성:
- experience[].period.start/end, education[].period.start/end, awards_and_certs[].date 는 입력값을 한 글자도 수정하지 말고 그대로 복사하세요.
- 날짜를 추측하거나 변경하거나 생략하지 마세요. null인 경우 null로 유지하세요.
- experience 섹션은 반드시 포함하세요. 입력에 경력이 없는 경우에만 빈 배열 []을 사용하세요.`;
  }
  return `You are an ATS (Applicant Tracking System) optimization expert. Generate a job-targeted resume from the provided resume data and JD keywords.

Rules:
- Write all natural-language text in English.
- No tables. Use bullet points only.
- Highlights: max 5 items, concise statements starting with strong action verbs.
- Cover letter: a single paragraph of 5-6 sentences.
- Output JSON only. No markdown code blocks.

CRITICAL — Date fidelity:
- Copy experience[].period.start/end, education[].period.start/end, and awards_and_certs[].date EXACTLY from the input. Do NOT modify, infer, or hallucinate any date values.
- If a date is null in the input, output null. Never substitute a different date.
- The experience section MUST be included. Use an empty array [] only if the input has no experience entries.`;
}

function buildUserPrompt(input: OptimizedResumeInput, requiredKeywords: string[], preferredKeywords: string[]): string {
  const { resume_json, gap_analysis, completed_todos, target_jd, locale } = input;
  const language = locale;

  const allSkills = [
    ...resume_json.skills.languages,
    ...resume_json.skills.frameworks,
    ...resume_json.skills.tools,
    ...resume_json.skills.others,
  ];

  const experienceText = resume_json.experience
    .map(e => `${e.title} at ${e.company} (${e.period.start}–${e.period.end ?? "present"}): ${e.achievements.join("; ")}`)
    .join("\n");

  const projectsText = resume_json.projects
    .map(p => `${p.name} [${p.tech_stack.join(", ")}]${p.url ? ` (${p.url})` : ""}${p.role ? ` | ${p.role}` : ""}: ${p.achievements.join("; ")}`)
    .join("\n");

  const educationText = resume_json.education
    .map(e => {
      const degree = [e.degree, e.major].filter(Boolean).join(", ");
      const period = `${e.period.start}–${e.period.end ?? "present"}`;
      return `- ${e.institution} | ${degree || "N/A"} | Period: ${period}${e.gpa ? ` | GPA: ${e.gpa}` : ""}`;
    })
    .join("\n");

  const certificationsText = resume_json.certifications
    .map(c => `- ${c.name} | Issuer: ${c.issuer ?? "N/A"} | Date: ${c.date ?? "N/A"}`)
    .join("\n");

  const completedActivities = completed_todos.map(t => {
    const hours = t.estimated_hours ? ` (${t.estimated_hours}h)` : "";
    return `${t.title}${hours}`;
  });

  return `
Generate an optimized resume JSON for the following candidate.

## Target Role
Title: ${target_jd.title}
Company: ${target_jd.company ?? "Not specified"}
Required Keywords (MUST appear in highlights/skills): ${requiredKeywords.length > 0 ? requiredKeywords.join(", ") : "general"}
Preferred Keywords (include where natural): ${preferredKeywords.length > 0 ? preferredKeywords.join(", ") : "none"}

## Resume Data
Name: ${resume_json.personal.name ?? "N/A"}
Email: ${resume_json.personal.email ?? "N/A"}
Phone: ${resume_json.personal.phone ?? "N/A"}
Links: ${resume_json.personal.links.join(", ") || "N/A"}

Skills: ${allSkills.join(", ")}

Work Experience (copy period.start/end EXACTLY — no changes allowed):
${experienceText || "N/A"}

Projects:
${projectsText || "N/A"}

Education (copy period.start/end EXACTLY — no changes allowed):
${educationText || "N/A"}

Certifications & Awards (copy date EXACTLY — no changes allowed):
${certificationsText || "N/A"}

## Completed Career Activities (show growth)
${completedActivities.length > 0 ? completedActivities.join("\n") : "N/A"}

## Gap Summary
${gap_analysis.summary || "N/A"}

## Output JSON Schema
{
  "resume_data": {
    "personal": { "name": string|null, "job_title": string, "links": string[], "email": string|null, "phone": string|null },
    "highlights": string[],
    "skills": string[],
    "experience": [{ "company": string, "title": string, "period": {"start": string, "end": string|null}, "achievements": string[] }],
    "projects": [{ "name": string, "achievements": string[] }],
    "education": [{ "institution": string, "degree": string|null, "major": string|null, "period": {"start": string, "end": string|null}, "gpa": string|null }],
    "awards_and_certs": [{ "name": string, "issuer": string|null, "date": string|null }],
    "cover_letter": string
  },
  "markdown": string,
  "meta": {
    "generated_at": string,
    "language": "${language}",
    "keywords_applied": string[]
  }
}

IMPORTANT:
- highlights must be ≥3 and ≤5 items
- cover_letter must be 5-6 sentences in a single paragraph
- experience[].period.start/end: copy byte-for-byte from "Work Experience" input above
- projects[].achievements: rewrite each bullet in the output language (${language}); keep projects[].name identical to the input project name
- education[].period.start/end: copy byte-for-byte from "Education" input above
- awards_and_certs[].date: copy byte-for-byte from "Certifications & Awards" input above (null if listed as N/A)
- markdown must render in this exact order: personal info, highlights, skills, experience, projects, education, awards_and_certs, cover_letter
- Output JSON only, no markdown fences
`.trim();
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(data: OptimizedResumeData, language: "ko" | "en"): string {
  const { personal, highlights, skills, experience, projects, education, awards_and_certs, cover_letter } = data;
  const sections: string[] = [];

  sections.push(`# ${personal.name ?? (language === "ko" ? "이름" : "Name")}`);
  sections.push(`**${personal.job_title}**`);
  const contactParts: string[] = [];
  if (personal.email) contactParts.push(personal.email);
  if (personal.phone) contactParts.push(personal.phone);
  if (personal.links.length > 0) contactParts.push(...personal.links);
  if (contactParts.length > 0) sections.push(contactParts.join("  |  "));
  sections.push("");

  sections.push(language === "ko" ? "## 핵심 성과 및 강점" : "## Key Highlights");
  for (const h of highlights) sections.push(`- ${h}`);
  sections.push("");

  sections.push(language === "ko" ? "## 주요 기술" : "## Key Skills");
  sections.push(skills.join("  ·  "));
  sections.push("");

  if (experience && experience.length > 0) {
    sections.push(language === "ko" ? "## 경력사항" : "## Work Experience");
    for (const e of experience) {
      const period = `${e.period.start}${e.period.end ? ` – ${e.period.end}` : " – present"}`;
      sections.push(`### ${e.title} @ ${e.company}  (${period})`);
      for (const a of e.achievements) sections.push(`- ${a}`);
      sections.push("");
    }
  }

  if (projects && projects.length > 0) {
    sections.push(language === "ko" ? "## 프로젝트" : "## Projects");
    for (const p of projects) {
      const periodStr = p.period
        ? `${p.period.start}${p.period.end ? ` – ${p.period.end}` : ""}`
        : null;
      const metaParts: string[] = [];
      if (p.role) metaParts.push(p.role);
      if (p.tech_stack.length > 0) metaParts.push(p.tech_stack.join(", "));
      sections.push(`### ${p.name}${periodStr ? `  (${periodStr})` : ""}`);
      if (metaParts.length > 0) sections.push(`*${metaParts.join("  |  ")}*`);
      if (p.url) sections.push(`[${language === "ko" ? "프로젝트 링크" : "Project Link"}](${p.url})`);
      for (const a of p.achievements) sections.push(`- ${a}`);
      sections.push("");
    }
  }

  sections.push(language === "ko" ? "## 학력" : "## Education");
  for (const e of education) {
    const degree = [e.degree, e.major].filter(Boolean).join(", ");
    const period = `${e.period.start}${e.period.end ? ` – ${e.period.end}` : ""}`;
    sections.push(`- **${e.institution}** — ${degree} (${period})${e.gpa ? `, GPA ${e.gpa}` : ""}`);
  }
  sections.push("");

  if (awards_and_certs.length > 0) {
    sections.push(language === "ko" ? "## 수상 내역 및 자격증" : "## Awards & Certifications");
    for (const c of awards_and_certs) {
      const issuerPart = c.issuer ? ` — ${c.issuer}` : "";
      const datePart = c.date ? ` (${c.date})` : "";
      sections.push(`- ${c.name}${issuerPart}${datePart}`);
    }
    sections.push("");
  }

  sections.push(language === "ko" ? "## 지원 동기" : "## Cover Letter");
  sections.push(cover_letter);

  return sections.join("\n");
}

// ── Core generation (direct Gemini call) ──────────────────────────────────────

async function generateResumeDirect(input: OptimizedResumeInput): Promise<OptimizedResumeOutput> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set.");

  const { required: requiredKeywords, preferred: preferredKeywords } = extractKeywords(input);
  const language = input.locale;
  const systemInstruction = buildSystemInstruction(language);
  const userPrompt = buildUserPrompt(input, requiredKeywords, preferredKeywords);

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: MODEL_NAME, systemInstruction });

  let lastError = "";

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          temperature: 0.3,
          topP: 0.9,
        },
      });

      const text = result.response.text();
      const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      const parsed = JSON.parse(cleaned) as OptimizedResumeOutput;

      if (!parsed.resume_data?.highlights || parsed.resume_data.highlights.length < 3) {
        lastError = `highlights count insufficient: ${parsed.resume_data?.highlights?.length ?? 0}`;
        continue;
      }
      if (!parsed.resume_data?.cover_letter || parsed.resume_data.cover_letter.trim().length < 50) {
        lastError = "cover_letter too short or missing";
        continue;
      }
      if (!Array.isArray(parsed.resume_data?.experience)) {
        lastError = "experience section missing from output";
        continue;
      }

      // Date hardening: overwrite LLM-generated dates with exact input values
      parsed.resume_data.experience = input.resume_json.experience.map((src, i) => {
        const llm = parsed.resume_data.experience?.[i];
        return {
          company: llm?.company ?? src.company,
          title: llm?.title ?? src.title,
          period: { start: src.period.start, end: src.period.end },
          location: src.location,
          description: src.description,
          achievements: llm?.achievements ?? src.achievements,
        };
      });
      parsed.resume_data.education = input.resume_json.education.map((src, i) => {
        const llm = parsed.resume_data.education?.[i];
        return {
          institution: llm?.institution ?? src.institution,
          degree: llm?.degree ?? src.degree,
          major: llm?.major ?? src.major,
          period: { start: src.period.start, end: src.period.end },
          gpa: llm?.gpa ?? src.gpa,
        };
      });
      parsed.resume_data.awards_and_certs = (parsed.resume_data.awards_and_certs ?? []).map((llm, i) => {
        const src = input.resume_json.certifications[i];
        return { name: llm.name, issuer: llm.issuer ?? src?.issuer ?? null, date: src?.date ?? llm.date ?? null };
      });

      // Merge project data: LLM achievements (locale-aware) + structural fields from input
      parsed.resume_data.projects = input.resume_json.projects.map((src, i) => {
        const llm = (parsed.resume_data.projects ?? [])[i];
        return {
          name: src.name,
          period: src.period,
          role: src.role,
          tech_stack: src.tech_stack,
          description: src.description,
          achievements: llm?.achievements?.length ? llm.achievements : src.achievements,
          url: src.url,
        };
      });

      parsed.markdown = renderMarkdown(parsed.resume_data, language);
      parsed.meta = {
        generated_at: new Date().toISOString(),
        language,
        keywords_applied: parsed.meta?.keywords_applied ?? [],
      };

      return parsed;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      const status: number = err?.status ?? err?.statusCode ?? 0;
      const isRetryable = status === 429 || status >= 500 || lastError.includes("JSON");
      if (!isRetryable) break;
      await new Promise(r => setTimeout(r, Math.min(2000 * Math.pow(2, attempt), 30_000)));
    }
  }

  throw new Error(`[ResumeOptimizer] Generation failed after 3 attempts. Last error: ${lastError}`);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runResumeOptimizer(
  input: OptimizedResumeInput
): Promise<OptimizedResumeOutput> {
  let lastError = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await generateResumeDirect(input);
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      console.warn(`[ResumeOptimizer] Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${lastError}`);
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw new Error(`[ResumeOptimizer] Failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`);
}
