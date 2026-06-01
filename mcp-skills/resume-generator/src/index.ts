import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

// Default Gemini model, env-overridable via GEMINI_MODEL. MCP skills run as separate
// processes and cannot import the agents model registry, so they read the same env var
// (forwarded by the agent MCP client) — setting GEMINI_MODEL once switches them too.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview";

// ─── Input / Output Schemas ───────────────────────────────────────────────────

const DateRangeSchema = z.object({
  start: z.string(),
  end: z.string().nullable(),
});

const ResumeDataSchema = z.object({
  personal: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(z.string()),
  }),
  summary: z.string().nullable(),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().nullable(),
      major: z.string().nullable(),
      period: DateRangeSchema,
      gpa: z.string().nullable(),
    })
  ),
  skills: z.object({
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    tools: z.array(z.string()),
    others: z.array(z.string()),
  }),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      period: DateRangeSchema,
      location: z.string().nullable(),
      description: z.string().nullable(),
      achievements: z.array(z.string()),
    })
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      period: DateRangeSchema.nullable(),
      role: z.string().nullable(),
      tech_stack: z.array(z.string()),
      description: z.string().nullable(),
      achievements: z.array(z.string()),
      url: z.string().nullable(),
    })
  ),
  certifications: z.array(
    z.object({
      name: z.string(),
      issuer: z.string().nullable(),
      date: z.string().nullable(),
    })
  ),
  languages: z.array(
    z.object({
      language: z.string(),
      proficiency: z.string().nullable(),
    })
  ),
});

export const GenerateInputSchema = z.object({
  resume_data: ResumeDataSchema.describe(
    "Full resume JSON including personal info"
  ),
  target_jd: z
    .object({
      title: z.string(),
      company: z.string().nullable(),
      keywords: z.array(z.string()).describe("Required JD keywords — must be woven into highlights and skills"),
      preferred_keywords: z.array(z.string()).optional().describe("Preferred JD keywords — include where natural"),
    })
    .optional()
    .describe("Target job information for keyword optimization"),
  cover_letter_context: z
    .object({
      gap_summary: z.string().describe("Summary of gaps and how they were addressed"),
      completed_activities: z
        .array(z.string())
        .describe("List of completed career plan activities"),
    })
    .optional()
    .describe("Context for generating the cover letter / motivation paragraph"),
  options: z
    .object({
      language: z.enum(["ko", "en"]).default("en").describe("Output language"),
    })
    .optional(),
});

export const GenerateOutputSchema = z.object({
  resume_data: z.object({
    personal: z.object({
      name: z.string().nullable(),
      job_title: z.string(),
      links: z.array(z.string()),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    }),
    highlights: z.array(z.string()).max(5),
    skills: z.array(z.string()),
    experience: z.array(
      z.object({
        company: z.string(),
        title: z.string(),
        period: DateRangeSchema,
        achievements: z.array(z.string()),
      })
    ).default([]),
    projects: z.array(
      z.object({
        name: z.string(),
        period: DateRangeSchema.nullable(),
        role: z.string().nullable(),
        tech_stack: z.array(z.string()),
        description: z.string().nullable(),
        achievements: z.array(z.string()),
        url: z.string().nullable(),
      })
    ).default([]),
    education: z.array(
      z.object({
        institution: z.string(),
        degree: z.string().nullable(),
        major: z.string().nullable(),
        period: DateRangeSchema,
        gpa: z.string().nullable(),
      })
    ),
    awards_and_certs: z.array(
      z.object({
        name: z.string(),
        issuer: z.string().nullable(),
        date: z.string().nullable(),
      })
    ),
    cover_letter: z.string(),
  }),
  markdown: z.string(),
  meta: z.object({
    generated_at: z.string(),
    language: z.enum(["ko", "en"]),
    keywords_applied: z.array(z.string()),
  }),
});

export type GenerateInput = z.infer<typeof GenerateInputSchema>;
export type GenerateOutput = z.infer<typeof GenerateOutputSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function buildUserPrompt(input: GenerateInput, language: "ko" | "en"): string {
  const { resume_data, target_jd, cover_letter_context } = input;
  const keywords = target_jd?.keywords ?? [];
  const preferredKeywords = target_jd?.preferred_keywords ?? [];
  const activities = cover_letter_context?.completed_activities ?? [];
  const gapSummary = cover_letter_context?.gap_summary ?? "";

  const allSkills = [
    ...resume_data.skills.languages,
    ...resume_data.skills.frameworks,
    ...resume_data.skills.tools,
    ...resume_data.skills.others,
  ];

  const experienceText = resume_data.experience
    .map(e => `${e.title} at ${e.company} (${e.period.start}–${e.period.end ?? "present"}): ${e.achievements.join("; ")}`)
    .join("\n");

  const projectsText = resume_data.projects
    .map(p => `${p.name} [${p.tech_stack.join(", ")}]${p.url ? ` (${p.url})` : ""}${p.role ? ` | ${p.role}` : ""}: ${p.achievements.join("; ")}`)
    .join("\n");

  const educationText = resume_data.education
    .map(e => {
      const degree = [e.degree, e.major].filter(Boolean).join(", ");
      const period = `${e.period.start}–${e.period.end ?? "present"}`;
      return `- ${e.institution} | ${degree || "N/A"} | Period: ${period}${e.gpa ? ` | GPA: ${e.gpa}` : ""}`;
    })
    .join("\n");

  const certificationsText = resume_data.certifications
    .map(c => `- ${c.name} | Issuer: ${c.issuer ?? "N/A"} | Date: ${c.date ?? "N/A"}`)
    .join("\n");

  return `
Generate an optimized resume JSON for the following candidate.

## Target Role
Title: ${target_jd?.title ?? "Not specified"}
Company: ${target_jd?.company ?? "Not specified"}
Required Keywords (MUST appear in highlights/skills): ${keywords.length > 0 ? keywords.join(", ") : "general"}
Preferred Keywords (include where natural): ${preferredKeywords.length > 0 ? preferredKeywords.join(", ") : "none"}

## Resume Data
Name: ${resume_data.personal.name ?? "N/A"}
Email: ${resume_data.personal.email ?? "N/A"}
Phone: ${resume_data.personal.phone ?? "N/A"}
Links: ${resume_data.personal.links.join(", ") || "N/A"}

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
${activities.length > 0 ? activities.join("\n") : "N/A"}

## Gap Summary
${gapSummary || "N/A"}

## Output JSON Schema
{
  "resume_data": {
    "personal": { "name": string|null, "job_title": string, "links": string[], "email": string|null, "phone": string|null },
    "highlights": string[],        // max 5 ATS bullets from experience + projects, prioritizing JD keywords
    "skills": string[],            // flat list of key technologies and competencies
    "experience": [{ "company": string, "title": string, "period": {"start": string, "end": string|null}, "achievements": string[] }],
    "projects": [{ "name": string, "achievements": string[] }],  // rewrite achievements in output language; keep name identical to input
    "education": [{ "institution": string, "degree": string|null, "major": string|null, "period": {"start": string, "end": string|null}, "gpa": string|null }],
    "awards_and_certs": [{ "name": string, "issuer": string|null, "date": string|null }],
    "cover_letter": string         // 5-6 sentence motivation paragraph explaining JD fit
  },
  "markdown": string,              // full formatted Markdown of the resume
  "meta": {
    "generated_at": string,        // ISO 8601
    "language": "${language}",
    "keywords_applied": string[]   // which JD keywords were actually woven in
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

function renderMarkdown(data: GenerateOutput["resume_data"], language: "ko" | "en"): string {
  const { personal, highlights, skills, experience, projects, education, awards_and_certs, cover_letter } = data;
  const sections: string[] = [];

  // Header
  sections.push(`# ${personal.name ?? (language === "ko" ? "이름" : "Name")}`);
  sections.push(`**${personal.job_title}**`);
  const contactParts: string[] = [];
  if (personal.email) contactParts.push(personal.email);
  if (personal.phone) contactParts.push(personal.phone);
  if (personal.links.length > 0) contactParts.push(...personal.links);
  if (contactParts.length > 0) sections.push(contactParts.join("  |  "));

  sections.push("");

  // Highlights
  const highlightHeading = language === "ko" ? "## 핵심 성과 및 강점" : "## Key Highlights";
  sections.push(highlightHeading);
  for (const h of highlights) {
    sections.push(`- ${h}`);
  }
  sections.push("");

  // Skills
  const skillsHeading = language === "ko" ? "## 주요 기술" : "## Key Skills";
  sections.push(skillsHeading);
  sections.push(skills.join("  ·  "));
  sections.push("");

  // Work Experience
  if (experience && experience.length > 0) {
    const expHeading = language === "ko" ? "## 경력사항" : "## Work Experience";
    sections.push(expHeading);
    for (const e of experience) {
      const period = `${e.period.start}${e.period.end ? ` – ${e.period.end}` : " – present"}`;
      sections.push(`### ${e.title} @ ${e.company}  (${period})`);
      for (const a of e.achievements) {
        sections.push(`- ${a}`);
      }
      sections.push("");
    }
  }

  // Projects
  if (projects && projects.length > 0) {
    const projectsHeading = language === "ko" ? "## 프로젝트" : "## Projects";
    sections.push(projectsHeading);
    for (const p of projects) {
      const periodStr = p.period
        ? `${p.period.start}${p.period.end ? ` – ${p.period.end}` : ""}`
        : null;
      const metaParts: string[] = [];
      if (p.role) metaParts.push(p.role);
      if (p.tech_stack.length > 0) metaParts.push(p.tech_stack.join(", "));
      const header = `### ${p.name}${periodStr ? `  (${periodStr})` : ""}`;
      sections.push(header);
      if (metaParts.length > 0) sections.push(`*${metaParts.join("  |  ")}*`);
      if (p.url) sections.push(`[${language === "ko" ? "프로젝트 링크" : "Project Link"}](${p.url})`);
      for (const a of p.achievements) {
        sections.push(`- ${a}`);
      }
      sections.push("");
    }
  }

  // Education
  const educationHeading = language === "ko" ? "## 학력" : "## Education";
  sections.push(educationHeading);
  for (const e of education) {
    const degree = [e.degree, e.major].filter(Boolean).join(", ");
    const period = `${e.period.start}${e.period.end ? ` – ${e.period.end}` : ""}`;
    sections.push(`- **${e.institution}** — ${degree} (${period})${e.gpa ? `, GPA ${e.gpa}` : ""}`);
  }
  sections.push("");

  // Awards & Certifications
  if (awards_and_certs.length > 0) {
    const certsHeading = language === "ko" ? "## 수상 내역 및 자격증" : "## Awards & Certifications";
    sections.push(certsHeading);
    for (const c of awards_and_certs) {
      const issuerPart = c.issuer ? ` — ${c.issuer}` : "";
      const datePart = c.date ? ` (${c.date})` : "";
      sections.push(`- ${c.name}${issuerPart}${datePart}`);
    }
    sections.push("");
  }

  // Cover Letter
  const coverHeading = language === "ko" ? "## 지원 동기" : "## Cover Letter";
  sections.push(coverHeading);
  sections.push(cover_letter);

  return sections.join("\n");
}

// ─── Core LLM Call ────────────────────────────────────────────────────────────

async function generateResume(input: GenerateInput): Promise<GenerateOutput> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set.");

  const language = input.options?.language ?? "en";
  const systemInstruction = buildSystemInstruction(language);
  const userPrompt = buildUserPrompt(input, language);

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
  });

  let lastError: string = "";
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
      const parsed = JSON.parse(cleaned) as GenerateOutput;

      // Validate required quality gates
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

      // Post-processing date hardening: overwrite LLM-generated dates with exact input values
      // to prevent any hallucination regardless of prompt compliance.
      parsed.resume_data.experience = input.resume_data.experience.map((src, i) => {
        const llm = parsed.resume_data.experience?.[i];
        return {
          company: llm?.company ?? src.company,
          title: llm?.title ?? src.title,
          period: { start: src.period.start, end: src.period.end },
          achievements: llm?.achievements ?? src.achievements,
        };
      });
      parsed.resume_data.education = input.resume_data.education.map((src, i) => {
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
        const src = input.resume_data.certifications[i];
        return {
          name: llm.name,
          issuer: llm.issuer ?? src?.issuer ?? null,
          date: src?.date ?? llm.date ?? null,
        };
      });

      // Merge project data: use LLM-generated achievements (locale-aware) + structural fields from input (fidelity)
      parsed.resume_data.projects = input.resume_data.projects.map((src, i) => {
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

      // Regenerate markdown from structured data to guarantee template order
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

      const delay = Math.min(2000 * Math.pow(2, attempt), 30_000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error(`resume-generator: generation failed after 3 attempts. Last error: ${lastError}`);
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "resume-generator",
  version: "1.0.0",
});

server.tool(
  "generate_resume",
  "Generates an ATS-optimized resume in a fixed template format using Gemini. Template order: personal info, highlights (max 5 bullets), skills, education, awards/certs, cover letter.",
  GenerateInputSchema.shape,
  async (args) => {
    const input = GenerateInputSchema.parse(args);
    const output = await generateResume(input);
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
