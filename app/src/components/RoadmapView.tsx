"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useSession } from "@/hooks/useSession";

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
}

const MILESTONES: [number, string][] = [
  [30,  "30% 달성! 잘하고 있어요 👏"],
  [60,  "60% 완료! 절반 넘었어요 💪"],
  [90,  "90% 달성! 거의 다 왔어요 🔥"],
  [100, "완주! 대단해요! 🏆"],
];

function RunnerCharacter({ isRunning }: { isRunning: boolean }) {
  const dur = "0.38s";
  const frameA = isRunning ? { animation: `run-frame-a ${dur} steps(1,end) infinite` } : {};
  const frameB = isRunning ? { animation: `run-frame-b ${dur} steps(1,end) infinite` } : { opacity: 0 };
  const bob    = isRunning ? { animation: `runner-stride ${dur} ease-in-out infinite` } : {};

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

function RunnerTrack({
  progress,
  completedCount,
  totalCount,
}: {
  progress: number;
  completedCount: number;
  totalCount: number;
}) {
  const prevRef = useRef(progress);
  const [milestoneMsg, setMilestoneMsg] = useState<string | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    for (const [m, label] of MILESTONES) {
      if (prev < m && progress >= m) {
        setMilestoneMsg(label);
        const t = setTimeout(() => setMilestoneMsg(null), 3000);
        prevRef.current = progress;
        return () => clearTimeout(t);
      }
    }
    prevRef.current = progress;
  }, [progress]);

  // Clamp so runner stays visible within the track
  const runnerLeft = Math.min(93, Math.max(0, progress));
  const isRunning = progress > 0 && progress < 100;
  const isDone = progress >= 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">전체 진행률</span>
          <span className="text-xs text-gray-400 tabular-nums">({completedCount}/{totalCount} 완료)</span>
        </div>
        <span className="text-xs font-semibold text-gray-700 tabular-nums">{progress}%</span>
      </div>

      {/* Milestone celebration */}
      {milestoneMsg && (
        <div className="text-center text-xs font-bold text-yellow-800 bg-yellow-100 border border-yellow-200 rounded-lg py-1.5 mb-2 animate-bounce">
          {milestoneMsg}
        </div>
      )}

      {/* Track container */}
      <div
        className="relative rounded-xl overflow-hidden select-none"
        style={{ height: "62px", background: "#F8FAFC" }}
      >
        {/* Completed fill */}
        <div
          className="absolute inset-y-0 left-0 transition-all duration-700"
          style={{
            width: `${progress}%`,
            background: isDone
              ? "linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)"
              : "linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%)",
          }}
        />

        {/* Ground */}
        <div className="absolute bottom-3 left-0 right-0 h-px bg-gray-300" />

        {/* Dashed path ahead of runner */}
        <div
          className="absolute bottom-3 right-0 h-px"
          style={{
            left: `${progress}%`,
            background:
              "repeating-linear-gradient(90deg, #D1D5DB 0px, #D1D5DB 6px, transparent 6px, transparent 12px)",
          }}
        />

        {/* Milestone notches at 30 / 60 / 90 */}
        {[30, 60, 90].map((m) => (
          <div
            key={m}
            className="absolute flex flex-col items-center pointer-events-none"
            style={{ left: `${m}%`, bottom: "3px", transform: "translateX(-50%)" }}
          >
            <div className="w-px h-3 bg-gray-400/50" />
          </div>
        ))}

        {/* Finish flag */}
        <div className="absolute right-2 bottom-3 text-base leading-none" style={{ transform: "translateY(-2px)" }}>
          {isDone ? "🏆" : "🏁"}
        </div>

        {/* Runner */}
        <div
          className="absolute bottom-3 transition-all duration-1000 ease-in-out"
          style={{ left: `${runnerLeft}%`, transform: "translateX(-50%) translateY(-2px)" }}
        >
          <RunnerCharacter isRunning={isRunning} />
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
  const { careerPlan, gapAnalysis, targetRole, targetCompany, jdText } = useSession();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [oauthLoading, setOauthLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    // Restore saved state from this browser session
    if (sessionStorage.getItem("rmc_plan_saved") === "true") {
      setSaveStatus("saved");
    }

    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setIsLoggedIn(!!session?.user);

        // Auto-save when user signs in and plan is ready in session
        if (event === "SIGNED_IN" && session?.user && careerPlan) {
          if (sessionStorage.getItem("rmc_plan_saved") === "true") return;
          if (!jdText) {
            // Old session without jdText — can't save
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
                careerPlan,
                gapAnalysis: gapAnalysis ?? {},
              }),
            });

            if (res.ok) {
              sessionStorage.setItem("rmc_plan_saved", "true");
              setSaveStatus("saved");
            } else {
              const body = await res.json().catch(() => ({})) as Record<string, string>;
              setSaveStatus(body["error"] === "plan_limit_reached" ? "limit_reached" : "error");
            }
          } catch {
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
    setSaveStatus("saving");
    try {
      const res = await fetch("/api/career-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRole: targetRole ?? "",
          targetCompany: targetCompany ?? "",
          jdText,
          careerPlan,
          gapAnalysis: gapAnalysis ?? {},
        }),
      });
      if (res.ok) {
        sessionStorage.setItem("rmc_plan_saved", "true");
        setSaveStatus("saved");
      } else {
        const body = await res.json().catch(() => ({})) as Record<string, string>;
        setSaveStatus(body["error"] === "plan_limit_reached" ? "limit_reached" : "error");
      }
    } catch {
      setSaveStatus("error");
    }
  }

  if (isLoggedIn === null) return null;

  if (saveStatus === "saving") {
    return (
      <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-6 py-4">
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
        <p className="text-sm text-blue-700">플랜을 저장하는 중...</p>
      </div>
    );
  }

  if (saveStatus === "saved") {
    return (
      <div className="flex items-center justify-between gap-4 bg-green-50 border border-green-200 rounded-2xl px-6 py-4">
        <p className="text-sm font-medium text-green-800">✓ 플랜이 저장되었습니다!</p>
        <button
          onClick={() => { window.location.href = "/dashboard"; }}
          className="text-sm text-green-700 underline hover:text-green-900 bg-transparent p-0 cursor-pointer"
        >
          대시보드에서 보기 →
        </button>
      </div>
    );
  }

  if (saveStatus === "limit_reached") {
    return (
      <div className="flex items-center justify-between gap-4 bg-yellow-50 border border-yellow-200 rounded-2xl px-6 py-4">
        <p className="text-sm text-yellow-800">
          저장 가능한 플랜 수(3개)에 도달했습니다. 대시보드에서 기존 플랜을 삭제한 후 다시 시도해 주세요.
        </p>
        <button
          onClick={() => { window.location.href = "/dashboard"; }}
          className="text-sm text-yellow-700 underline hover:text-yellow-900 whitespace-nowrap bg-transparent p-0 cursor-pointer"
        >
          대시보드 →
        </button>
      </div>
    );
  }

  if (saveStatus === "error") {
    return (
      <div className="flex items-center justify-between gap-4 bg-red-50 border border-red-200 rounded-2xl px-6 py-4">
        <p className="text-sm text-red-700">플랜 저장에 실패했습니다.</p>
        {jdText && (
          <button
            onClick={retrySave}
            className="text-sm text-red-700 underline hover:text-red-900 whitespace-nowrap"
          >
            다시 시도
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
            이 플랜을 저장하고 싶으신가요?
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            Google로 로그인하면 브라우저를 닫아도 플랜이 유지됩니다.
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
          Google로 저장하기
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

export default function RoadmapView({ plan, onStartChat, onTodoToggle, hideSaveBanner }: Props) {
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
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
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
    <div className="flex flex-col gap-6">
      {!hideSaveBanner && <SaveBanner />}

      {/* Summary card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {typedPlan.target_jd_title ?? t("defaultTitle")}
            </h2>
            <p className="text-sm text-gray-500 mt-4 w-full">{typedPlan.summary}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              {copied ? t("copied") : t("copyMarkdown")}
            </button>
            <button
              onClick={onStartChat}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              {t("chatButton")}
            </button>
          </div>
        </div>

        <div className="flex gap-4 text-sm text-gray-600 mb-4">
          <span>📅 {typedPlan.start_date} ~ {typedPlan.end_date}</span>
          <span>📋 {typedPlan.duration_weeks}{t("weeksUnit")}</span>
        </div>

        {/* Runner progress track */}
        <RunnerTrack
          progress={progressPercentage}
          completedCount={completedTodosCount}
          totalCount={totalTodosCount}
        />
      </div>

      {/* Weekly plan */}
      <div className="flex flex-col gap-3">
        {typedPlan.weeks.map((week) => (
          <div
            key={week.week_number}
            className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
          >
            {/* Week header */}
            <button
              className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
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
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold">
                  {week.week_number}
                </span>
                <div>
                  <p className="font-medium text-gray-900">{week.theme}</p>
                  <p className="text-xs text-gray-400">
                    {week.date_range.start} ~ {week.date_range.end}
                    {week.milestone && ` · 🏁 ${week.milestone}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{t("todoCount", { count: week.todos.length })}</span>
                <span className="text-gray-400">
                  {expandedWeeks.has(week.week_number) ? "▲" : "▼"}
                </span>
              </div>
            </button>

            {/* Todo list */}
            {expandedWeeks.has(week.week_number) && (
              <div className="border-t border-gray-100 px-5 pb-4">
                {week.todos.map((todo) => (
                  <div key={todo.id} className="py-3 border-b border-gray-50 last:border-0">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={todo.done}
                        onChange={(e) => onTodoToggle(week.week_number, todo.id, e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">
                            {todo.title}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGE[todo.priority]}`}
                          >
                            {todo.priority}
                          </span>
                          <span className="text-xs text-gray-400">
                            ~{todo.estimated_hours}h
                          </span>
                        </div>
                        {todo.description && (
                          <p className="text-xs text-gray-500 mt-1">{todo.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
