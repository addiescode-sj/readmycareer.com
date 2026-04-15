import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Input / Output Schemas ───────────────────────────────────────────────────
// ResumeData shares the same structure as ResumeJsonSchema in the pdf-word-to-json skill.
// It is recommended to extract this into a shared package (@readmycareer/schemas) in production.

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
    "Modified/refined resume JSON (output from pdf-word-to-json or manually drafted)"
  ),
  target_jd: z
    .object({
      title: z.string(),
      company: z.string().nullable(),
      keywords: z.array(z.string()).describe("JD keywords to emphasize"),
    })
    .optional()
    .describe("Target job information — keyword optimization is applied if provided"),
  options: z
    .object({
      language: z.enum(["ko", "en"]).default("ko").describe("Output language"),
      style: z
        .enum(["classic", "modern", "compact"])
        .default("modern")
        .describe("Markdown layout style"),
      include_sections: z
        .array(
          z.enum([
            "summary",
            "skills",
            "experience",
            "projects",
            "education",
            "certifications",
            "languages",
          ])
        )
        .default([
          "summary",
          "skills",
          "experience",
          "projects",
          "education",
          "certifications",
          "languages",
        ])
        .describe("List of sections to include (respects order)"),
    })
    .optional(),
});

export const GenerateOutputSchema = z.object({
  markdown: z.string().describe("Full text of the generated Markdown resume"),
  meta: z.object({
    generated_at: z.string().describe("ISO 8601"),
    language: z.enum(["ko", "en"]),
    style: z.string(),
    word_count: z.number().int(),
    sections_included: z.array(z.string()),
    keywords_applied: z
      .array(z.string())
      .describe("List of JD keywords actually inserted/emphasized"),
  }),
});

export type GenerateInput = z.infer<typeof GenerateInputSchema>;
export type GenerateOutput = z.infer<typeof GenerateOutputSchema>;

// ─── Stub Implementation ──────────────────────────────────────────────────────

async function generateResume(input: GenerateInput): Promise<GenerateOutput> {
  // TODO: Invoke section rendering functions in the order of options.include_sections
  // TODO: Naturally inject target_jd.keywords into achievements/description text (via LLM)
  // TODO: Apply markdown header/table/bullet styles according to options.style
  // TODO: Aggregate word_count and keywords_applied
  // TODO: Return in GenerateOutputSchema shape

  throw new Error("NOT_IMPLEMENTED: Markdown resume generation logic required");
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "resume-generator",
  version: "0.1.0",
});

server.tool(
  "generate_resume",
  "Takes modified resume JSON and generates a Markdown-formatted resume optimized with JD keywords.",
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