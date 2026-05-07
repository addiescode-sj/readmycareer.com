"use client";

import { useRef, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { AICoachChat } from "@/components/ui/AICoachChat";

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

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  weeks: Week[];
  planTitle: string;
  planId: string;
  targetRole: string;
  targetCompany: string | null;
  gapAnalysis: Record<string, unknown> | null;
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


export function RoadmapTimelineClient({ weeks, planTitle, planId, targetRole, targetCompany, gapAnalysis }: Props) {
  const t = useTranslations("DashboardRoadmap");
  const scrollRef = useRef<HTMLDivElement>(null);

  const phaseLabels = [t("phasePrep"), t("phaseDive"), t("phaseApply")];
  const today = new Date();

  const activeWeekIndex = weeks.findIndex((w) => {
    if (!w.date_range) return false;
    const start = new Date(w.date_range.start);
    const end = new Date(w.date_range.end);
    return today >= start && today <= end;
  });

  const totalTasks = weeks.reduce((s, w) => s + w.todos.length, 0);
  const doneTasks = weeks.reduce((s, w) => s + w.todos.filter((t) => t.done).length, 0);
  const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const [chatOpen, setChatOpen] = useState(false);

  return (
    <>
      <div className="flex flex-col gap-6 h-[calc(100vh-theme(spacing.32))] min-h-0 min-w-[320px] overflow-y-auto pr-2">
        {/* ── Left: Roadmap content ── */}
        <div className="flex flex-col gap-6">
        {/* Header */}
        <div>
          <h1 className="text-headline-lg font-bold text-foreground tracking-tight">{t("title")}</h1>
          <p className="text-body-md text-muted-foreground mt-1">{planTitle}</p>
        </div>

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

        {/* Horizontal scrollable week cards */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory"
          style={{ scrollbarColor: "hsl(var(--outline-variant)) transparent", scrollbarWidth: "thin" }}
        >
          {weeks.map((week, i) => {
            const phase = getPhase(i, weeks.length);
            const c = PHASE_COLORS[phase]!;
            const done = week.todos.filter((t) => t.done).length;
            const total = week.todos.length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const isActive = i === activeWeekIndex;
            const isLocked = i > (activeWeekIndex >= 0 ? activeWeekIndex + 2 : 2);

            return (
              <motion.div
                key={week.week_number}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3 }}
                className={cn(
                  "shrink-0 w-52 snap-start rounded-2xl p-4 flex flex-col gap-3 border transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-synthetic-md"
                    : isLocked
                    ? "glass-card border-border/30 opacity-60"
                    : "glass-card border-border/50 hover:border-primary/30 hover:shadow-synthetic",
                )}
              >
                {/* Status badge */}
                <div className={cn(
                  "self-start px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest",
                  isActive ? "bg-white/20 text-white" : isLocked ? "bg-muted text-muted-foreground" : cn(c.bg, c.text),
                )}>
                  {isActive ? t("weekActive") : isLocked ? t("weekLocked") : phaseLabels[phase]}
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

                {/* Top todo */}
                {week.todos[0] && !isLocked && (
                  <p className={cn("text-[11px] leading-relaxed line-clamp-2 mt-auto", isActive ? "text-white/80" : "text-muted-foreground")}>
                    {week.todos[0].title ?? week.todos[0].text ?? ""}
                  </p>
                )}

                {isLocked && (
                  <p className="text-[11px] text-muted-foreground/60 mt-auto">🔒 {t("weekLocked")}</p>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Todo list for active week */}
        {activeWeekIndex >= 0 && weeks[activeWeekIndex] && (
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <h2 className="text-sm font-black uppercase tracking-widest text-foreground">
              {t("weekLabel", { n: weeks[activeWeekIndex]!.week_number })} — {weeks[activeWeekIndex]!.theme}
            </h2>
            <ul className="space-y-2">
              {weeks[activeWeekIndex]!.todos.map((todo, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className={cn(
                    "mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors",
                    todo.done ? "bg-primary border-primary" : "border-border bg-background"
                  )}>
                    {todo.done && <span className="text-primary-foreground text-[10px] font-black">✓</span>}
                  </div>
                  <span className={cn("text-sm leading-snug", todo.done ? "line-through text-muted-foreground" : "text-foreground")}>
                    {todo.title ?? todo.text ?? ""}
                  </span>
                  {todo.priority === "high" && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-primary/10 text-primary border border-primary/20">
                      {todo.priority}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        </div>
      </div>

      {/* ── Floating AI Coach ── */}
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
