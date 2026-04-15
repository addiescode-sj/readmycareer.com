// ─── Shared Types across all Sub-Agents ───────────────────────────────────────
// This file defines session state keys and data types shared by all three agents.

// ── Session State Keys ────────────────────────────────────────────────────────
export const SESSION_KEYS = {
  RESUME_JSON: "resume_json",
  JD_TEXT: "jd_text",
  GAP_ANALYSIS: "gap_analysis",
  CAREER_PLAN: "career_plan",
  CHAT_HISTORY: "chat_history",
} as const;

// ── Resume without personal info (used for gap analysis and career planning) ──
export type ResumeJsonForAnalysis = Omit<ResumeJson, "personal">;

/** Strips personal contact info before passing resume to analysis agents. */
export function omitPersonal(resume: ResumeJson): ResumeJsonForAnalysis {
  const { personal: _personal, ...rest } = resume;
  return rest;
}

// ── GapAnalyzerAgent I/O ──────────────────────────────────────────────────────
export interface GapAnalysisInput {
  resume_json: ResumeJsonForAnalysis;
  jd_text: string;
}

export interface GapAnalysisOutput {
  target_role: string;
  strengths: StrengthItem[];
  gaps: GapItem[];
  priority_order: string[];              // ordered list of gap item ids (high → low)
  overall_match_score: number;           // 0~100
  summary: string;
}

export interface StrengthItem {
  id: string;
  category: "skill" | "experience" | "certification" | "portfolio" | "keyword";
  item: string;
  evidence: string;                      // evidence text found in the resume
}

export interface GapItem {
  id: string;
  category: "skill" | "experience" | "certification" | "portfolio" | "keyword";
  item: string;
  current_level: string | null;
  required_level: string | null;
  priority: "high" | "medium" | "low";
  rationale: string;                     // explanation of why this gap matters
}

// ── PlannerAgent I/O ──────────────────────────────────────────────────────────
export interface PlannerInput {
  gap_analysis: GapAnalysisOutput;
  duration_weeks: number;
  start_date: string;                    // YYYY-MM-DD
  preferences?: {
    hours_per_week?: number;
    learning_style?: "online_course" | "book" | "project" | "mixed";
  };
}

export interface CareerPlanOutput {
  plan_id: string;
  created_at: string;
  summary: string;
  start_date: string;
  end_date: string;
  duration_weeks: number;
  weeks: WeekPlan[];
  timeline: TimelineData;
}

export interface WeekPlan {
  week_number: number;
  date_range: { start: string; end: string };
  theme: string;
  milestone: string | null;
  todos: TodoItem[];
}

export interface TodoItem {
  id: string;
  title: string;
  description: string | null;
  category: GapItem["category"];
  priority: GapItem["priority"];
  estimated_hours: number;
  done: boolean;
  resources: Resource[];
}

export interface Resource {
  type: "url" | "book" | "course" | "tool";
  label: string;
  url: string | null;
}

export interface TimelineData {
  milestones: { week: number; date: string; label: string }[];
  gantt_rows: {
    task: string;
    start_week: number;
    end_week: number;
    category: GapItem["category"];
  }[];
}

// ── ChatQnAAgent I/O ──────────────────────────────────────────────────────────
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ChatQnAInput {
  user_message: string;
  session_context: {
    resume_json?: ResumeJson;
    gap_analysis?: GapAnalysisOutput;
    career_plan?: CareerPlanOutput;
    chat_history?: ChatMessage[];
  };
}

export interface ChatQnAOutput {
  answer: string;
  sources: {
    type: "rag" | "gap_analysis" | "career_plan" | "resume";
    excerpt: string;
    doc_title?: string;
  }[];
  follow_up_suggestions: string[];
  updated_chat_history: ChatMessage[];
}

// ── Shared Domain Types ───────────────────────────────────────────────────────
// (same structure as ResumeJsonSchema in the pdf-word-to-json skill)
export interface ResumeJson {
  personal: {
    name: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    links: string[];
  };
  summary: string | null;
  education: EducationEntry[];
  skills: {
    languages: string[];
    frameworks: string[];
    tools: string[];
    others: string[];
  };
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
  languages: { language: string; proficiency: string | null }[];
}

interface EducationEntry {
  institution: string;
  degree: string | null;
  major: string | null;
  period: { start: string; end: string | null };
  gpa: string | null;
}

interface ExperienceEntry {
  company: string;
  title: string;
  period: { start: string; end: string | null };
  location: string | null;
  description: string | null;
  achievements: string[];
}

interface ProjectEntry {
  name: string;
  period: { start: string; end: string | null } | null;
  role: string | null;
  tech_stack: string[];
  description: string | null;
  achievements: string[];
  url: string | null;
}

interface CertificationEntry {
  name: string;
  issuer: string | null;
  date: string | null;
}

export interface JdSearchResult {
  doc_id: string;
  doc_type: "jd" | "reference";
  title: string;
  score: number;
  text: string;
}
