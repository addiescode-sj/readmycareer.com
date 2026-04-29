"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "./SignOutButton";

interface TodoProgress {
  done: boolean;
}

interface WeekProgress {
  week_number: number;
  date_range: { start: string; end: string };
  theme: string;
  todos: TodoProgress[];
}

interface Roadmap {
  summary: string | null;
  week_count: number | null;
  phases_json: unknown;
}

interface CareerPlan {
  id: string;
  title: string | null;
  target_role: string;
  target_company: string;
  status: "active" | "completed" | "archived";
  start_date: string | null;
  duration_weeks: number | null;
  created_at: string;
  roadmaps: Roadmap | Roadmap[] | null;
}

interface Profile {
  display_name: string | null;
  avatar_url: string | null;
}

interface Props {
  profile: Profile | null;
  initialPlans: CareerPlan[];
}

interface WeekEntry {
  weekStart: string;
  weekEnd: string;
  total: number;
  completed: number;
}

const STATUS_LABEL: Record<string, string> = {
  active: "진행 중",
  completed: "완료",
  archived: "보관됨",
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  archived: "bg-gray-100 text-gray-500",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(dateStr));
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
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

function buildWeeklyData(plans: CareerPlan[]): WeekEntry[] {
  const map = new Map<string, WeekEntry>();

  for (const plan of plans) {
    const roadmap = Array.isArray(plan.roadmaps) ? plan.roadmaps[0] : plan.roadmaps;
    const phases = roadmap?.phases_json;
    if (!Array.isArray(phases)) continue;

    for (const week of phases as WeekProgress[]) {
      const key = week.date_range?.start ?? `w${week.week_number}`;
      const entry = map.get(key) ?? {
        weekStart: week.date_range?.start ?? key,
        weekEnd: week.date_range?.end ?? "",
        total: 0,
        completed: 0,
      };
      for (const todo of (week.todos ?? [])) {
        entry.total++;
        if (String(todo.done) === "true" || todo.done === true) entry.completed++;
      }
      map.set(key, entry);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function progressColorClasses(pct: number): { card: string; bar: string; text: string } {
  if (pct === 0) return { card: "bg-gray-50 border-gray-200", bar: "bg-gray-300", text: "text-gray-300" };
  if (pct < 30) return { card: "bg-orange-50 border-orange-200", bar: "bg-orange-400", text: "text-orange-500" };
  if (pct < 60) return { card: "bg-yellow-50 border-yellow-200", bar: "bg-yellow-400", text: "text-yellow-600" };
  if (pct < 100) return { card: "bg-blue-50 border-blue-200", bar: "bg-blue-500", text: "text-blue-600" };
  return { card: "bg-green-50 border-green-200", bar: "bg-green-500", text: "text-green-600" };
}

function WeeklyAchievementChart({ plans }: { plans: CareerPlan[] }) {
  const weeks = buildWeeklyData(plans);
  if (weeks.length === 0) return null;

  const totalTodos = weeks.reduce((s, w) => s + w.total, 0);
  const totalCompleted = weeks.reduce((s, w) => s + w.completed, 0);
  const overallPct = totalTodos > 0 ? Math.round((totalCompleted / totalTodos) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">주차별 달성 현황</h3>
        <span className="text-xs text-gray-400">
          전체 {totalCompleted}/{totalTodos} 완료 ({overallPct}%)
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-2" style={{ minWidth: `${Math.max(weeks.length * 80, 320)}px` }}>
          {weeks.map((week, idx) => {
            const pct = week.total > 0 ? Math.round((week.completed / week.total) * 100) : 0;
            const colors = progressColorClasses(pct);

            return (
              <div
                key={`${week.weekStart}-${idx}`}
                className={`flex-none w-[76px] rounded-xl border p-2.5 ${colors.card}`}
              >
                <div className="text-xs text-gray-400 text-center mb-1 leading-none">
                  {formatShortDate(week.weekStart)}
                  {week.weekEnd && (
                    <span className="block text-[9px] text-gray-300">
                      ~{formatShortDate(week.weekEnd)}
                    </span>
                  )}
                </div>
                <div className={`text-xl font-bold text-center mb-1.5 ${colors.text}`}>
                  {pct}%
                </div>
                <div className="w-full h-1.5 bg-white/60 rounded-full mb-1.5 border border-white">
                  <div
                    className={`h-1.5 rounded-full transition-all ${colors.bar}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-[10px] text-gray-400 text-center">
                  {week.completed}/{week.total}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function DashboardClient({ profile, initialPlans }: Props) {
  const [plans, setPlans] = useState<CareerPlan[]>(initialPlans);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function syncUnsavedPlan() {
      if (sessionStorage.getItem("rmc_plan_saved") === "true") return;

      const rawSession = sessionStorage.getItem("rmc_session");
      if (!rawSession) return;

      try {
        const session = JSON.parse(rawSession);
        const { careerPlan, jdText, targetRole, targetCompany, gapAnalysis } = session;
        if (!careerPlan || !jdText) return;

        sessionStorage.setItem("rmc_plan_saved", "true");

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
          router.refresh();
        } else {
          sessionStorage.removeItem("rmc_plan_saved");
        }
      } catch (e) {
        console.error("Failed to sync unsaved plan", e);
        sessionStorage.removeItem("rmc_plan_saved");
      }
    }

    syncUnsavedPlan();
  }, [router]);

  async function handleDelete(planId: string) {
    setDeleting(true);
    const { error } = await supabase
      .from("career_plans")
      .delete()
      .eq("id", planId);

    if (!error) {
      setPlans((prev) => prev.filter((p) => p.id !== planId));
      router.refresh();
    }
    setConfirmDeleteId(null);
    setDeleting(false);
  }

  const displayName = profile?.display_name ?? "사용자";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto max-w-4xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">내 커리어 플랜</h1>
            <p className="text-sm text-gray-500 mt-0.5">저장된 플랜을 관리하세요</p>
          </div>
          <div className="flex items-center gap-3">
            {profile?.avatar_url && (
              <img
                src={profile.avatar_url}
                alt={displayName}
                width={36}
                height={36}
                className="rounded-full border border-gray-200"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="text-sm font-medium text-gray-700">{displayName}</span>
            <SignOutButton />
          </div>
        </div>

        {/* New plan button */}
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <span>+</span>
            새 플랜 시작하기
          </Link>
        </div>

        {/* Weekly achievement chart */}
        {plans.length > 0 && <WeeklyAchievementChart plans={plans} />}

        {/* Plan list */}
        {plans.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-gray-200">
            <p className="text-gray-400 text-sm mb-3">저장된 커리어 플랜이 없습니다.</p>
            <Link href="/" className="text-blue-600 text-sm hover:underline">
              첫 플랜을 만들어보세요 →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {plans.map((plan) => {
              const roadmap = Array.isArray(plan.roadmaps)
                ? plan.roadmaps[0]
                : plan.roadmaps;
              const weekCount = roadmap?.week_count ?? plan.duration_weeks;
              const progress = computeProgress(roadmap?.phases_json);

              return (
                <div
                  key={plan.id}
                  onClick={() => router.push(`/dashboard/${plan.id}`)}
                  className="bg-white rounded-2xl border border-gray-200 px-6 py-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-base font-semibold text-gray-900 truncate group-hover:text-blue-700 transition-colors">
                          {plan.title ?? plan.target_role}
                        </h2>
                        <span
                          className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[plan.status] ?? STATUS_COLOR.active}`}
                        >
                          {STATUS_LABEL[plan.status] ?? plan.status}
                        </span>
                      </div>
                      {plan.target_company && (
                        <p className="text-sm text-gray-500">{plan.target_company}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                        {plan.start_date && (
                          <span>시작: {formatDate(plan.start_date)}</span>
                        )}
                        {weekCount && <span>{weekCount}주 계획</span>}
                      </div>

                      {/* Progress bar */}
                      {progress.total > 0 && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>{progress.completed}/{progress.total} 완료</span>
                            <span className={`font-medium ${progressColorClasses(progress.pct).text}`}>
                              {progress.pct}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full transition-all ${progressColorClasses(progress.pct).bar}`}
                              style={{ width: `${progress.pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Delete button */}
                    {confirmDeleteId === plan.id ? (
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-gray-500">정말 삭제할까요?</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(plan.id); }}
                          disabled={deleting}
                          className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {deleting ? "삭제 중..." : "삭제"}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                          disabled={deleting}
                          className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          취소
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(plan.id); }}
                        className="shrink-0 px-3 py-1.5 text-xs text-gray-500 border border-transparent group-hover:border-gray-200 rounded-lg hover:!border-red-300 hover:!text-red-600 transition-colors"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
