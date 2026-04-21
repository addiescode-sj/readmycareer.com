"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

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

export default function RoadmapView({ plan, onStartChat, onTodoToggle }: Props) {
  const t = useTranslations("RoadmapView");
  const [expandedWeek, setExpandedWeek] = useState<number | null>(1);
  const [copied, setCopied] = useState(false);
  const typedPlan = plan as unknown as CareerPlan;

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

        <div className="flex gap-6 text-sm text-gray-600 mb-4">
          <span>📅 {typedPlan.start_date} ~ {typedPlan.end_date}</span>
          <span>📋 {typedPlan.duration_weeks}{t("weeksUnit")}</span>
          <span>✅ {completedTodosCount}/{totalTodosCount} {t("completed")}</span>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{t("overallProgress")}</span>
            <span>{progressPercentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
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
                setExpandedWeek(
                  expandedWeek === week.week_number ? null : week.week_number
                )
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
                  {expandedWeek === week.week_number ? "▲" : "▼"}
                </span>
              </div>
            </button>

            {/* Todo list */}
            {expandedWeek === week.week_number && (
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
                        {todo.resources.length > 0 && (
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {todo.resources.map((r, i) => (
                              <a
                                key={i}
                                href={r.url ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline"
                              >
                                🔗 {r.label}
                              </a>
                            ))}
                          </div>
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
