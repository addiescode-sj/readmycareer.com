import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { z } from "zod";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const EXTRACT_TIMEOUT_MS = 10_000;
const GEMINI_TIMEOUT_MS = 120_000;

// ─── Resume Schema (mirrored from mcp-skills/pdf-word-to-json) ────────────────

const DateRangeSchema = z.object({
  start: z.string().describe("Start date (YYYY-MM or YYYY)"),
  end: z.string().nullable().describe("End date; null if currently employed"),
});

const ResumeJsonSchema = z.object({
  personal: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(z.string()).describe("List of URLs such as LinkedIn, GitHub, etc."),
  }),
  summary: z.string().nullable().describe("Self-introduction / Profile summary"),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().nullable().describe("Degree (Bachelor's/Master's/PhD, etc.)"),
      major: z.string().nullable(),
      period: DateRangeSchema,
      gpa: z.string().nullable(),
    })
  ),
  skills: z.object({
    languages: z.array(z.string()).describe("Programming languages"),
    frameworks: z.array(z.string()),
    tools: z.array(z.string()).describe("DevOps, Cloud, DB, etc."),
    others: z.array(z.string()).describe("Other skills / Certifications / Languages"),
  }),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string().describe("Title / Position"),
      period: DateRangeSchema,
      location: z.string().nullable(),
      description: z.string().nullable().describe("Role summary"),
      achievements: z.array(z.string()).describe("Key achievements and work bullet points"),
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
      proficiency: z.string().nullable().describe("e.g., Native, Fluent, TOEIC 900"),
    })
  ),
  raw_text: z.string().describe("Original text before parsing (for debugging)"),
});

type ResumeJson = z.infer<typeof ResumeJsonSchema>;

// ─── Text Extraction ──────────────────────────────────────────────────────────

async function extractText(buffer: Buffer, fileType: "pdf" | "docx"): Promise<string> {
  if (fileType === "pdf") {
    const data = await pdf(buffer);
    return data.text;
  }
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// ─── Gemini Structured Parsing ────────────────────────────────────────────────

const SCHEMA_DESCRIPTION = `
{
  "personal": { "name": string|null, "email": string|null, "phone": string|null, "location": string|null, "links": string[] },
  "summary": string|null,
  "education": [{ "institution": string, "degree": string|null, "major": string|null, "period": {"start": "YYYY-MM", "end": "YYYY-MM"|null}, "gpa": string|null }],
  "skills": { "languages": string[], "frameworks": string[], "tools": string[], "others": string[] },
  "experience": [{ "company": string, "title": string, "period": {"start":"YYYY-MM","end":"YYYY-MM"|null}, "location": string|null, "description": string|null, "achievements": string[] }],
  "projects": [{ "name": string, "period": {"start":"YYYY-MM","end":"YYYY-MM"|null}|null, "role": string|null, "tech_stack": string[], "description": string|null, "achievements": string[], "url": string|null }],
  "certifications": [{ "name": string, "issuer": string|null, "date": "YYYY-MM"|null }],
  "languages": [{ "language": string, "proficiency": string|null }],
  "raw_text": "(Copy original text exactly)"
}`;

async function parseWithGemini(rawText: string): Promise<ResumeJson> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is not set.");

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `Analyze the resume text and convert it into the specified JSON schema.
You must output **exactly one JSON object**, and do not wrap it in a list or array.
Fill missing fields with null or an empty array ([]).

JSON Schema:
${SCHEMA_DESCRIPTION}

Resume Text:
${rawText.slice(0, 10000)}`;

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const rawResponse = result.response.text().trim();

      let parsed: any;
      try {
        parsed = JSON.parse(rawResponse);
        if (Array.isArray(parsed)) parsed = parsed[0];
      } catch {
        console.error("[/api/resume] JSON Parse Error. Raw response:", rawResponse);
        throw new Error("Failed to parse LLM response as JSON.");
      }

      if (!parsed || typeof parsed !== "object") {
        throw new Error("LLM did not provide a valid object-formatted response.");
      }

      parsed.raw_text = rawText;
      return ResumeJsonSchema.parse(parsed);
    } catch (err: any) {
      const status = err?.status;
      const isRetryable =
        status === 429 ||
        status === 503 ||
        err?.message?.includes("429") ||
        err?.message?.includes("503");
      if (isRetryable && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
        console.warn(
          `[/api/resume] ${status ?? "retryable"} error. Retrying in ${Math.round(delay / 1000)}s... (${attempt + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Maximum retry limit exceeded.");
}

// ─── SSE Helper ───────────────────────────────────────────────────────────────

function sseChunk(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  );
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  // Validation errors return plain JSON before the stream opens
  if (!file) {
    return Response.json({ error: "파일이 없습니다." }, { status: 400 });
  }

  const MAX_SIZE_MB = 10;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return Response.json(
      { error: `파일 크기는 ${MAX_SIZE_MB}MB 이하여야 합니다.` },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "docx", "doc"].includes(ext)) {
    return Response.json(
      { error: "PDF 또는 Word 파일만 지원합니다." },
      { status: 400 }
    );
  }

  if (file.type && !ALLOWED_MIMES.has(file.type)) {
    return Response.json(
      { error: "허용되지 않는 파일 형식입니다." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileType = ext === "pdf" ? "pdf" : "docx";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(sseChunk(event, data));

      try {
        // Stage 1: extract text
        send("progress", { stage: "extracting" });

        let rawText: string;
        try {
          rawText = await Promise.race([
            extractText(buffer, fileType),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("EXTRACT_TIMEOUT")),
                EXTRACT_TIMEOUT_MS
              )
            ),
          ]);
        } catch (err: any) {
          console.error("[/api/resume] Extraction error:", err);
          send("error", {
            code: "EXTRACT_FAILED",
            message: err?.message ?? "",
          });
          return;
        }

        if (!rawText.trim()) {
          send("error", { code: "EXTRACT_EMPTY", message: "" });
          return;
        }

        // Stage 2: parse with Gemini
        send("progress", { stage: "parsing" });

        let parsed: ResumeJson;
        try {
          parsed = await Promise.race([
            parseWithGemini(rawText),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("PARSE_TIMEOUT")),
                GEMINI_TIMEOUT_MS
              )
            ),
          ]);
        } catch (err: any) {
          console.error("[/api/resume] Gemini error:", err);
          const msg: string = err?.message ?? "";
          const errStatus = err?.status;
          let code = "PARSE_FAILED";
          if (msg === "PARSE_TIMEOUT") code = "PARSE_TIMEOUT";
          else if (
            errStatus === 429 || errStatus === 503 ||
            msg.includes("429") || msg.includes("503") ||
            msg.toLowerCase().includes("quota") ||
            msg.toLowerCase().includes("unavailable")
          ) code = "PARSE_QUOTA";
          send("error", { code, message: msg });
          return;
        }

        // Strip personal contact info and raw_text before sending to client
        const { personal: _personal, raw_text: _rawText, ...resumeWithoutPersonal } = parsed;
        send("result", resumeWithoutPersonal);
      } catch (err) {
        console.error("[/api/resume] Unexpected error:", err);
        send("error", { code: "UNKNOWN", message: "" });
      } finally {
        send("done", {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
