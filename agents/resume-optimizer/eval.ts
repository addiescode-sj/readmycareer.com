// ─── ResumeOptimizerAgent Eval Script ────────────────────────────────────────
// Runs the resume optimizer against a fixture and validates quality gates.
// Usage: tsx agents/resume-optimizer/eval.ts

import { runResumeOptimizer } from "./index.js";
import { OptimizedResumeInput, OptimizedResumeOutput } from "../types.js";

// ── Quality thresholds ────────────────────────────────────────────────────────

const QUALITY = {
  HIGHLIGHTS_MIN: 3,
  HIGHLIGHTS_MAX: 5,
  COVER_LETTER_MIN_SENTENCES: 5,
  COVER_LETTER_MAX_SENTENCES: 7,
  REQUIRED_RESUME_SECTIONS: [
    "personal",
    "highlights",
    "skills",
    "education",
    "awards_and_certs",
    "cover_letter",
  ] as const,
  MIN_KEYWORDS_APPLIED: 3,
  MIN_SKILLS: 3,
};

// ── Fixture ───────────────────────────────────────────────────────────────────

const FIXTURE: OptimizedResumeInput = {
  resume_json: {
    personal: {
      name: "Jane Dev",
      email: "jane@example.com",
      phone: "+1-555-0100",
      location: "Seoul, KR",
      links: ["https://github.com/janedev", "https://janedev.io"],
    },
    summary: "Full-stack engineer with 5 years of experience building scalable web applications.",
    education: [
      {
        institution: "Seoul National University",
        degree: "B.S.",
        major: "Computer Science",
        period: { start: "2016-03", end: "2020-02" },
        gpa: "3.8",
      },
    ],
    skills: {
      languages: ["TypeScript", "Python", "Go"],
      frameworks: ["React", "Next.js", "FastAPI"],
      tools: ["Docker", "Kubernetes", "AWS"],
      others: ["CI/CD", "Agile"],
    },
    experience: [
      {
        company: "TechCorp",
        title: "Senior Software Engineer",
        period: { start: "2022-01", end: null },
        location: "Seoul",
        description: "Led backend platform team.",
        achievements: [
          "Reduced API latency by 40% through caching layer redesign",
          "Migrated monolith to microservices serving 2M daily users",
        ],
      },
    ],
    projects: [
      {
        name: "OSS GraphQL Gateway",
        period: { start: "2021-06", end: "2021-12" },
        role: "Lead Engineer",
        tech_stack: ["Node.js", "GraphQL", "Redis"],
        description: "Open-source API gateway for federated GraphQL.",
        achievements: ["500 GitHub stars in 3 months", "Used by 20+ companies"],
        url: "https://github.com/janedev/graphql-gateway",
      },
    ],
    certifications: [
      { name: "AWS Certified Solutions Architect", issuer: "Amazon", date: "2023-05" },
    ],
    languages: [{ language: "English", proficiency: "Fluent" }, { language: "Korean", proficiency: "Native" }],
  },
  gap_analysis: {
    target_role: "Staff Engineer",
    strengths: [
      { id: "s1", category: "skill", item: "TypeScript", evidence: "5 years TypeScript usage" },
      { id: "s2", category: "experience", item: "Microservices", evidence: "Led migration at TechCorp" },
    ],
    gaps: [
      { id: "g1", category: "skill", item: "Terraform", current_level: null, required_level: "Proficient", priority: "high", rationale: "IaC experience required for Staff level" },
      { id: "g2", category: "certification", item: "CKA (Certified Kubernetes Administrator)", current_level: null, required_level: "Certified", priority: "medium", rationale: "Kubernetes depth expected at staff level" },
    ],
    priority_order: ["g1", "g2"],
    overall_match_score: 72,
    summary: "Strong backend and cloud skills. Main gaps: Terraform IaC and CKA certification.",
  },
  completed_todos: [
    {
      id: "t1", title: "Complete Terraform Fundamentals course on Udemy", description: null,
      category: "skill", priority: "high", estimated_hours: 12, done: true, resources: [],
    },
    {
      id: "t2", title: "Build a Terraform module for AWS EKS cluster", description: null,
      category: "skill", priority: "high", estimated_hours: 8, done: true, resources: [],
    },
    {
      id: "t3", title: "Complete CKA study guide and mock exams", description: null,
      category: "certification", priority: "medium", estimated_hours: 20, done: true, resources: [],
    },
  ],
  target_jd: {
    title: "Staff Engineer",
    company: "Acme Corp",
    jd_text: "We are looking for a Staff Engineer with strong TypeScript, Kubernetes, Terraform, and AWS experience. Must have experience with distributed systems and CI/CD pipelines.",
  },
  locale: "en",
};

// ── Validators ────────────────────────────────────────────────────────────────

function countSentences(text: string): number {
  return text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
}

function validateOutput(output: OptimizedResumeOutput): { passed: boolean; errors: string[] } {
  const errors: string[] = [];
  const { resume_data, markdown, meta } = output;

  // Section presence
  for (const section of QUALITY.REQUIRED_RESUME_SECTIONS) {
    if (!(section in resume_data)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  // Highlights
  const hlCount = resume_data.highlights?.length ?? 0;
  if (hlCount < QUALITY.HIGHLIGHTS_MIN) {
    errors.push(`highlights count too low: ${hlCount} (min ${QUALITY.HIGHLIGHTS_MIN})`);
  }
  if (hlCount > QUALITY.HIGHLIGHTS_MAX) {
    errors.push(`highlights count too high: ${hlCount} (max ${QUALITY.HIGHLIGHTS_MAX})`);
  }

  // Cover letter sentence count
  const sentenceCount = countSentences(resume_data.cover_letter ?? "");
  if (sentenceCount < QUALITY.COVER_LETTER_MIN_SENTENCES) {
    errors.push(`cover_letter too short: ${sentenceCount} sentences (min ${QUALITY.COVER_LETTER_MIN_SENTENCES})`);
  }
  if (sentenceCount > QUALITY.COVER_LETTER_MAX_SENTENCES) {
    errors.push(`cover_letter too long: ${sentenceCount} sentences (max ${QUALITY.COVER_LETTER_MAX_SENTENCES})`);
  }

  // Skills
  const skillCount = resume_data.skills?.length ?? 0;
  if (skillCount < QUALITY.MIN_SKILLS) {
    errors.push(`skills count too low: ${skillCount} (min ${QUALITY.MIN_SKILLS})`);
  }

  // Keywords applied
  const kwCount = meta?.keywords_applied?.length ?? 0;
  if (kwCount < QUALITY.MIN_KEYWORDS_APPLIED) {
    errors.push(`keywords_applied count too low: ${kwCount} (min ${QUALITY.MIN_KEYWORDS_APPLIED})`);
  }

  // Markdown must include key headers
  if (!markdown.includes("##")) {
    errors.push("markdown missing section headers");
  }
  if (markdown.length < 200) {
    errors.push(`markdown too short: ${markdown.length} chars`);
  }

  return { passed: errors.length === 0, errors };
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function runEval() {
  console.log("[EVAL] ResumeOptimizerAgent eval started...\n");

  let output: OptimizedResumeOutput;
  try {
    output = await runResumeOptimizer(FIXTURE);
  } catch (err: any) {
    console.error("[EVAL] FAILED — runResumeOptimizer threw:", err?.message ?? err);
    process.exit(1);
  }

  const { passed, errors } = validateOutput(output);

  console.log("[EVAL] Output preview:");
  console.log("  personal.name:", output.resume_data.personal?.name);
  console.log("  job_title:", output.resume_data.personal?.job_title);
  console.log("  highlights:", output.resume_data.highlights?.length, "items");
  console.log("  skills:", output.resume_data.skills?.length, "items");
  console.log("  keywords_applied:", output.meta?.keywords_applied);
  console.log("  cover_letter sentences:", output.resume_data.cover_letter?.split(/[.!?]+/).filter(s => s.trim()).length);
  console.log("\n--- MARKDOWN PREVIEW (first 500 chars) ---");
  console.log(output.markdown.slice(0, 500));
  console.log("---\n");

  if (passed) {
    console.log("[EVAL] ✅ All quality gates PASSED");
  } else {
    console.error("[EVAL] ❌ Quality gates FAILED:");
    for (const e of errors) {
      console.error("  -", e);
    }
    process.exit(1);
  }
}

runEval().catch(err => {
  console.error("[EVAL] Unexpected error:", err);
  process.exit(1);
});
