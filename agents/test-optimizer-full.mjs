import { runResumeOptimizer } from "./dist/resume-optimizer/index.js";

const input = {
  resume_json: {
    personal: { name: "Sunjoo (Addie) Lee", email: "addiescode@gmail.com", links: ["linkedin.com/in/addie-lee-dev"], phone: "+82 10 8477 5819", location: null },
    summary: "Product Engineer with 5+ years experience",
    skills: { tools: ["Git"], others: ["Agentic AI"], languages: ["TypeScript"], frameworks: ["React","Next.js"] },
    projects: [{ url: null, name: "ReadMyCareer", role: "Creator", period: null, tech_stack: ["Next.js","TypeScript"], description: "AI career planning product", achievements: ["Implemented agentic workflows."] }],
    education: [{ gpa: null, major: "HCI", degree: "MSc", period: { end: "2019-11", start: "2018-08" }, institution: "University of Bath" }],
    languages: [{ language: "Korean", proficiency: "Native" }],
    experience: [{ title: "Lead Instructor", period: { end: "2026-02", start: "2023-09" }, company: "Codeit", location: "Seoul", description: null, achievements: ["Top satisfaction rating."] }],
    certifications: [{ date: "2022-01", name: "UX Design", issuer: "Brainstation" }]
  },
  gap_analysis: {
    target_role: "AI Frontend Engineer",
    gaps: [{ id: "g1", item: "Claude Code", category: "skill", priority: "high", rationale: "Required", current_level: null, required_level: "Familiarity" }],
    strengths: [{ id: "s1", item: "TypeScript", category: "skill", evidence: "Used in projects" }],
    priority_order: ["g1"],
    overall_match_score: 72,
    summary: "Strong frontend foundation."
  },
  completed_todos: [{ id: "t1", title: "Claude Code tutorial", description: null, category: "skill", priority: "high", estimated_hours: 4, done: true, resources: [] }],
  target_jd: { title: "AI Frontend Engineer", company: "Test Corp", jd_text: "Frontend engineer with Claude Code experience." },
  locale: "ko"
};

try {
  console.log("Starting...");
  const result = await runResumeOptimizer(input);
  console.log("SUCCESS - highlights:", result.resume_data?.highlights?.length);
} catch(err) {
  console.error("FAILED:", err.message);
}
