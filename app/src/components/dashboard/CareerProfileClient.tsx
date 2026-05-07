"use client";

import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";

interface Competency {
  name: string;
  score: number;
}

interface Finding {
  text: string;
  priority: "high" | "medium" | "low";
}

interface Todo {
  done: boolean;
  text: string;
}

interface PlanOption {
  id: string;
  label: string;
  createdAt: string;
}

interface ReportBasis {
  resumeUploadedAt: string | null;
  planCreatedAt: string;
  targetRole: string;
  targetCompany: string;
}

interface Props {
  displayName: string | null;
  avatarUrl: string | null;
  targetRole: string;
  targetCompany: string;
  competencies: Competency[];
  findings: Finding[];
  nextTodos: Todo[];
  planOptions: PlanOption[];
  selectedPlanId: string | null;
  reportBasis: ReportBasis | null;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-primary/10 text-primary border border-primary/20",
  medium: "bg-secondary/10 text-secondary border border-secondary/20",
  low: "bg-muted text-muted-foreground border border-border",
};

export function CareerProfileClient({
  displayName,
  avatarUrl,
  targetRole,
  targetCompany,
  competencies,
  findings,
  nextTodos,
  planOptions,
  selectedPlanId,
  reportBasis,
}: Props) {
  const t = useTranslations("CareerProfile");
  const router = useRouter();
  const locale = useLocale();

  const initials = (displayName ?? "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" })
      .format(new Date(dateStr));
  }

  function handlePlanChange(planId: string) {
    router.push(`/dashboard/profile?planId=${planId}`);
  }

  function getReportBasisKey(): Parameters<typeof t>[0] {
    if (!reportBasis) return "reportBasis";
    const hasCompany = Boolean(reportBasis.targetCompany);
    const hasResume = Boolean(reportBasis.resumeUploadedAt);
    if (hasCompany && hasResume) return "reportBasisWithCompany";
    if (hasCompany && !hasResume) return "reportBasisNoResumeWithCompany";
    if (!hasCompany && hasResume) return "reportBasis";
    return "reportBasisNoResume";
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-headline-lg font-bold text-foreground tracking-tight">{t("title")}</h1>
        <p className="text-body-md text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      {/* Report Basis + Plan Selector */}
      {(reportBasis || planOptions.length > 1) && (
        <div className="glass-card rounded-2xl px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {reportBasis && (
            <p className="text-label-sm text-muted-foreground">
              {t(getReportBasisKey(), {
                resumeDate: formatDate(reportBasis.resumeUploadedAt),
                role: reportBasis.targetRole,
                company: reportBasis.targetCompany,
                planDate: formatDate(reportBasis.planCreatedAt),
              })}
            </p>
          )}
          {planOptions.length > 1 && (
            <select
              value={selectedPlanId ?? ""}
              onChange={(e) => handlePlanChange(e.target.value)}
              className="text-sm font-semibold bg-muted/50 border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground shrink-0"
              aria-label={t("selectPlan")}
            >
              {planOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} — {t("planCreatedOn", { date: formatDate(opt.createdAt) })}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Identity card */}
      <div className="glass-card rounded-2xl p-8 flex items-center gap-6 synthetic-glow">
        {avatarUrl ? (
          <img src={avatarUrl} alt={displayName ?? "User"} className="w-16 h-16 rounded-full object-cover ring-2 ring-primary/20" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-black text-xl">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-foreground text-lg truncate">{displayName ?? "User"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            <span className="text-label-sm uppercase tracking-widest">{t("targetRole")}: </span>
            <span className="font-semibold text-foreground">{targetRole}</span>
            {targetCompany && (
              <>
                <span className="mx-2 text-outline">·</span>
                <span className="text-label-sm uppercase tracking-widest">{t("targetCompany")}: </span>
                <span className="font-semibold text-foreground">{targetCompany}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Competency Radar */}
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-foreground">{t("competencies")}</h2>
          {competencies.length > 0 ? (
            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="75%" data={competencies}>
                  <PolarGrid stroke="rgba(139,92,246,0.1)" />
                  <PolarAngleAxis
                    dataKey="name"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontWeight: 600 }}
                  />
                  <Radar
                    name="Score"
                    dataKey="score"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.15}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noFindings")}</p>
          )}
        </div>

        {/* Evidence-Based Findings */}
        <div className="glass-card rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-foreground">{t("findings")}</h2>
          {findings.length > 0 ? (
            <ul className="space-y-3">
              {findings.map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest mt-0.5", PRIORITY_STYLES[f.priority])}>
                    {t(`priority${f.priority.charAt(0).toUpperCase()}${f.priority.slice(1)}` as Parameters<typeof t>[0])}
                  </span>
                  <p className="text-sm text-foreground leading-relaxed">{f.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noFindings")}</p>
          )}
        </div>
      </div>

      {/* Next Actions */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h2 className="font-bold text-foreground">{t("nextActions")}</h2>
        {nextTodos.length > 0 ? (
          <ul className="space-y-3">
            {nextTodos.map((todo, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded border-2 border-primary/30 mt-0.5 shrink-0" />
                <p className="text-sm text-foreground leading-relaxed">{todo.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noActions")}</p>
        )}
      </div>
    </div>
  );
}
