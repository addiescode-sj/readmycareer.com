import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pdf from "pdf-parse";
import mammoth from "mammoth";

// Default Gemini model, env-overridable via GEMINI_MODEL. MCP skills run as separate
// processes and cannot import the agents model registry, so they read the same env var
// (forwarded by the agent MCP client) — setting GEMINI_MODEL once switches them too.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview";

// ─── Input / Output Schemas ───────────────────────────────────────────────────

export const ParseInputSchema = z.object({
  file_base64: z.string().describe("Base64 encoded string of the file"),
  file_name: z.string().describe("Original filename including extension (e.g., resume.pdf)"),
  file_type: z.enum(["pdf", "docx", "doc"]).describe("File format"),
});

const DateRangeSchema = z.object({
  start: z.string().describe("Start date (YYYY-MM or YYYY)"),
  end: z.string().nullable().describe("End date; null if currently employed"),
});

export const ResumeJsonSchema = z.object({
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

export type ParseInput = z.infer<typeof ParseInputSchema>;
export type ResumeJson = z.infer<typeof ResumeJsonSchema>;

// ─── Text Extraction ──────────────────────────────────────────────────────────

async function extractText(
  buffer: Buffer,
  fileType: ParseInput["file_type"]
): Promise<string> {
  if (fileType === "pdf") {
    const data = await pdf(buffer);
    return data.text;
  }
  // docx / doc
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
    model: GEMINI_MODEL,
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
      } catch (err) {
        console.error("[MCP] JSON Parse Error. Raw response:", rawResponse);
        throw new Error("Failed to parse LLM response as JSON.");
      }

      if (!parsed || typeof parsed !== "object") {
        throw new Error("LLM did not provide a valid object-formatted response.");
      }

      parsed.raw_text = rawText;
      return ResumeJsonSchema.parse(parsed);
    } catch (err: any) {
      const is429 = err?.message?.includes("429") || err?.status === 429;
      if (is429 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
        console.warn(`[MCP] 429 Quota Exceeded. Retrying in ${Math.round(delay / 1000)}s... (${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Maximum retry limit exceeded.");
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

async function parseResume(input: ParseInput): Promise<ResumeJson> {
  const buffer = Buffer.from(input.file_base64, "base64");
  const rawText = await extractText(buffer, input.file_type);

  if (!rawText.trim()) {
    throw new Error("Text extraction failed: The file is either a scanned image PDF or empty. Please enter text directly.");
  }

  return parseWithGemini(rawText);
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "pdf-word-to-json",
  version: "0.1.0",
});

server.tool(
  "parse_resume",
  "Parses PDF or Word resumes and converts them into a structured JSON schema (Education, Skills, Experience, Projects, etc.).",
  ParseInputSchema.shape,
  async (args) => {
    const input = ParseInputSchema.parse(args);
    const output = await parseResume(input);
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);