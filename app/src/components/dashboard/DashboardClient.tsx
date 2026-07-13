"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./SignOutButton";
import { useTranslations, useLocale } from "next-intl";

import { CompetencyRadar } from "@/components/ui/CompetencyRadarLazy";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  beginPlanSave,
  clearPlanSaveLimitBlock,
  clearPlanSaveState,
  finishPlanSave,
  isPlanSaveBlockedByLimit,
  markPlanSaveLimitReached,
  markPlanSaveSucceeded,
  PLAN_LIMIT_REACHED,
} from "@/lib/plan-save-session";
import {
  careerPlansKey,
  useCareerPlans,
  useDeleteCareerPlan,
  useUpdateCareerPlanTitle,
  type CareerPlanRow,
} from "@/hooks/useCareerPlans";

interface GapAnalysis {
  competencies: Array<{ name: string; requiredScore: number; preferredScore: number }>;
  findings: Array<{ text: string; priority: "high" | "medium" | "low" }>;
}

interface RawStrength {
  category: string;
  item: string;
  evidence?: string;
}

interface RawGap {
  category: string;
  item: string;
  priority: "high" | "medium" | "low";
  requirement_type?: "required" | "preferred";
  rationale?: string;
}

interface RawGapSummary {
  strengths?: RawStrength[];
  gaps?: RawGap[];
}

const CATEGORY_LABELS: Record<string, string> = {
  skill: "Skill",
  experience: "Experience",
  certification: "Cert",
  portfolio: "Portfolio",
  keyword: "Keyword",
};

// Fixed order ensures a consistent pentagon; all 5 always present so we never render a line
const ALL_CATEGORIES = ["skill", "experience", "certification", "portfolio", "keyword"] as const;

function deriveGapAnalysis(summaryJson: unknown): GapAnalysis | null {
  if (!summaryJson || typeof summaryJson !== "object") return null;
  const raw = summaryJson as RawGapSummary;
  const strengths = raw.strengths ?? [];
  const gaps = raw.gaps ?? [];
  if (strengths.length === 0 && gaps.length === 0) return null;

  const isRequired = (g: RawGap) =>
    g.requirement_type === "required" || (!g.requirement_type && g.priority === "high");

  const competencies = ALL_CATEGORIES.map((cat) => {
    const s = strengths.filter((x) => x.category === cat).length;
    const reqGaps = gaps.filter((x) => x.category === cat && isRequired(x)).length;
    const prefGaps = gaps.filter((x) => x.category === cat && !isRequired(x)).length;

    const reqTotal = s + reqGaps;
    const prefTotal = s + prefGaps;

    const requiredScore = reqTotal > 0 ? Math.round((s / reqTotal) * 100) : 100;
    const preferredScore = prefTotal > 0 ? Math.round((s / prefTotal) * 100) : 100;

    return { name: CATEGORY_LABELS[cat], requiredScore, preferredScore };
  });

  const findings = gaps.map((g) => ({
    text: g.rationale || g.item,
    priority: g.priority,
  }));

  return { competencies, findings };
}

interface TodoProgress {
  done: boolean;
}

interface WeekProgress {
  week_number: number;
  date_range: { start: string; end: string };
  theme: string;
  todos: TodoProgress[];
}

interface Profile {
  display_name: string | null;
  avatar_url: string | null;
}

interface Props {
  profile: Profile | null;
}

const STATUS_COLOR: Record<string, string> = {
  active: "bg-secondary/10 text-secondary border border-secondary/20",
  completed: "bg-primary/10 text-primary border border-primary/20",
  archived: "bg-muted text-muted-foreground border border-border",
};

function formatDate(dateStr: string | null, locale: string): string {
  if (!dateStr) return "-";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(dateStr));
}

function computeProgress(phases: unknown): { total: number; completed: number; pct: number } {
  if (!Array.isArray(phases)) return { total: 0, completed: 0, pct: 0 };
  let total = 0;
  let completed = 0;
  for (const week of phases as WeekProgress[]) {
    for (const todo of (week.todos ?? [])) {
      total++;
      if (String(todo.done) === "true" || todo.done === true) completed++;
    }
  }
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pct };
}

export function DashboardClient({ profile }: Props) {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Server state (React Query) ──────────────────────────────────────────────
  const { data: plans = [] } = useCareerPlans();
  const deletePlan = useDeleteCareerPlan();
  const updateTitle = useUpdateCareerPlanTitle();

  // ── Client state (UI only) ──────────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [unsavedPlanError, setUnsavedPlanError] = useState<"limit_reached" | "missing_resume" | null>(
    null
  );

  // Refresh plans when page is restored from bfcache (browser back/forward)
  useEffect(() => {
    function handlePageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        queryClient.invalidateQueries({ queryKey: careerPlansKey() });
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [queryClient]);

  // Save any plan that was created during the onboarding flow but not yet persisted.
  // Extracted as a stable callback (not just inline in the mount effect) so handleDelete can
  // retry it after freeing up a plan slot — otherwise a limit-blocked save stays stuck until
  // the user starts a brand new plan (see plan-save-session.ts's clearPlanSaveLimitBlock).
  const syncUnsavedPlan = useCallback(async () => {
    if (isPlanSaveBlockedByLimit()) {
      setUnsavedPlanError("limit_reached");
      return;
    }
    if (!beginPlanSave()) return;

    const rawSession = sessionStorage.getItem("rmc_session");
    if (!rawSession) {
      finishPlanSave();
      return;
    }

    try {
      const session = JSON.parse(rawSession);
      const { careerPlan, jdText, targetRole, targetCompany, gapAnalysis, resumeJson } = session;
      if (!careerPlan || !jdText) {
        finishPlanSave();
        return;
      }

      // useSession() deliberately never persists resumeJson to sessionStorage (kept in-memory
      // only), and this recovery path only has sessionStorage to read from — so resumeJson is
      // never actually available here. Saving anyway would silently create a plan with
      // resume_json = null, which permanently breaks /api/resume-optimizer for it later. Block
      // instead of writing a plan we know is missing data.
      if (!resumeJson) {
        finishPlanSave();
        setUnsavedPlanError("missing_resume");
        return;
      }

      const res = await fetch("/api/career-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRole: targetRole ?? "",
          targetCompany: targetCompany ?? "",
          jdText,
          resumeJson,
          careerPlan,
          gapAnalysis: gapAnalysis ?? {},
        }),
      });

      if (res.ok) {
        markPlanSaveSucceeded();
        setUnsavedPlanError(null);
        queryClient.invalidateQueries({ queryKey: careerPlansKey() });
      } else {
        const body = await res.json().catch(() => ({})) as Record<string, string>;
        if (body["error"] === PLAN_LIMIT_REACHED) {
          markPlanSaveLimitReached();
          setUnsavedPlanError("limit_reached");
        } else {
          finishPlanSave();
        }
      }
    } catch (e) {
      console.error("Failed to sync unsaved plan", e);
      finishPlanSave();
    }
  }, [queryClient]);

  useEffect(() => {
    syncUnsavedPlan();
  }, [syncUnsavedPlan]);

  function startEditTitle(plan: CareerPlanRow, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingPlanId(plan.id);
    setEditingTitle(plan.title ?? plan.target_role);
  }

  async function handleSaveTitle(planId: string) {
    const trimmed = editingTitle.trim();
    if (!trimmed) return;
    await updateTitle.mutateAsync({ planId, title: trimmed });
    setEditingPlanId(null);
  }

  function cancelEditTitle() {
    setEditingPlanId(null);
    setEditingTitle("");
  }

  async function handleDelete(planId: string) {
    await deletePlan.mutateAsync(planId);
    setConfirmDeleteId(null);
    // Deleting a plan frees a slot — retry a save that was previously blocked by the 3-plan limit.
    if (unsavedPlanError === "limit_reached") {
      clearPlanSaveLimitBlock();
      setUnsavedPlanError(null);
      syncUnsavedPlan();
    }
  }

  function handleNewPlan(e: React.MouseEvent) {
    e.preventDefault();
    sessionStorage.removeItem("rmc_session");
    clearPlanSaveState();
    router.push("/?new=true");
  }

  const displayName = profile?.display_name ?? t("defaultUserName");

  return (
    <div className="min-h-screen bg-transparent">
      {/* Header */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        className="mb-12"
        action={
          <div className="flex items-center gap-4 bg-white/50 backdrop-blur-sm border border-border p-2 rounded-2xl pr-4">
            {profile?.avatar_url && (
              <img
                src={profile.avatar_url}
                alt={displayName}
                width={40}
                height={40}
                className="rounded-xl border border-border shadow-sm"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground leading-none">{displayName}</span>
            </div>
          </div>
        }
      />

      {unsavedPlanError === "limit_reached" && (
        <div className="mb-8 rounded-2xl border border-yellow-200 bg-yellow-50 px-6 py-4 text-sm text-yellow-900">
          {t("planLimitReached")}
        </div>
      )}

      {unsavedPlanError === "missing_resume" && (
        <div className="mb-8 rounded-2xl border border-yellow-200 bg-yellow-50 px-6 py-4 text-sm text-yellow-900">
          {t("planMissingResume")}
        </div>
      )}

      {/* Plan list */}
      {plans.length === 0 ? (
        <div className="text-center py-32 glass-card rounded-[32px] shadow-sm">
          <div className="w-20 h-20 bg-muted rounded-3xl flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl">📐</span>
          </div>
          <p className="text-lg font-bold text-foreground mb-2">{t("noPlans")}</p>
          <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">{t("emptyStateDescription")}</p>
          <button
            onClick={handleNewPlan}
            className="inline-flex items-center gap-3 px-8 py-4 bg-primary text-primary-foreground font-bold rounded-2xl hover:opacity-90 transition-all shadow-xl shadow-primary/25"
          >
            <span>+</span>
            {t("newPlanButton")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          {plans.map((plan) => {
            const roadmap = Array.isArray(plan.roadmaps) ? plan.roadmaps[0] : plan.roadmaps;
            const weekCount = roadmap?.week_count ?? plan.duration_weeks;
            const progress = computeProgress(roadmap?.phases_json);
            const gapRaw = Array.isArray(plan.gap_analyses) ? plan.gap_analyses[0] : plan.gap_analyses;
            const gapAnalysis = deriveGapAnalysis(gapRaw?.summary_json);

            return (
              <div
                key={plan.id}
                onClick={() => router.push(`/dashboard/${plan.id}`)}
                className="glass-card rounded-[32px] p-8 shadow-sm hover:shadow-2xl hover:shadow-primary/5 hover:border-primary/30 transition-all cursor-pointer group relative overflow-hidden"
              >
                {/* Background Decoration */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-primary/10 transition-colors" />

                <div className="flex flex-col lg:flex-row gap-10">
                  {/* Info Section */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-4" onClick={(e) => e.stopPropagation()}>
                      {editingPlanId === plan.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            autoFocus
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveTitle(plan.id);
                              if (e.key === "Escape") cancelEditTitle();
                            }}
                            className="flex-1 bg-muted/50 border border-primary/30 rounded-xl px-3 py-1.5 text-xl font-bold focus:outline-none focus:ring-4 focus:ring-primary/10"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 flex-wrap w-full">
                          <h2 className="text-2xl font-black tracking-tight text-foreground group-hover:text-primary transition-colors">
                            {plan.title ?? plan.target_role}
                          </h2>
                          <span className={cn(
                            "text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full border",
                            plan.status === "active" ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground border-border"
                          )}>
                            {t(`status.${plan.status}`)}
                          </span>
                          <div className="flex items-center gap-4 ml-auto">
                            <button
                              onClick={(e) => startEditTitle(plan, e)}
                              className="text-muted-foreground/30 hover:text-primary transition-colors"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(plan.id); }}
                              className="px-2.5 py-1 rounded-full border border-destructive/30 text-destructive/60 text-[10px] font-black uppercase tracking-widest hover:bg-destructive/10 hover:border-destructive hover:text-destructive transition-all"
                            >
                              {t("terminatePlan")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-4 mb-8">
                      <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                        <span className="w-5 h-5 bg-muted rounded flex items-center justify-center text-[10px]">🏢</span>
                        {plan.target_company}
                      </div>
                      <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                        <span className="w-5 h-5 bg-muted rounded flex items-center justify-center text-[10px]">⏱️</span>
                        {weekCount} {t("weeksUnit")}
                      </div>
                      <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
                        <span className="w-5 h-5 bg-muted rounded flex items-center justify-center text-[10px]">📅</span>
                        {formatDate(plan.start_date, locale)}
                      </div>
                    </div>

                    {/* Findings Cards */}
                    {gapAnalysis?.findings && (
                      <div className="space-y-3 mb-8">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-4">{t("evidenceBasedFindings")}</h4>
                        {gapAnalysis.findings.slice(0, 2).map((finding, idx) => (
                          <div key={idx} className="flex items-start gap-3 p-4 rounded-2xl bg-muted/30 border border-border/50">
                            <span className={cn(
                              "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest mt-0.5",
                              finding.priority === "high"
                                ? "bg-primary/10 text-primary border border-primary/20"
                                : finding.priority === "medium"
                                  ? "bg-secondary/10 text-secondary border border-secondary/20"
                                  : "bg-muted text-muted-foreground border border-border"
                            )}>
                              {t(`priorityLabels.${finding.priority}`)}
                            </span>
                            <p className="text-sm font-medium text-foreground/80 leading-relaxed">{finding.text}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Progress */}
                    {progress.total > 0 && (
                      <div className="mt-auto pt-6 border-t border-border/50">
                        <div className="flex justify-between items-end mb-3">
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{t("architecturalCompletion")}</span>
                          <span className="text-2xl font-black tracking-tighter text-primary">{progress.pct}%</span>
                        </div>
                        <div className="w-full h-3 bg-muted rounded-full overflow-hidden p-0.5 border border-border">
                          <div
                            className="h-full rounded-full bg-primary shadow-[0_0_10px_rgba(139,92,246,0.5)] transition-all duration-1000"
                            style={{ width: `${progress.pct}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Chart Section */}
                  <div className="w-full lg:w-[300px] shrink-0 flex flex-col items-center justify-center p-6 bg-primary/5 rounded-[32px] border border-primary/10">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-primary mb-2">{t("competencyRadar")}</h4>
                    {gapAnalysis?.competencies ? (
                      <CompetencyRadar data={gapAnalysis.competencies} height={260} outerRadius="58%" margin={{ top: 16, right: 24, bottom: 16, left: 24 }} />
                    ) : (
                      <div className="h-[200px] flex items-center justify-center text-muted-foreground text-xs italic">
                        {t("noCompetencyData")}
                      </div>
                    )}
                    <div className="mt-6 w-full">
                      <button className="w-full py-3 bg-white border border-primary/20 text-primary font-bold text-sm rounded-xl hover:bg-primary hover:text-white transition-all shadow-sm">
                        {t("openFullRoadmap")}
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}>
          <div className="glass-card rounded-[32px] p-10 max-w-md w-full shadow-2xl border-destructive/20 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 bg-destructive/10 rounded-2xl flex items-center justify-center mb-6">
              <span className="text-3xl">⚠️</span>
            </div>
            <h3 className="text-2xl font-black tracking-tight text-foreground mb-2">{t("terminatePlanConfirm")}</h3>
            <p className="text-muted-foreground text-sm mb-8 leading-relaxed">{t("terminatePlanWarning")}</p>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="py-4 rounded-2xl border border-border font-bold text-sm hover:bg-muted transition-all"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
                disabled={deletePlan.isPending}
                className="py-4 rounded-2xl bg-destructive text-destructive-foreground font-bold text-sm hover:opacity-90 transition-all shadow-xl shadow-destructive/20"
              >
                {deletePlan.isPending ? t("deleting") : t("confirmDelete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
