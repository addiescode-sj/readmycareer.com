import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { v4 as uuidv4 } from "uuid";

// ─── Input / Output Schemas ───────────────────────────────────────────────────

const GapItemSchema = z.object({
  category: z
    .enum(["skill", "experience", "certification", "portfolio", "keyword"])
    .describe("Gap category"),
  item: z.string().describe("Missing item name (e.g. 'Kubernetes', 'AWS Solutions Architect')"),
  current_level: z.string().nullable().describe("Current proficiency level"),
  required_level: z.string().nullable().describe("Level required by JD"),
  priority: z.enum(["high", "medium", "low"]),
});

export const PlanInputSchema = z.object({
  target_jd: z.object({
    title: z.string().describe("Target job title"),
    company: z.string().nullable(),
    required_skills: z.array(z.string()),
    preferred_skills: z.array(z.string()),
  }),
  gap_analysis: z.object({
    gaps: z.array(GapItemSchema),
    strengths: z.array(z.string()).describe("List of existing strengths"),
  }),
  duration_weeks: z
    .number()
    .int()
    .min(1)
    .max(52)
    .describe("Preparation period in weeks (e.g. 4)"),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Start date (YYYY-MM-DD)"),
  preferences: z
    .object({
      hours_per_week: z
        .number()
        .default(10)
        .describe("Available hours per week"),
      learning_style: z
        .enum(["online_course", "book", "project", "mixed"])
        .default("mixed"),
    })
    .optional(),
});

const TodoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: GapItemSchema.shape.category,
  priority: GapItemSchema.shape.priority,
  estimated_hours: z.number().describe("Estimated hours required"),
  resources: z
    .array(
      z.object({
        type: z.enum(["url", "book", "course", "tool"]),
        label: z.string(),
        url: z.string().nullable(),
      })
    )
    .describe("References / Resources"),
  done: z.boolean().default(false),
});

const WeekSchema = z.object({
  week_number: z.number().int(),
  date_range: z.object({
    start: z.string().describe("YYYY-MM-DD"),
    end: z.string().describe("YYYY-MM-DD"),
  }),
  theme: z.string().describe("Core theme of the week (e.g. 'Mastering Docker Basics')"),
  todos: z.array(TodoItemSchema),
  milestone: z.string().nullable().describe("Milestone to achieve by the end of the week"),
});

export const PlanOutputSchema = z.object({
  plan_id: z.string().describe("UUID v4"),
  created_at: z.string().describe("ISO 8601"),
  target_jd_title: z.string(),
  duration_weeks: z.number().int(),
  start_date: z.string(),
  end_date: z.string(),
  summary: z.string().describe("One-line summary of the plan"),
  weeks: z.array(WeekSchema),
  timeline: z.object({
    milestones: z.array(
      z.object({
        week: z.number().int(),
        date: z.string(),
        label: z.string(),
      })
    ),
    gantt_rows: z
      .array(
        z.object({
          task: z.string(),
          start_week: z.number().int(),
          end_week: z.number().int(),
          category: GapItemSchema.shape.category,
        })
      )
      .describe("Row data for Timeline/Gantt rendering"),
  }),
});

export type PlanInput = z.infer<typeof PlanInputSchema>;
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

// ─── Date helpers ─────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

// ─── Gemini Plan Generation ───────────────────────────────────────────────────

async function generateCareerPlan(input: PlanInput): Promise<PlanOutput> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY environment variable is not set.");

  const startDate = new Date(input.start_date);
  const endDate = addDays(startDate, input.duration_weeks * 7 - 1);
  const prefs = input.preferences ?? { hours_per_week: 10, learning_style: "mixed" as const };

  const weekRanges = Array.from({ length: input.duration_weeks }, (_, i) => {
    const weekStart = addDays(startDate, i * 7);
    const weekEnd = addDays(startDate, i * 7 + 6);
    return { week: i + 1, start: toIsoDate(weekStart), end: toIsoDate(weekEnd) };
  });

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `You are a career planning expert. Generate a ${input.duration_weeks}-week career plan in JSON format based on the following information.

## Input Information
- Target Job: ${input.target_jd.title}${input.target_jd.company ? ` @ ${input.target_jd.company}` : ""}
- Duration: ${input.duration_weeks} weeks (${input.start_date} ~ ${toIsoDate(endDate)})
- Available Hours: ${prefs.hours_per_week} hours/week
- Learning Style: ${prefs.learning_style}
- Required Skills: ${input.target_jd.required_skills.join(", ")}
- Preferred Skills: ${input.target_jd.preferred_skills.join(", ")}
- Gap List (Ordered by priority):
${input.gap_analysis.gaps.map((g, i) => `  ${i + 1}. [${g.priority}] ${g.item} (${g.category}) - Current: ${g.current_level ?? "None"}, Required: ${g.required_level ?? "Expert level"}`).join("\n")}
- Strengths: ${input.gap_analysis.strengths.join(", ")}
- Weekly Date Ranges: ${JSON.stringify(weekRanges)}

## Output JSON Structure
{
  "summary": "One-line summary of the plan",
  "weeks": [
    {
      "week_number": 1,
      "date_range": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"},
      "theme": "Core theme for the week",
      "milestone": "Weekly milestone or null",
      "todos": [
        {
          "id": "todo_1_1",
          "title": "Specific task",
          "description": "Detailed description or null",
          "category": "skill|experience|certification|portfolio|keyword",
          "priority": "high|medium|low",
          "estimated_hours": number,
          "resources": [{"type": "url|book|course|tool", "label": "Resource name", "url": "URL or null"}],
          "done": false
        }
      ]
    }
  ],
  "timeline": {
    "milestones": [{"week": number, "date": "YYYY-MM-DD", "label": "Milestone name"}],
    "gantt_rows": [{"task": "Task name", "start_week": 1, "end_week": 2, "category": "skill"}]
  }
}

Rules:
- Generate at least 3 specific todos for each week.
- Place high priority gaps in the early weeks.
- Set milestones every 3-4 weeks or upon closing a major gap.
- Generate todo IDs in "todo_{week}_{index}" format.
- Provide real-world learning resources (courses, books, docs) with URLs.`;

  const maxRetries = 3;
  let parsed: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(cleaned);
      break;
    } catch (err: any) {
      const is429 = err?.message?.includes("429") || err?.status === 429;
      if (is429 && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 2000 + Math.random() * 1000;
        console.warn(`[MCP][Planner] 429 Quota Exceeded. Retrying in ${Math.round(delay / 1000)}s... (${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  if (!parsed) throw new Error("Failed to generate plan after maximum retries.");

  const fullOutput: PlanOutput = {
    plan_id: uuidv4(),
    created_at: new Date().toISOString(),
    target_jd_title: input.target_jd.title,
    duration_weeks: input.duration_weeks,
    start_date: input.start_date,
    end_date: toIsoDate(endDate),
    summary: parsed.summary,
    weeks: parsed.weeks,
    timeline: parsed.timeline,
  };

  return PlanOutputSchema.parse(fullOutput);
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "career-plan-generator",
  version: "0.1.0",
});

server.tool(
  "generate_plan",
  "Generates a weekly to-do list and JSON for Timeline/Gantt rendering based on gap analysis results and job search duration.",
  PlanInputSchema.shape,
  async (args) => {
    const input = PlanInputSchema.parse(args);
    const output = await generateCareerPlan(input);
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);