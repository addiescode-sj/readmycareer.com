"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface Week {
  week_number?: number;
  theme?: string;
  date_range?: { start: string; end: string };
  todos: Array<{ done: boolean }>;
}

interface Props {
  weeks: Week[];
  doneTasks: number;
  totalTasks: number;
}

interface WeekPoint {
  weekNumber: number;
  theme: string;
  timePct: number;
  compPct: number;
  cumDone: number;
  weekDone: number;
  weekTotal: number;
}

const MS_PER_DAY = 86_400_000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function RoadmapVelocityChart({ weeks, doneTasks, totalTasks }: Props) {
  const t = useTranslations("DashboardRoadmap");
  const [selectedPoint, setSelectedPoint] = useState<WeekPoint | null>(null);

  const today = new Date();
  const firstWeek = weeks.find((w) => w.date_range?.start);
  const lastWeek = [...weeks].reverse().find((w) => w.date_range?.end);

  if (!firstWeek?.date_range || !lastWeek?.date_range || totalTasks === 0) {
    return null;
  }

  const planStart = new Date(firstWeek.date_range.start);
  const planEnd = new Date(lastWeek.date_range.end);
  const totalDays = Math.max(1, (planEnd.getTime() - planStart.getTime()) / MS_PER_DAY);
  const daysElapsed = clamp(0, totalDays, (today.getTime() - planStart.getTime()) / MS_PER_DAY);
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  // Build per-week cumulative completion data points for the progress line
  let runningDone = 0;
  const weekDataPoints: WeekPoint[] = weeks
    .filter(w => w.date_range?.end)
    .map(w => {
      const weekDone = w.todos.filter(todo => todo.done).length;
      runningDone += weekDone;
      const weekEnd = new Date(w.date_range!.end);
      const timePct = clamp(0, 100, ((weekEnd.getTime() - planStart.getTime()) / MS_PER_DAY) / totalDays * 100);
      const compPct = (runningDone / totalTasks) * 100;
      return {
        weekNumber: w.week_number ?? 0,
        theme: w.theme ?? "",
        timePct,
        compPct,
        cumDone: runningDone,
        weekDone,
        weekTotal: w.todos.length,
      };
    });

  const timeProgressPct = (daysElapsed / totalDays) * 100;
  const completionPct = (doneTasks / totalTasks) * 100;
  const daysRemainingRounded = Math.round(daysRemaining);
  const daysElapsedRounded = Math.round(daysElapsed);

  const requiredRatePerWeek = daysRemaining > 0
    ? Math.round(((100 - completionPct) / (daysRemaining / 7)) * 10) / 10
    : 0;

  const status: "ahead" | "on_track" | "behind" =
    completionPct > timeProgressPct + 10
      ? "ahead"
      : completionPct >= timeProgressPct - 5
      ? "on_track"
      : "behind";

  const STATUS_COLORS = {
    ahead: { text: "text-secondary", bg: "bg-secondary/10", border: "border-secondary/30", fill: "hsl(var(--secondary))" },
    on_track: { text: "text-primary", bg: "bg-primary/10", border: "border-primary/30", fill: "hsl(var(--primary))" },
    behind: { text: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", fill: "hsl(var(--destructive))" },
  };

  const statusColor = STATUS_COLORS[status];
  const statusLabel = status === "ahead"
    ? t("statusAhead")
    : status === "on_track"
    ? t("statusOnTrack")
    : t("statusBehind");

  // SVG coordinate helpers (viewBox 300 x 120)
  const W = 300;
  const H = 120;
  const chartW = W;
  const chartH = H;

  const toX = (timePct: number) => (timePct / 100) * chartW;
  const toY = (compPct: number) => chartH - (compPct / 100) * chartH;

  const todayX = toX(timeProgressPct);
  const actualY = toY(completionPct);

  const idealPath = `M ${toX(0)} ${toY(0)} L ${toX(100)} ${toY(100)}`;
  const requiredPath = `M ${todayX} ${actualY} L ${toX(100)} ${toY(100)}`;

  // Actual progress line: starts at origin, plots through each week's cumulative completion
  const actualLinePath = weekDataPoints.length > 0
    ? `M ${toX(0)} ${toY(0)} ` + weekDataPoints.map(p => `L ${toX(p.timePct)} ${toY(p.compPct)}`).join(" ")
    : null;

  const isAhead = completionPct >= timeProgressPct;
  const fillColor = isAhead ? "hsl(var(--secondary))" : "hsl(var(--destructive))";

  return (
    <div className="glass-card rounded-2xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest text-foreground">{t("velocityTitle")}</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t("velocitySubtitle")}</p>
        </div>
        <span className={cn(
          "shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
          statusColor.bg, statusColor.text, statusColor.border
        )}>
          {statusLabel}
        </span>
      </div>

      {/* SVG Chart */}
      <div className="relative w-full" style={{ paddingBottom: "40%", overflow: "visible" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          style={{ overflow: "visible" }}
        >
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <line
              key={`grid-x-${pct}`}
              x1={toX(pct)} y1={toY(0)} x2={toX(pct)} y2={toY(100)}
              stroke="hsl(var(--outline-variant))" strokeWidth="0.5" strokeDasharray="2 4"
            />
          ))}
          {[0, 25, 50, 75, 100].map((pct) => (
            <line
              key={`grid-y-${pct}`}
              x1={toX(0)} y1={toY(pct)} x2={toX(100)} y2={toY(pct)}
              stroke="hsl(var(--outline-variant))" strokeWidth="0.5" strokeDasharray="2 4"
            />
          ))}

          {/* Fill area between actual and ideal from today onward */}
          {timeProgressPct < 100 && (
            <polygon
              points={`${todayX},${actualY} ${toX(100)},${toY(100)} ${toX(100)},${toY(timeProgressPct)} ${todayX},${toY(timeProgressPct)}`}
              fill={fillColor}
              fillOpacity="0.12"
            />
          )}

          {/* Ideal trajectory (dashed diagonal) */}
          <path d={idealPath} stroke="hsl(var(--outline-variant))" strokeWidth="1.5" strokeDasharray="5 4" fill="none" />

          {/* Required pace line from today to end */}
          {timeProgressPct < 100 && (
            <path d={requiredPath} stroke={statusColor.fill} strokeWidth="2" fill="none" strokeLinecap="round" />
          )}

          {/* Actual progress line through each week's cumulative completion */}
          {actualLinePath && (
            <path
              d={actualLinePath}
              stroke={statusColor.fill}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity="0.85"
            />
          )}

          {/* Today vertical marker */}
          <line
            x1={todayX} y1={toY(0)} x2={todayX} y2={toY(100)}
            stroke="hsl(var(--foreground))" strokeWidth="1" strokeOpacity="0.3" strokeDasharray="3 3"
          />

          {/* Actual position dot (today) */}
          <circle cx={todayX} cy={actualY} r="4" fill={statusColor.fill} stroke="hsl(var(--background))" strokeWidth="2" />

          {/* Ideal position dot (today) */}
          <circle cx={todayX} cy={toY(timeProgressPct)} r="3" fill="hsl(var(--outline-variant))" stroke="hsl(var(--background))" strokeWidth="1.5" />

          {/* Per-week interactive data points — click to reveal detail tooltip */}
          {weekDataPoints.map((point, i) => {
            const isSelected = selectedPoint?.weekNumber === point.weekNumber;
            return (
              <g
                key={`week-pt-${i}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedPoint(prev => prev?.weekNumber === point.weekNumber ? null : point)}
              >
                <circle
                  cx={toX(point.timePct)}
                  cy={toY(point.compPct)}
                  r={isSelected ? 5 : 3.5}
                  fill={isSelected ? statusColor.fill : "hsl(var(--muted-foreground))"}
                  fillOpacity={isSelected ? 1 : 0.55}
                  stroke="hsl(var(--background))"
                  strokeWidth="1.5"
                />
                {/* Transparent hit area for easier clicking */}
                <circle cx={toX(point.timePct)} cy={toY(point.compPct)} r="10" fill="transparent" />
              </g>
            );
          })}
        </svg>

        {/* Click-to-reveal week detail tooltip */}
        {selectedPoint && (
          <div
            className="absolute z-10 pointer-events-none"
            style={{
              left: `${clamp(10, 85, selectedPoint.timePct)}%`,
              top: `${(1 - selectedPoint.compPct / 100) * 100}%`,
              transform: "translate(-50%, calc(-100% - 10px))",
            }}
          >
            <div className="glass-card rounded-xl px-3 py-2.5 border border-border shadow-synthetic-md min-w-[148px]">
              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                {t("weekLabel", { n: selectedPoint.weekNumber })}
              </p>
              {selectedPoint.theme && (
                <p className="text-xs font-bold text-foreground leading-snug mt-0.5 mb-2 line-clamp-2">
                  {selectedPoint.theme}
                </p>
              )}
              <p className="text-base font-black text-foreground">{Math.round(selectedPoint.compPct)}%</p>
              <p className="text-[9px] text-muted-foreground">
                {t("tasksCompleted", { done: selectedPoint.cumDone, total: totalTasks })}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label={t("daysElapsed", { n: daysElapsedRounded })}
          value={`${Math.round(completionPct)}%`}
          sublabel={t("currentLabel")}
        />
        <MetricCard
          label={t("daysRemaining", { n: daysRemainingRounded })}
          value={daysRemainingRounded > 0 ? `${t("requiredRateValue", { pct: requiredRatePerWeek })}` : "—"}
          sublabel={t("requiredRateLabel")}
        />
        <div className="col-span-2 flex items-center gap-3 glass-card rounded-xl px-3 py-2.5">
          <LegendDot dashed />
          <span className="text-[11px] text-muted-foreground">{t("idealPaceLabel")}</span>
          <span className="mx-2 text-outline">·</span>
          <span className="inline-block w-4 h-0.5 rounded-full" style={{ backgroundColor: statusColor.fill }} />
          <span className="text-[11px] text-muted-foreground">{t("requiredRateLabel")}</span>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="glass-card rounded-xl px-3 py-2.5 space-y-0.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-lg font-black text-foreground leading-tight">{value}</p>
      <p className="text-[10px] text-muted-foreground">{sublabel}</p>
    </div>
  );
}

function LegendDot({ dashed }: { dashed?: boolean }) {
  if (dashed) {
    return (
      <svg width="16" height="2" viewBox="0 0 16 2">
        <line x1="0" y1="1" x2="16" y2="1" stroke="hsl(var(--outline-variant))" strokeWidth="2" strokeDasharray="4 3" />
      </svg>
    );
  }
  return <span className="w-2 h-2 rounded-full bg-primary shrink-0" />;
}
