import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { z } from "zod";
import { GEMINI_MODEL } from "@readmycareer/agents/models";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const EXTRACT_TIMEOUT_MS = 20_000;
const GEMINI_TIMEOUT_MS = 120_000;
const PDF_INLINE_MAX_BYTES = 15 * 1024 * 1024; // Gemini inlineData practical cap

// ─── Resume Schema (mirrored from mcp-skills/pdf-word-to-json) ────────────────

const DateRangeSchema = z.object({
  start: z.string().catch(""),
  end: z.string().nullable().catch(null),
});

const ResumeJsonSchema = z.object({
  personal: z.object({
    name: z.string().nullable().catch(null),
    email: z.string().nullable().catch(null),
    phone: z.string().nullable().catch(null),
    location: z.string().nullable().catch(null),
    links: z.array(z.string()).catch([]),
  }).catch({ name: null, email: null, phone: null, location: null, links: [] }),
  summary: z.string().nullable().catch(null),
  education: z.array(
    z.object({
      institution: z.string().catch(""),
      degree: z.string().nullable().catch(null),
      major: z.string().nullable().catch(null),
      period: DateRangeSchema.catch({ start: "", end: null }),
      gpa: z.string().nullable().catch(null),
    })
  ).catch([]),
  skills: z.object({
    languages: z.array(z.string()).catch([]),
    frameworks: z.array(z.string()).catch([]),
    tools: z.array(z.string()).catch([]),
    others: z.array(z.string()).catch([]),
  }).catch({ languages: [], frameworks: [], tools: [], others: [] }),
  experience: z.array(
    z.object({
      company: z.string().catch(""),
      title: z.string().catch(""),
      period: DateRangeSchema.catch({ start: "", end: null }),
      location: z.string().nullable().catch(null),
      description: z.string().nullable().catch(null),
      achievements: z.array(z.string()).catch([]),
    })
  ).catch([]),
  projects: z.array(
    z.object({
      name: z.string().catch(""),
      period: DateRangeSchema.nullable().catch(null),
      role: z.string().nullable().catch(null),
      tech_stack: z.array(z.string()).catch([]),
      description: z.string().nullable().catch(null),
      achievements: z.array(z.string()).catch([]),
      url: z.string().nullable().catch(null),
    })
  ).catch([]),
  certifications: z.array(
    z.object({
      name: z.string().catch(""),
      issuer: z.string().nullable().catch(null),
      date: z.string().nullable().catch(null),
    })
  ).catch([]),
  languages: z.array(
    z.object({
      language: z.string().catch(""),
      proficiency: z.string().nullable().catch(null),
    })
  ).catch([]),
  raw_text: z.string().catch(""),
});

type ResumeJson = z.infer<typeof ResumeJsonSchema>;

// ─── Text Extraction ──────────────────────────────────────────────────────────

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // pdf-parse on Vercel Node serverless is unreliable: it can throw on certain
  // PDFs or silently return empty text for image-based or custom-encoded PDFs.
  // Swallow failures here so the caller can fall back to Gemini inline PDF parsing.
  try {
    const data = await pdf(buffer);
    return data?.text ?? "";
  } catch (err) {
    console.warn("[/api/resume] pdf-parse failed, will fall back to inline Gemini PDF:", err);
    return "";
  }
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
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
  "languages": [{ "language": string, "proficiency": string|null }]
}`;

type GeminiInput =
  | { kind: "text"; rawText: string }
  | { kind: "pdf"; buffer: Buffer };

async function parseWithGemini(input: GeminiInput): Promise<ResumeJson> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is not set.");

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const instruction = `Analyze the resume and convert it into the specified JSON schema.
IMPORTANT:
- DO NOT include a "raw_text" field in your JSON.
- Ensure all string values are on a single line (escape newlines as \\n if needed).
- Output ONLY the JSON object.

JSON Schema:
${SCHEMA_DESCRIPTION}`;

  const parts: Array<Record<string, unknown>> =
    input.kind === "pdf"
      ? [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: input.buffer.toString("base64"),
            },
          },
          { text: instruction },
        ]
      : [{ text: `${instruction}\n\nResume Text:\n${input.rawText.slice(0, 10000)}` }];

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: parts as never }],
      });
      const rawResponse = result.response.text().trim();

      let parsed: any;
      try {
        // Remove markdown code blocks if present
        let cleanedResponse = rawResponse
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();

        // Handle cases where LLM might include literal newlines inside strings
        // This is a simple but effective fix for most cases
        try {
          parsed = JSON.parse(cleanedResponse);
        } catch (initialError) {
          // If parsing fails, try to escape literal newlines within strings
          try {
            // Regex that matches strings starting after :, [, or , and handles multi-line content without ES2018 flags
            const escapedResponse = cleanedResponse.replace(/([:[,])\s*"([\s\S]*?[^\\])"/g, (_match, prefix, content) => {
              return prefix + ' "' + content.replace(/\n/g, "\\n").replace(/\r/g, "\\r") + '"';
            });
            parsed = JSON.parse(escapedResponse);
          } catch (secondError) {
            console.error("[/api/resume] JSON Parse Error. Raw response:", rawResponse);
            throw new Error("Failed to parse LLM response as JSON.");
          }
        }

        if (Array.isArray(parsed)) parsed = parsed[0];
      } catch (parseError) {
        console.error("[/api/resume] JSON Parse Error. Raw response:", rawResponse);
        throw new Error("Failed to parse LLM response as JSON.");
      }

      if (!parsed || typeof parsed !== "object") {
        throw new Error("LLM did not provide a valid object-formatted response.");
      }

      parsed.raw_text = input.kind === "text" ? input.rawText : "";
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
        // Stage 1: extract text (best-effort; PDFs may fall through to inline Gemini)
        send("progress", { stage: "extracting" });

        let rawText = "";
        try {
          rawText = await Promise.race([
            fileType === "pdf"
              ? extractTextFromPdf(buffer)
              : extractTextFromDocx(buffer),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("EXTRACT_TIMEOUT")),
                EXTRACT_TIMEOUT_MS
              )
            ),
          ]);
        } catch (err: any) {
          if (fileType !== "pdf") {
            console.error("[/api/resume] Extraction error:", err);
            send("error", {
              code: "EXTRACT_FAILED",
              message: err?.message ?? "",
            });
            return;
          }
          console.warn("[/api/resume] PDF extract timeout, falling back to inline Gemini:", err);
        }

        // DOCX must yield text. For PDFs we tolerate empty (Gemini handles bytes).
        if (fileType === "docx" && !rawText.trim()) {
          send("error", { code: "EXTRACT_EMPTY", message: "" });
          return;
        }

        const useInlinePdf =
          fileType === "pdf" && !rawText.trim() && buffer.byteLength <= PDF_INLINE_MAX_BYTES;

        if (fileType === "pdf" && !rawText.trim() && buffer.byteLength > PDF_INLINE_MAX_BYTES) {
          send("error", { code: "EXTRACT_EMPTY", message: "" });
          return;
        }

        // Stage 2: parse with Gemini
        send("progress", { stage: "parsing" });

        const geminiInput: GeminiInput = useInlinePdf
          ? { kind: "pdf", buffer }
          : { kind: "text", rawText };

        let parsed: ResumeJson;
        try {
          parsed = await Promise.race([
            parseWithGemini(geminiInput),
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

        // Strip raw_text (large field, not needed by client) but keep personal info
        // Personal info is needed so it can be persisted to career_plans.resume_json
        // and later used by the resume optimizer. It is never written to sessionStorage.
        const { raw_text: _rawText, ...resumeForClient } = parsed;
        send("result", resumeForClient);
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
