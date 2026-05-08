"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { AICoachChat } from "@/components/ui/AICoachChat";
import { RoadmapVelocityChart } from "@/components/ui/RoadmapVelocityChart";
import { PageHeader } from "@/components/ui/PageHeader";

interface Todo {
  done: boolean;
  title?: string;
  text?: string;
  priority?: string;
  estimated_hours?: number;
}

interface Week {
  week_number: number;
  theme: string;
  date_range?: { start: string; end: string };
  todos: Todo[];
}

interface PlanOption {
  id: string;
  label: string;
  createdAt: string;
}

interface Props {
  weeks: Week[];
  planTitle: string;
  planId: string;
  targetRole: string;
  targetCompany: string | null;
  gapAnalysis: Record<string, unknown> | null;
  planOptions: PlanOption[];
  selectedPlanId: string;
}

const PHASE_COLORS = [
  { bg: "bg-primary/10", text: "text-primary", border: "border-primary/20", active: "bg-primary" },
  { bg: "bg-secondary/10", text: "text-secondary", border: "border-secondary/20", active: "bg-secondary" },
  { bg: "bg-tertiary/10", text: "text-tertiary", border: "border-tertiary/20", active: "bg-tertiary" },
];

function getPhase(weekIndex: number, total: number): number {
  const ratio = weekIndex / total;
  if (ratio < 0.33) return 0;
  if (ratio < 0.67) return 1;
  return 2;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function RoadmapTimelineClient({
  weeks,
  planTitle,
  planId,
  targetRole,
  targetCompany,
  gapAnalysis,
  planOptions,
  selectedPlanId,
}: Props) {
  const t = useTranslations("DashboardRoadmap");
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  const phaseLabels = [t("phasePrep"), t("phaseDive"), t("phaseApply")];
  const today = new Date();

  const activeWeekIndex = weeks.findIndex((w) => {
    if (!w.date_range) return false;
    const start = new Date(w.date_range.start);
    const end = new Date(w.date_range.end);
    return today >= start && today <= end;
  });

  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number>(
    activeWeekIndex >= 0 ? activeWeekIndex : 0
  );
  const [chatOpen, setChatOpen] = useState(false);

  const totalTasks = weeks.reduce((s, w) => s + w.todos.length, 0);
  const doneTasks = weeks.reduce((s, w) => s + w.todos.filter((todo) => todo.done).length, 0);
  const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  function handlePlanChange(id: string) {
    router.push(`/dashboard/roadmap?planId=${id}`);
  }

  const selectedWeek = weeks[selectedWeekIndex];

  return (
    <>
      <div className="flex flex-col gap-6 h-[calc(100vh-theme(spacing.32))] min-h-0 min-w-[320px] overflow-y-auto pr-2">
        <div className="flex flex-col gap-6">

          {/* Header */}
          <PageHeader
            title={t("title")}
            subtitle={planTitle}
            action={planOptions.length > 1 ? (
              <div className="relative">
                <select
                  value={selectedPlanId}
                  onChange={(e) => handlePlanChange(e.target.value)}
                  className="appearance-none text-sm font-semibold bg-muted/50 border border-border rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
                  aria-label={t("selectPlan")}
                >
                  {planOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label} — {t("planCreatedOn", { date: formatDate(opt.createdAt) })}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M2 3.5L5.5 7L9 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            ) : undefined}
          />

          {/* Phase progress bar */}
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-3 flex-wrap">
                {phaseLabels.map((label, i) => {
                  const c = PHASE_COLORS[i]!;
                  return (
                    <div key={label} className={cn("flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border", c.bg, c.text, c.border)}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", c.active)} />
                      {label}
                    </div>
                  );
                })}
              </div>
              <span className="text-label-sm uppercase tracking-widest text-muted-foreground">
                {overallPct}% {t("progress")}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary via-secondary to-tertiary transition-all duration-700"
                style={{ width: `${overallPct}%` }}
              />
            </div>
          </div>

          {/* Velocity chart */}
          <RoadmapVelocityChart weeks={weeks} doneTasks={doneTasks} totalTasks={totalTasks} />

          {/* Horizontal scrollable week cards */}
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto pt-1 pb-4 snap-x snap-mandatory"
            style={{ scrollbarColor: "hsl(var(--outline-variant)) transparent", scrollbarWidth: "thin" }}
          >
            {weeks.map((week, i) => {
              const phase = getPhase(i, weeks.length);
              const c = PHASE_COLORS[phase]!;
              const done = week.todos.filter((todo) => todo.done).length;
              const total = week.todos.length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const isActive = i === activeWeekIndex;
              const isSelected = i === selectedWeekIndex;

              return (
                <motion.div
                  key={week.week_number}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.3 }}
                  onClick={() => setSelectedWeekIndex(i)}
                  className={cn(
                    "shrink-0 w-52 snap-start rounded-2xl p-4 flex flex-col gap-3 border transition-all cursor-pointer",
                    isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-synthetic-md"
                      : isSelected
                      ? "glass-card border-primary/40 ring-2 ring-primary/30 shadow-synthetic"
                      : "glass-card border-border/50 hover:border-primary/30 hover:shadow-synthetic",
                  )}
                >
                  {/* Status badge */}
                  <div className={cn(
                    "self-start px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest",
                    isActive ? "bg-white/20 text-white" : cn(c.bg, c.text),
                  )}>
                    {isActive ? t("weekActive") : phaseLabels[phase]}
                  </div>

                  {/* Week info */}
                  <div>
                    <p className={cn("text-[10px] font-black uppercase tracking-widest mb-0.5", isActive ? "text-white/60" : "text-muted-foreground")}>
                      {t("weekLabel", { n: week.week_number })}
                    </p>
                    <p className={cn("font-bold text-sm leading-snug line-clamp-2", isActive ? "text-white" : "text-foreground")}>
                      {week.theme}
                    </p>
                  </div>

                  {/* Progress */}
                  <div className="space-y-1">
                    <div className={cn("h-1 rounded-full overflow-hidden", isActive ? "bg-white/20" : "bg-surface-container")}>
                      <div
                        className={cn("h-full rounded-full transition-all duration-700", isActive ? "bg-white" : "bg-primary")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className={cn("text-[10px] font-semibold", isActive ? "text-white/70" : "text-muted-foreground")}>
                      {t("tasksCompleted", { done, total })}
                    </p>
                  </div>

                  {/* Top todo preview */}
                  {week.todos[0] && (
                    <p className={cn("text-[11px] leading-relaxed line-clamp-2 mt-auto", isActive ? "text-white/80" : "text-muted-foreground")}>
                      {week.todos[0].title ?? week.todos[0].text ?? ""}
                    </p>
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Selected week task list */}
          {selectedWeek && (
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <h2 className="text-sm font-black uppercase tracking-widest text-foreground">
                {t("weekLabel", { n: selectedWeek.week_number })} — {selectedWeek.theme}
              </h2>
              <ol className="space-y-2.5 list-none">
                {selectedWeek.todos.map((todo, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="shrink-0 min-w-[1.25rem] text-xs font-black text-muted-foreground mt-0.5">
                      {i + 1}.
                    </span>
                    <span className="text-sm leading-snug text-foreground flex-1">
                      {todo.title ?? todo.text ?? ""}
                    </span>
                    {todo.priority === "high" && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-primary/10 text-primary border border-primary/20">
                        HIGH
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

        </div>
      </div>

      {/* Floating AI Coach */}
      <AICoachChat
        isOpen={chatOpen}
        onOpenChange={setChatOpen}
        planId={planId}
        targetRole={targetRole}
        targetCompany={targetCompany}
        gapAnalysis={gapAnalysis}
      />
    </>
  );
}
