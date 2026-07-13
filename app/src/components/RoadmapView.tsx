"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";
import {
  beginPlanSave,
  finishPlanSave,
  isPlanSaved,
  isPlanSaveBlockedByLimit,
  markPlanSaveLimitReached,
  markPlanSaveSucceeded,
  PLAN_LIMIT_REACHED,
} from "@/lib/plan-save-session";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

interface TodoItem {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: "high" | "medium" | "low";
  estimated_hours: number;
  done: boolean;
  resources: { type: string; label: string; url: string | null }[];
}

interface WeekPlan {
  week_number: number;
  date_range: { start: string; end: string };
  theme: string;
  milestone: string | null;
  todos: TodoItem[];
}

interface CareerPlan {
  plan_id: string;
  summary: string;
  target_jd_title?: string;
  duration_weeks: number;
  start_date: string;
  end_date: string;
  weeks: WeekPlan[];
}

interface Props {
  plan: Record<string, unknown>;
  onStartChat: () => void;
  onTodoToggle: (weekNumber: number, todoId: string, done: boolean) => void;
  hideSaveBanner?: boolean;
  hideChat?: boolean;
}

// MILESTONES moved inside RunnerTrack to use t() hook

function RunnerCharacter({ isRunning }: { isRunning: boolean }) {
  const dur = "0.38s";
  const frameA = isRunning ? { animation: `run-frame-a ${dur} steps(1,end) infinite` } : {};
  const frameB = isRunning ? { animation: `run-frame-b ${dur} steps(1,end) infinite` } : { opacity: 0 };
  const bob = isRunning ? { animation: `runner-stride ${dur} ease-in-out infinite` } : {};

  // Colors from user's SVG
  const cHair = "#1A1A1A";
  const cSkin = "#F8C8B1";
  const cTop = "#FF9500";
  const cBottom = "#2E7DFF";
  const cShoe = "#1A1A1A";

  return (
    <svg width="42" height="42" viewBox="0 0 24 24" shapeRendering="crispEdges"
      style={{ overflow: "visible", display: "block" }}>
      <g style={bob}>

        {/* Frame A: Back Limbs */}
        <g style={frameA}>
          {/* Back Arm (Down/Back) */}
          <rect x="9" y="10" width="1" height="1" fill={cSkin} />
          <rect x="8" y="11" width="1" height="2" fill={cSkin} />
          <rect x="7" y="13" width="1" height="1" fill={cSkin} />

          {/* Back Leg (Kicked Back) */}
          <rect x="8" y="15" width="2" height="1" fill={cSkin} />
          <rect x="6" y="16" width="2" height="1" fill={cSkin} />
          <rect x="5" y="17" width="1" height="2" fill={cSkin} />
          <rect x="3" y="18" width="2" height="1" fill={cShoe} />
        </g>

        {/* Frame B: Back Limbs (Up/Forward) */}
        <g style={frameB}>
          {/* Back Arm (Up/Forward) shifted -6x from Front Arm */}
          <rect x="9" y="9" width="1" height="1" fill={cSkin} />
          <rect x="10" y="8" width="2" height="1" fill={cSkin} />
          <rect x="11" y="7" width="1" height="1" fill={cSkin} />

          {/* Back Leg (Straight/Forward) shifted -3x from Front Leg */}
          <rect x="10" y="15" width="2" height="2" fill={cSkin} />
          <rect x="11" y="17" width="2" height="2" fill={cSkin} />
          <rect x="12" y="19" width="1" height="2" fill={cSkin} />
          <rect x="12" y="21" width="2" height="1" fill={cShoe} />
        </g>

        {/* Always-visible: Head, Hair, Torso, Shorts */}
        {/* Hair (Ponytail) */}
        <rect x="5" y="4" width="3" height="1" fill={cHair} />
        <rect x="4" y="5" width="5" height="1" fill={cHair} />
        <rect x="3" y="6" width="6" height="1" fill={cHair} />
        <rect x="2" y="7" width="5" height="1" fill={cHair} />

        {/* Head & Main Hair */}
        <rect x="10" y="3" width="5" height="1" fill={cHair} />
        <rect x="9" y="4" width="7" height="1" fill={cHair} />
        <rect x="9" y="5" width="2" height="3" fill={cHair} />
        <rect x="11" y="5" width="5" height="4" fill={cSkin} />
        <rect x="15" y="5" width="1" height="1" fill={cHair} />

        {/* Torso (Orange Top) */}
        <rect x="10" y="9" width="4" height="4" fill={cTop} />
        <rect x="14" y="10" width="1" height="3" fill={cTop} />

        {/* Shorts (Blue) */}
        <rect x="10" y="13" width="5" height="2" fill={cBottom} />
        <rect x="10" y="15" width="2" height="1" fill={cBottom} />

        {/* Frame A: Front Limbs */}
        <g style={frameA}>
          {/* Front Arm (Up/Forward) */}
          <rect x="15" y="9" width="1" height="1" fill={cSkin} />
          <rect x="16" y="8" width="2" height="1" fill={cSkin} />
          <rect x="17" y="7" width="1" height="1" fill={cSkin} />

          {/* Front Leg (Straight/Forward) */}
          <rect x="13" y="15" width="2" height="2" fill={cSkin} />
          <rect x="14" y="17" width="2" height="2" fill={cSkin} />
          <rect x="15" y="19" width="1" height="2" fill={cSkin} />
          <rect x="15" y="21" width="2" height="1" fill={cShoe} />
        </g>

        {/* Frame B: Front Limbs (Down/Back) */}
        <g style={frameB}>
          {/* Front Arm (Down/Back) shifted +6x from Back Arm */}
          <rect x="15" y="10" width="1" height="1" fill={cSkin} />
          <rect x="14" y="11" width="1" height="2" fill={cSkin} />
          <rect x="13" y="13" width="1" height="1" fill={cSkin} />

          {/* Front Leg (Kicked Back) shifted +4x from Back Leg */}
          <rect x="12" y="15" width="2" height="1" fill={cSkin} />
          <rect x="10" y="16" width="2" height="1" fill={cSkin} />
          <rect x="9" y="17" width="1" height="2" fill={cSkin} />
          <rect x="7" y="18" width="2" height="1" fill={cShoe} />
        </g>

        {/* Speed Lines */}
        {isRunning && (
          <g>
            <rect x="1" y="11" width="2" height="1" fill={cTop} opacity="0.3" />
            <rect x="0" y="15" width="3" height="1" fill={cBottom} opacity="0.3" />
          </g>
        )}
      </g>
    </svg>
  );
}

interface WeekStat {
  week_number: number;
  theme: string;
  done: number;
  total: number;
  pct: number;
}

function WeekProgressBar({ weeks, overallPct }: {
  weeks: WeekStat[];
  overallPct: number;
}) {
  const t = useTranslations("RoadmapView");

  return (
    <div className="space-y-6">
      {/* Per-week segmented bars */}
      <div className="flex gap-3">
        {weeks.map((w, i) => (
          <div key={w.week_number} className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className={cn(
                "text-[9px] font-black uppercase tracking-widest",
                w.pct === 100 ? "text-primary" : "text-muted-foreground"
              )}>
                W{w.week_number}
              </span>
              {w.pct > 0 && (
                <span className="text-[9px] font-black text-primary">{w.pct}%</span>
              )}
            </div>
            <div className="h-2.5 rounded-full bg-surface-container overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${w.pct}%` }}
                transition={{ duration: 0.8, delay: i * 0.08, ease: "easeOut" }}
                className={cn(
                  "h-full rounded-full",
                  w.pct === 100
                    ? "bg-primary shadow-[0_0_8px_rgba(107,56,212,0.5)]"
                    : w.pct > 0
                      ? "bg-gradient-to-r from-primary/50 to-primary"
                      : ""
                )}
              />
            </div>
            <p className="text-[9px] font-semibold text-muted-foreground/60 truncate leading-none">
              {w.theme.split(" ").slice(0, 3).join(" ")}
            </p>
          </div>
        ))}
      </div>

      {/* Overall completion row */}
      <div className="flex items-center justify-between pt-3 border-t border-border/30">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {t("architecturalCompletion")}
        </span>
        <div className="flex items-center gap-3">
          <div className="w-28 h-1.5 rounded-full bg-surface-container overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-secondary to-tertiary transition-all duration-1000"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <span className="text-2xl font-black tracking-tighter text-primary tabular-nums">
            {overallPct}%
          </span>
        </div>
      </div>
    </div>
  );
}

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-green-100 text-green-700",
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function convertToMarkdown(typedPlan: CareerPlan): string {
  const title = typedPlan.target_jd_title ?? "Career Plan";
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push(`**Summary:** ${typedPlan.summary}`);
  lines.push(`**Period:** ${typedPlan.start_date} ~ ${typedPlan.end_date} (${typedPlan.duration_weeks} weeks)`);
  lines.push("");
  lines.push("| Week | Theme | Date Range | Milestone | Task | Category | Priority | Est. Hours |");
  lines.push("|------|-------|------------|-----------|------|----------|----------|------------|");

  for (const week of typedPlan.weeks) {
    const milestone = week.milestone ? escapeCell(week.milestone) : "-";
    const dateRange = `${week.date_range.start} ~ ${week.date_range.end}`;
    for (const todo of week.todos) {
      lines.push(
        `| ${week.week_number} | ${escapeCell(week.theme)} | ${dateRange} | ${milestone} | ${escapeCell(todo.title)} | ${todo.category} | ${todo.priority} | ${todo.estimated_hours}h |`
      );
    }
  }

  return lines.join("\n");
}

type SaveStatus = "idle" | "saving" | "saved" | "error" | "limit_reached";

function SaveBanner() {
  const t = useTranslations("RoadmapView");
  const { careerPlan, gapAnalysis, targetRole, targetCompany, jdText, resumeJson } = useSession();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [oauthLoading, setOauthLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    // Restore saved state from this browser session
    if (isPlanSaved()) {
      setSaveStatus("saved");
    } else if (isPlanSaveBlockedByLimit()) {
      setSaveStatus("limit_reached");
    }

    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setIsLoggedIn(!!session?.user);

        // Auto-save when user signs in and plan is ready in session
        if (event === "SIGNED_IN" && session?.user && careerPlan) {
          if (!beginPlanSave()) return;
          if (!jdText) {
            // Old session without jdText — can't save
            finishPlanSave();
            setSaveStatus("error");
            return;
          }

          setSaveStatus("saving");
          try {
            const res = await fetch("/api/career-plans", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                targetRole: targetRole ?? "",
                targetCompany: targetCompany ?? "",
                jdText,
                resumeJson: resumeJson ?? undefined,
                careerPlan,
                gapAnalysis: gapAnalysis ?? {},
              }),
            });

            if (res.ok) {
              markPlanSaveSucceeded();
              setSaveStatus("saved");
            } else {
              const body = await res.json().catch(() => ({})) as Record<string, string>;
              if (body["error"] === PLAN_LIMIT_REACHED) {
                markPlanSaveLimitReached();
                setSaveStatus("limit_reached");
              } else {
                finishPlanSave();
                setSaveStatus("error");
              }
            }
          } catch {
            finishPlanSave();
            setSaveStatus("error");
          }
        }
      }
    );
    return () => subscription.unsubscribe();
    // Intentionally omit careerPlan/jdText from deps — snapshot is taken on SIGNED_IN
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signInWithGoogle() {
    setOauthLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
      },
    });
  }

  async function retrySave() {
    if (!careerPlan || !jdText) return;
    if (!beginPlanSave()) return;
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/career-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRole: targetRole ?? "",
          targetCompany: targetCompany ?? "",
          jdText,
          resumeJson: resumeJson ?? undefined,
          careerPlan,
          gapAnalysis: gapAnalysis ?? {},
        }),
      });
      if (res.ok) {
        markPlanSaveSucceeded();
        setSaveStatus("saved");
      } else {
        const body = await res.json().catch(() => ({})) as Record<string, string>;
        if (body["error"] === PLAN_LIMIT_REACHED) {
          markPlanSaveLimitReached();
          setSaveStatus("limit_reached");
        } else {
          finishPlanSave();
          setSaveStatus("error");
        }
      }
    } catch {
      finishPlanSave();
      setSaveStatus("error");
    }
  }

  if (isLoggedIn === null) return null;

  if (saveStatus === "saving") {
    return (
      <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-6 py-4">
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
        <p className="text-sm text-blue-700">{t("saving")}</p>
      </div>
    );
  }

  if (saveStatus === "saved") {
    return (
      <div className="flex items-center justify-between gap-4 bg-green-50 border border-green-200 rounded-2xl px-6 py-4">
        <p className="text-sm font-medium text-green-800">✓ {t("saved")}</p>
        <button
          onClick={() => { window.location.href = "/dashboard"; }}
          className="text-sm text-green-700 underline hover:text-green-900 bg-transparent p-0 cursor-pointer"
        >
          {t("viewInDashboard")}
        </button>
      </div>
    );
  }

  if (saveStatus === "limit_reached") {
    return (
      <div className="flex items-center justify-between gap-4 bg-yellow-50 border border-yellow-200 rounded-2xl px-6 py-4">
        <p className="text-sm text-yellow-800">
          {t("quotaExceeded")}
        </p>
        <button
          onClick={() => { window.location.href = "/dashboard"; }}
          className="text-sm text-yellow-700 underline hover:text-yellow-900 whitespace-nowrap bg-transparent p-0 cursor-pointer"
        >
          {t("goToDashboard")}
        </button>
      </div>
    );
  }

  if (saveStatus === "error") {
    return (
      <div className="flex items-center justify-between gap-4 bg-red-50 border border-red-200 rounded-2xl px-6 py-4">
        <p className="text-sm text-red-700">{t("saveFailed")}</p>
        {jdText && (
          <button
            onClick={retrySave}
            className="text-sm text-red-700 underline hover:text-red-900 whitespace-nowrap"
          >
            {t("retry")}
          </button>
        )}
      </div>
    );
  }

  // Not logged in — show save prompt
  if (!isLoggedIn) {
    return (
      <div className="flex items-center justify-between gap-4 bg-blue-50 border border-blue-200 rounded-2xl px-6 py-4">
        <div>
          <p className="text-sm font-medium text-blue-900">
            {t("savePrompt")}
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            {t("loginToPersist")}
          </p>
        </div>
        <button
          onClick={signInWithGoogle}
          disabled={oauthLoading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-blue-300 rounded-lg shadow-sm hover:shadow-md hover:bg-blue-50 transition-all text-blue-700 text-sm font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {oauthLoading ? (
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          )}
          {t("saveWithGoogle")}
        </button>
      </div>
    );
  }

  return null;
}

function initExpandedWeeks(weeks: WeekPlan[]): Set<number> {
  const expanded = new Set<number>();
  for (const week of weeks) {
    if (week.todos.some((todo) => String(todo.done) === "true" || todo.done === true)) {
      expanded.add(week.week_number);
    }
  }
  if (expanded.size === 0) expanded.add(1);
  return expanded;
}

export default function RoadmapView({ plan, onStartChat, onTodoToggle, hideSaveBanner, hideChat }: Props) {
  const t = useTranslations("RoadmapView");
  const typedPlan = plan as unknown as CareerPlan;
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() =>
    initExpandedWeeks(typedPlan.weeks ?? [])
  );
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(convertToMarkdown(typedPlan));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!typedPlan.weeks?.length) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  const { totalTodosCount, completedTodosCount } = (typedPlan.weeks || []).reduce(
    (acc, week) => {
      const weekTodos = week.todos || [];
      acc.totalTodosCount += weekTodos.length;
      acc.completedTodosCount += weekTodos.filter((todo) => String(todo.done) === "true").length;
      return acc;
    },
    { totalTodosCount: 0, completedTodosCount: 0 }
  );

  const progressPercentage = totalTodosCount > 0
    ? Math.round((completedTodosCount / totalTodosCount) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-10">
      {!hideSaveBanner && <SaveBanner />}

      {/* Summary card */}
      <div className="glass-card rounded-2xl p-6 shadow-2xl shadow-primary/5">
        <div className="flex flex-col lg:flex-row items-start justify-between gap-5 mb-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-6 bg-primary rounded-full shadow-[0_0_10px_rgba(139,92,246,0.5)] shrink-0" />
              <h2 className="text-base font-black tracking-tight text-foreground">
                {typedPlan.target_jd_title ?? t("defaultTitle")}
              </h2>
            </div>
            <p className="text-sm font-medium text-muted-foreground leading-relaxed">{typedPlan.summary}</p>
          </div>

          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              onClick={handleCopy}
              className="px-4 py-2 border border-border bg-background text-foreground font-bold text-sm rounded-xl hover:bg-muted transition-all"
            >
              {copied ? t("copied") : t("copyMarkdown")}
            </button>
            {!hideChat && (
              <button
                onClick={onStartChat}
                className="px-4 py-2 bg-primary text-primary-foreground font-bold text-sm rounded-xl hover:opacity-90 transition-all shadow-xl shadow-primary/20"
              >
                {t("chatButton")}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 text-xs font-black uppercase tracking-widest text-primary/60 mb-6">
          <span className="flex items-center gap-2">
            <span className="opacity-50">{t("timeline")}:</span>
            {typedPlan.start_date} — {typedPlan.end_date}
          </span>
          <span className="flex items-center gap-2">
            <span className="opacity-50">{t("duration")}:</span>
            {typedPlan.duration_weeks} {t("cyclesUnit")}
          </span>
        </div>

        {/* Per-week progress */}
        <WeekProgressBar
          weeks={typedPlan.weeks.map((w) => {
            const done = w.todos.filter((todo) => String(todo.done) === "true").length;
            const total = w.todos.length;
            return {
              week_number: w.week_number,
              theme: w.theme,
              done,
              total,
              pct: total > 0 ? Math.round((done / total) * 100) : 0,
            };
          })}
          overallPct={progressPercentage}
        />
      </div>

      {/* Weekly protocol */}
      <div className="grid grid-cols-1 gap-4">
        {typedPlan.weeks.map((week) => (
          <div
            key={week.week_number}
            className={cn(
              "glass-card rounded-2xl overflow-hidden transition-all duration-500",
              expandedWeeks.has(week.week_number) ? "ring-2 ring-primary/20 shadow-2xl" : "opacity-80"
            )}
          >
            {/* Week header */}
            <button
              className="w-full flex items-center justify-between p-4 text-left hover:bg-primary/5 transition-colors group"
              onClick={() =>
                setExpandedWeeks((prev) => {
                  const next = new Set(prev);
                  if (next.has(week.week_number)) {
                    next.delete(week.week_number);
                  } else {
                    next.add(week.week_number);
                  }
                  return next;
                })
              }
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black transition-all shrink-0",
                  expandedWeeks.has(week.week_number) ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30" : "bg-muted text-muted-foreground"
                )}>
                  {week.week_number}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary mb-0.5">{t("cycleLabel", { n: week.week_number })}</p>
                  <p className="text-sm font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">{week.theme}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t("protocolsCount", { count: week.todos.length })}</p>
                  <p className="text-[9px] font-bold text-primary mt-0.5 max-w-[160px] truncate">{week.milestone || t("defaultMilestone")}</p>
                </div>
                <div className={cn(
                  "w-7 h-7 rounded-full border border-border flex items-center justify-center transition-transform text-muted-foreground",
                  expandedWeeks.has(week.week_number) ? "rotate-180" : ""
                )}>
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            </button>

            {/* Todo list */}
            <AnimatePresence>
              {expandedWeeks.has(week.week_number) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-2 space-y-3">
                    {week.todos.map((todo) => (
                      <div
                        key={todo.id}
                        className={cn(
                          "group/item p-4 rounded-xl border transition-all",
                          todo.done ? "bg-primary/5 border-primary/20 opacity-60" : "bg-background border-border hover:border-primary/30"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <label className="relative flex items-center cursor-pointer shrink-0 mt-0.5">
                            <input
                              type="checkbox"
                              checked={todo.done}
                              onChange={(e) => onTodoToggle(week.week_number, todo.id, e.target.checked)}
                              className="peer sr-only"
                            />
                            <div className="w-5 h-5 border-2 border-muted-foreground/30 rounded-md peer-checked:bg-primary peer-checked:border-primary transition-all shadow-sm" />
                            <div className="absolute inset-0 flex items-center justify-center text-white opacity-0 peer-checked:opacity-100 transition-opacity text-xs">
                              ✓
                            </div>
                          </label>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <h4 className={cn(
                                "text-sm font-bold text-foreground transition-all leading-snug",
                                todo.done && "line-through text-muted-foreground"
                              )}>
                                {todo.title}
                              </h4>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={cn(
                                  "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border",
                                  todo.priority === "high" ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-muted text-muted-foreground border-border"
                                )}>
                                  {todo.priority}
                                </span>
                                <span className="text-[10px] font-black text-muted-foreground uppercase tabular-nums">
                                  {todo.estimated_hours}h
                                </span>
                              </div>
                            </div>
                            {todo.description && (
                              <p className="text-sm text-muted-foreground leading-relaxed">{todo.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}
