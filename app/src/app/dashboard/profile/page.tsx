import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { CareerProfileClient } from "@/components/dashboard/CareerProfileClient";

interface RawStrength {
  category: string;
  item: string;
}

interface RawGap {
  category: string;
  item: string;
  priority: "high" | "medium" | "low";
  rationale?: string;
}

interface RawGapSummary {
  strengths?: RawStrength[];
  gaps?: RawGap[];
}

interface ProfilePageProps {
  searchParams: Promise<{ planId?: string }>;
}

interface PlanRow {
  id: string;
  target_role: string;
  target_company: string | null;
  created_at: string;
  application_status: string | null;
  notes: string | null;
  resumes: unknown;
  gap_analyses: unknown;
  roadmaps: unknown;
}

const CATEGORY_LABELS: Record<string, string> = {
  skill: "Skill",
  experience: "Experience",
  certification: "Cert",
  portfolio: "Portfolio",
  keyword: "Keyword",
};

const ALL_CATEGORIES = ["skill", "experience", "certification", "portfolio", "keyword"] as const;

function deriveCompetencies(strengths: RawStrength[], gaps: RawGap[]) {
  return ALL_CATEGORIES.map((cat) => {
    const s = strengths.filter((x) => x.category === cat).length;
    const g = gaps.filter((x) => x.category === cat).length;
    const total = s + g;
    const score = total > 0 ? Math.round((s / total) * 100) : 0;
    return { name: CATEGORY_LABELS[cat], score };
  });
}

function deriveFindings(gaps: RawGap[]) {
  return gaps.map((g) => ({
    text: g.rationale || g.item,
    priority: g.priority,
  }));
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const resolvedParams = await searchParams;

  const [profileResult, plansResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .single(),
    supabase
      .from("career_plans")
      .select(
        "id, target_role, target_company, created_at, application_status, notes, " +
        "resumes(created_at), " +
        "gap_analyses(summary_json), roadmaps(phases_json)"
      )
      .eq("user_id", user.id)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const profile = profileResult.data;
  const plans = (plansResult.data ?? []) as unknown as PlanRow[];

  const selectedPlanId = resolvedParams.planId;
  const plan = selectedPlanId
    ? (plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null)
    : (plans[0] ?? null);

  const planOptions = plans.map((p) => ({
    id: p.id,
    label: p.target_role,
    createdAt: p.created_at,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resumeRow = plan
    ? (Array.isArray((plan as any).resumes) ? (plan as any).resumes[0] : (plan as any).resumes)
    : null;

  const reportBasis = plan
    ? {
        resumeUploadedAt: (resumeRow as { created_at?: string } | null)?.created_at ?? null,
        planCreatedAt: plan.created_at,
        targetRole: plan.target_role,
        targetCompany: plan.target_company ?? "",
      }
    : null;

  const roadmap = plan ? (Array.isArray(plan.roadmaps) ? plan.roadmaps[0] : plan.roadmaps) : null;

  const gapRaw = plan
    ? (Array.isArray(plan.gap_analyses) ? plan.gap_analyses[0] : plan.gap_analyses)
    : null;
  const gapSummary = (gapRaw?.summary_json as RawGapSummary | null) ?? null;
  const competencies = deriveCompetencies(gapSummary?.strengths ?? [], gapSummary?.gaps ?? []);
  const findings = deriveFindings(gapSummary?.gaps ?? []);

  type WeekRow = { todos?: Array<{ done: boolean; title?: string; text?: string }> };
  const phases = Array.isArray((roadmap as { phases_json?: unknown } | null)?.phases_json)
    ? ((roadmap as { phases_json: WeekRow[] }).phases_json)
    : [];
  const nextTodos = phases
    .flatMap((w: WeekRow) => w.todos ?? [])
    .filter((t) => !t.done)
    .slice(0, 3)
    .map((t) => ({ done: t.done, text: t.title ?? t.text ?? "" }));

  return (
    <CareerProfileClient
      displayName={profile?.display_name ?? null}
      avatarUrl={profile?.avatar_url ?? null}
      targetRole={plan?.target_role ?? ""}
      targetCompany={plan?.target_company ?? ""}
      competencies={competencies}
      findings={findings}
      nextTodos={nextTodos}
      planOptions={planOptions}
      selectedPlanId={plan?.id ?? null}
      reportBasis={reportBasis}
      applicationStatus={plan?.application_status ?? null}
      notes={plan?.notes ?? null}
    />
  );
}
