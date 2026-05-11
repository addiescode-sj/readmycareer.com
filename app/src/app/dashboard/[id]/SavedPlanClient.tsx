"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AICoachChat } from "@/components/ui/AICoachChat";
import { CompetencyRadar } from "@/components/ui/CompetencyRadar";
import RoadmapView from "@/components/RoadmapView";
import { OptimizedResumeModal } from "@/components/OptimizedResumeModal";
import { createClient } from "@/lib/supabase/client";

interface Competency { name: string; score: number }
interface Finding { text: string; priority: "high" | "medium" | "low" }

interface CareerPlan {
  plan_id: string;
  title: string | null;
  target_role: string;
  target_company: string;
  summary: string;
  duration_weeks: number;
  start_date: string;
  end_date: string;
  weeks: unknown[];
  gap_analysis: { competencies?: Competency[]; findings?: Finding[] } | null;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-primary/10 text-primary border border-primary/20",
  medium: "bg-secondary/10 text-secondary border border-secondary/20",
  low: "bg-muted text-muted-foreground border border-border",
};

const SEMI_CIRC = Math.PI * 90;
const SEMI_CIRC_INNER = Math.PI * 72;

function OverallReadinessGauge({ pct, progressPct }: { pct: number; progressPct: number }) {
  const offset = SEMI_CIRC * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const progressOffset = SEMI_CIRC_INNER * (1 - Math.min(100, Math.max(0, progressPct)) / 100);
  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        viewBox="0 0 200 120"
        className="w-full max-w-[240px]"
        style={{ filter: "drop-shadow(0 0 10px rgba(139,92,246,0.35))" }}
        aria-label={`Overall readiness: ${pct}%, checklist progress: ${progressPct}%`}
      >
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#39b8fd" />
          </linearGradient>
        </defs>
        {/* Outer track */}
        <path
          d="M 10 100 A 90 90 0 0 1 190 100"
          fill="none"
          stroke="rgba(139,92,246,0.12)"
          strokeWidth="16"
          strokeLinecap="round"
        />
        {/* Outer progress arc — AI match % */}
        <path
          d="M 10 100 A 90 90 0 0 1 190 100"
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={SEMI_CIRC}
          strokeDashoffset={offset}
        />
        {/* Inner track */}
        <path
          d="M 28 100 A 72 72 0 0 1 172 100"
          fill="none"
          stroke="rgba(14,165,233,0.12)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Inner progress arc — checklist completion */}
        <path
          d="M 28 100 A 72 72 0 0 1 172 100"
          fill="none"
          stroke="#0EA5E9"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={SEMI_CIRC_INNER}
          strokeDashoffset={progressOffset}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        {/* Percentage */}
        <text
          x="100"
          y="78"
          textAnchor="middle"
          fontSize="38"
          fontWeight="900"
          fill="hsl(258 66% 53%)"
          fontFamily="Inter, sans-serif"
        >
          {pct}%
        </text>
        {/* MATCH label */}
        <text
          x="100"
          y="97"
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fill="hsl(var(--muted-foreground))"
          letterSpacing="3"
          fontFamily="Inter, sans-serif"
        >
          MATCH
        </text>
        {/* Checklist progress label */}
        <text
          x="100"
          y="113"
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          fill="#0EA5E9"
          letterSpacing="2"
          fontFamily="Inter, sans-serif"
        >
          {progressPct}% DONE
        </text>
      </svg>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
        Overall Readiness
      </p>
    </div>
  );
}

export default function SavedPlanClient({
  careerPlan,
  planId,
}: {
  careerPlan: CareerPlan;
  planId: string;
}) {
  const t = useTranslations("GapAnalysisDashboard");
  const tProfile = useTranslations("CareerProfile");
  const tRoadmap = useTranslations("RoadmapView");
  const router = useRouter();
  const [plan, setPlan] = useState(careerPlan);
  const [chatOpen, setChatOpen] = useState(false);
  const [isOptimizeLoading, setIsOptimizeLoading] = useState(false);
  const [isOptimizeStatusLoading, setIsOptimizeStatusLoading] = useState(true);
  const [isOptimizeComplete, setIsOptimizeComplete] = useState(false);
  const [cachedOptimizedResume, setCachedOptimizedResume] = useState<Record<string, unknown> | null>(null);
  const [optimizedResume, setOptimizedResume] = useState<Record<string, unknown> | null>(null);
  const supabase = createClient();

  // Load existing optimized resume on mount so the button reflects persisted state
  useEffect(() => {
    supabase
      .from("optimized_resumes")
      .select("id, resume_data, markdown, meta, locale, created_at")
      .eq("career_plan_id", planId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCachedOptimizedResume(data as unknown as Record<string, unknown>);
          setIsOptimizeComplete(true);
        }
        setIsOptimizeStatusLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const competencies = plan.gap_analysis?.competencies ?? [];
  const findings = plan.gap_analysis?.findings ?? [];
  const overallPct =
    competencies.length > 0
      ? Math.round(
          competencies.reduce((s, c) => s + c.score, 0) / competencies.length
        )
      : 0;

  const allTodos = (plan.weeks as Array<{ todos?: Array<{ done: boolean }> }>)
    .flatMap(w => w.todos ?? []);
  const progressPct =
    allTodos.length > 0
      ? Math.round(allTodos.filter(t => t.done).length / allTodos.length * 100)
      : 0;
  const isAllDone = allTodos.length > 0 && progressPct === 100;

  async function handleTodoToggle(
    weekNumber: number,
    todoId: string,
    done: boolean
  ) {
    const updatedWeeks = (plan.weeks as Array<Record<string, unknown>>).map(
      (week) => {
        if (week["week_number"] !== weekNumber) return week;
        return {
          ...week,
          todos: (week["todos"] as Array<Record<string, unknown>>).map((todo) =>
            todo["id"] === todoId ? { ...todo, done } : todo
          ),
        };
      }
    );
    const newPlan = { ...plan, weeks: updatedWeeks };
    setPlan(newPlan);
    await supabase
      .from("roadmaps")
      .update({ phases_json: updatedWeeks })
      .eq("career_plan_id", planId);
    router.refresh();
  }

  async function handleOptimizeResume() {
    if (isOptimizeComplete && cachedOptimizedResume) {
      setOptimizedResume(cachedOptimizedResume);
      return;
    }
    setIsOptimizeLoading(true);
    try {
      const res = await fetch("/api/resume-optimizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ career_plan_id: planId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[OptimizeResume] API error:", err);
        return;
      }
      const data = await res.json();
      setCachedOptimizedResume(data);
      setOptimizedResume(data);
      setIsOptimizeComplete(true);
    } finally {
      setIsOptimizeLoading(false);
    }
  }

  return (
    <div className="space-y-10 pb-16 max-w-5xl">
      {/* Back nav */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
      >
        ← {t("backToDashboard")}
      </Link>

      {/* ── GAP ANALYSIS ── */}
      <section className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-headline-lg font-bold text-foreground tracking-tight">
              {t("title")}
            </h1>
            <p className="text-body-md text-muted-foreground mt-1">
              <span className="text-label-sm uppercase tracking-widest">
                {tProfile("targetRole")}:{" "}
              </span>
              <span className="font-semibold text-foreground">
                {plan.target_role}
              </span>
              {plan.target_company && (
                <>
                  <span className="mx-2 text-muted-foreground/40">·</span>
                  <span className="text-label-sm uppercase tracking-widest">
                    {tProfile("targetCompany")}:{" "}
                  </span>
                  <span className="font-semibold text-foreground">
                    {plan.target_company}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="relative group shrink-0">
            {isOptimizeStatusLoading ? (
              <div className="h-9 w-36 rounded-xl bg-muted animate-pulse" />
            ) : (
              <>
                <button
                  onClick={handleOptimizeResume}
                  disabled={isOptimizeLoading || (!isOptimizeComplete && !isAllDone)}
                  className={cn(
                    "px-4 py-2 font-bold text-sm rounded-xl transition-all whitespace-nowrap",
                    isOptimizeComplete
                      ? "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                      : isAllDone && !isOptimizeLoading
                      ? "bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90 shadow-xl shadow-primary/20"
                      : "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                  )}
                >
                  {isOptimizeLoading
                    ? tRoadmap("optimizingResume")
                    : isOptimizeComplete
                    ? tRoadmap("optimizeResumeComplete")
                    : tRoadmap("optimizeResume")}
                </button>
                {!isAllDone && !isOptimizeComplete && (
                  <div className="absolute top-full right-0 mt-2 w-56 text-xs text-center bg-popover border border-border rounded-lg px-3 py-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-normal">
                    {tRoadmap("optimizeResumeTooltip")}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Readiness gauge + Radar */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card rounded-2xl p-8 flex flex-col items-center justify-center synthetic-glow min-h-[240px]">
            <OverallReadinessGauge pct={overallPct} progressPct={progressPct} />
          </div>

          <div className="glass-card rounded-2xl p-6 space-y-4">
            <h2 className="font-bold text-foreground text-sm">
              {tProfile("competencies")}
            </h2>
            {competencies.length > 0 ? (
              <CompetencyRadar
                data={competencies}
                height={240}
                outerRadius="60%"
                margin={{ top: 16, right: 24, bottom: 16, left: 24 }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {tProfile("noFindings")}
              </p>
            )}
          </div>
        </div>

        {/* Evidence-Based Findings */}
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-foreground text-sm">
            {tProfile("findings")}
          </h2>
          {findings.length > 0 ? (
            <ul className="space-y-3">
              {findings.map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest mt-0.5",
                      PRIORITY_STYLES[f.priority]
                    )}
                  >
                    {tProfile(
                      `priority${f.priority.charAt(0).toUpperCase()}${f.priority.slice(1)}` as Parameters<typeof tProfile>[0]
                    )}
                  </span>
                  <p className="text-sm text-foreground leading-relaxed">
                    {f.text}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {tProfile("noFindings")}
            </p>
          )}
        </div>
      </section>

      {/* ── ROADMAP ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-headline-lg font-bold text-foreground tracking-tight">
            {t("roadmap")}
          </h2>
          {plan.summary && (
            <p className="text-body-md text-muted-foreground mt-1">
              {plan.summary}
            </p>
          )}
        </div>
        <RoadmapView
          plan={plan as unknown as Record<string, unknown>}
          onStartChat={() => setChatOpen(true)}
          onTodoToggle={handleTodoToggle}
          hideSaveBanner={true}
        />
      </section>

      <AICoachChat
        isOpen={chatOpen}
        onOpenChange={setChatOpen}
        planId={planId}
        targetRole={plan.target_role}
        targetCompany={plan.target_company}
        gapAnalysis={plan.gap_analysis as Record<string, unknown> | null}
      />

      {optimizedResume && (
        <OptimizedResumeModal
          data={optimizedResume}
          onClose={() => setOptimizedResume(null)}
        />
      )}
    </div>
  );
}
