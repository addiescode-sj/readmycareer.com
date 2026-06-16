// Zod schemas + typed loaders for every eval boundary.
//
// agents/types.ts expresses the agent contracts as plain TS interfaces (not Zod), so
// the eval layer owns the runtime schema. CareerPlanSchema mirrors the JSON Schema the
// Python harness validated against (CAREER_PLAN_SCHEMA in agent_harness.py): the same
// required fields, the same category/priority enums, the YYYY-MM-DD date pattern, the
// 0–100 score bound, and `weeks` requiring at least one entry. Extra keys are allowed
// (the JSON Schema set no additionalProperties:false), so objects strip rather than reject.

import { readFileSync } from "node:fs";
import { z } from "zod";

const Category = z.enum(["skill", "experience", "certification", "portfolio", "keyword"]);
const Priority = z.enum(["high", "medium", "low"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const StrengthItem = z.object({
  id: z.string(),
  category: Category,
  item: z.string(),
  evidence: z.string(),
});

// Mirrors CAREER_PLAN_SCHEMA's gaps.items exactly: id/item/priority/category/rationale
// are *required to be present*, but only category and priority carry a type constraint
// (the JSON Schema left id/item/rationale untyped). Typing them as z.string() would make
// schema_compliance_rate diverge for a (pathological) gap with a non-string id/item.
const GapItem = z
  .object({
    id: z.unknown(),
    category: Category,
    item: z.unknown(),
    priority: Priority,
    rationale: z.unknown(),
  })
  .superRefine((val, ctx) => {
    for (const key of ["id", "item", "rationale"] as const) {
      if (!(key in val)) {
        ctx.addIssue({ code: "custom", message: `'${key}' is a required property`, path: [key] });
      }
    }
  });

const GapAnalysis = z.object({
  target_role: z.string().min(1),
  strengths: z.array(StrengthItem),
  gaps: z.array(GapItem),
  priority_order: z.array(z.string()),
  overall_match_score: z.number().min(0).max(100),
  summary: z.string().min(1),
});

const Week = z.object({
  week_number: z.number().int().min(1),
  date_range: z.object({
    start: z.string().regex(DATE_RE),
    end: z.string().regex(DATE_RE),
  }),
  theme: z.string().min(1),
  todos: z.array(z.unknown()),
});

/** Top-level /api/analyze result schema — `gap_analysis` + `weeks`, both required. */
export const CareerPlanSchema = z.object({
  gap_analysis: GapAnalysis,
  weeks: z.array(Week).min(1),
});

export interface SchemaValidation {
  valid: boolean;
  errors: string[]; // up to 3 messages, mirroring the Python harness
}

/** Validates a parsed response against CareerPlanSchema; returns validity + first 3 errors. */
export function validateCareerPlan(data: unknown): SchemaValidation {
  const result = CareerPlanSchema.safeParse(data);
  if (result.success) return { valid: true, errors: [] };
  const errors = result.error.issues
    .slice(0, 3)
    .map((issue) => {
      const path = issue.path.join("/");
      return path ? `${path}: ${issue.message}` : issue.message;
    });
  return { valid: false, errors };
}

// ── Agent fixtures ────────────────────────────────────────────────────────────

export interface Fixture {
  id: string;
  description: string;
  request: Record<string, unknown> & {
    resumeJson?: { projects?: { name?: string }[] };
    targetRole?: string;
    targetCompany?: string;
    provider?: string;
  };
  expected_gaps_keywords?: string[];
  expected_strengths_keywords?: string[];
  expected_match_score_range?: [number, number];
  expected_categories?: string[];
  expected_hidden_expectations?: string[];
  expected_prerequisite_pairs?: [string, string][];
}

const FixtureSchema = z.object({
  id: z.string(),
  description: z.string(),
  request: z.record(z.string(), z.unknown()),
  expected_gaps_keywords: z.array(z.string()).optional(),
  expected_strengths_keywords: z.array(z.string()).optional(),
  expected_match_score_range: z.tuple([z.number(), z.number()]).optional(),
  expected_categories: z.array(z.string()).optional(),
  expected_hidden_expectations: z.array(z.string()).optional(),
  expected_prerequisite_pairs: z.array(z.tuple([z.string(), z.string()])).optional(),
});

const FixturesSchema = z.array(FixtureSchema);

/** Loads and Zod-validates the agent fixtures file; throws with a clear message on failure. */
export function loadFixtures(path: string): Fixture[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const parsed = FixturesSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Fixture file failed schema validation (${path}):\n${formatIssues(parsed.error)}`);
  }
  return raw as Fixture[];
}

// ── RAG evaluation dataset ──────────────────────────────────────────────────────

export interface DatasetCase {
  question: string;
  ground_truth: string;
  contexts_query: string;
  category?: string;
  doc_type?: string;
  expected_doc_type?: string;
  expected_tags?: string[];
}

const DatasetCaseSchema = z.object({
  question: z.string(),
  ground_truth: z.string(),
  contexts_query: z.string(),
  category: z.string().optional(),
  doc_type: z.string().optional(),
  expected_doc_type: z.string().optional(),
  expected_tags: z.array(z.string()).optional(),
});

const DatasetSchema = z.array(DatasetCaseSchema);

/** Loads and Zod-validates the RAG eval dataset; throws with a clear message on failure. */
export function loadDataset(path: string): DatasetCase[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const parsed = DatasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Dataset file failed schema validation (${path}):\n${formatIssues(parsed.error)}`);
  }
  return raw as DatasetCase[];
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `  - ${i.path.join("/") || "(root)"}: ${i.message}`)
    .join("\n");
}
