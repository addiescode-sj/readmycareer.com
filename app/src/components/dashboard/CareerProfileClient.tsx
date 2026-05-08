"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { CompetencyRadar } from "@/components/ui/CompetencyRadar";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";

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

const NOTES_MAX = 2000;

const APPLICATION_STATUS_KEYS = [
  "statusApplied",
  "statusDocPassed",
  "statusDocFailed",
  "statusInterview1Pass",
  "statusInterview2Pass",
  "statusInterview3Pass",
  "statusOfferAccepted",
  "statusOfferDeclined",
] as const;

const STATUS_VALUES: Record<typeof APPLICATION_STATUS_KEYS[number], string> = {
  statusApplied: "applied",
  statusDocPassed: "doc_passed",
  statusDocFailed: "doc_failed",
  statusInterview1Pass: "interview_1_pass",
  statusInterview2Pass: "interview_2_pass",
  statusInterview3Pass: "interview_3_pass",
  statusOfferAccepted: "offer_accepted",
  statusOfferDeclined: "offer_declined",
};

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
  applicationStatus: string | null;
  notes: string | null;
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
  applicationStatus: initialStatus,
  notes: initialNotes,
}: Props) {
  const t = useTranslations("CareerProfile");
  const router = useRouter();
  const locale = useLocale();

  const [currentStatus, setCurrentStatus] = useState(initialStatus ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [notesSaveState, setNotesSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

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

  const handleStatusChange = useCallback(async (value: string) => {
    setCurrentStatus(value);
    if (!selectedPlanId) return;
    const supabase = createClient();
    await supabase
      .from("career_plans")
      .update({ application_status: value || null })
      .eq("id", selectedPlanId);
  }, [selectedPlanId]);

  const handleNotesSave = useCallback(async () => {
    if (!selectedPlanId || notes.length > NOTES_MAX) return;
    setNotesSaveState("saving");
    const supabase = createClient();
    const { error } = await supabase
      .from("career_plans")
      .update({ notes: notes || null })
      .eq("id", selectedPlanId);
    if (error) {
      setNotesSaveState("error");
    } else {
      setNotesSaveState("saved");
      setTimeout(() => setNotesSaveState("idle"), 2000);
    }
  }, [selectedPlanId, notes]);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={planOptions.length > 1 ? (
          <div className="relative w-full max-w-full">
            <select
              value={selectedPlanId ?? ""}
              onChange={(e) => handlePlanChange(e.target.value)}
              className="w-full appearance-none text-sm font-semibold bg-muted/50 border border-border rounded-xl pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
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
            <CompetencyRadar data={competencies} height={220} />
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

      {/* Application Status + Notes — 2-column layout */}
      {selectedPlanId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Application Status */}
          <div className="glass-card rounded-2xl p-6 space-y-3">
            <h2 className="font-bold text-foreground">{t("applicationStatus")}</h2>
            <div className="relative">
              <select
                value={currentStatus}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="w-full appearance-none text-sm bg-muted/50 border border-border rounded-xl pl-3 pr-8 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
                aria-label={t("applicationStatus")}
              >
                <option value="">{t("applicationStatusPlaceholder")}</option>
                {APPLICATION_STATUS_KEYS.map((key) => (
                  <option key={key} value={STATUS_VALUES[key]}>
                    {t(key)}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M2 3.5L5.5 7L9 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="glass-card rounded-2xl p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-foreground">{t("notes")}</h2>
              <span className={cn("text-xs tabular-nums", notes.length > NOTES_MAX ? "text-destructive" : "text-muted-foreground")}>
                {t("notesCharCount", { current: notes.length, max: NOTES_MAX })}
              </span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("notesPlaceholder")}
              rows={4}
              maxLength={NOTES_MAX + 1}
              className="w-full resize-none text-sm bg-muted/50 border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground/50"
            />
            <div className="flex items-center justify-between gap-3">
              {notesSaveState === "error" && (
                <p className="text-xs text-destructive">{t("notesSaveError")}</p>
              )}
              {notesSaveState === "saved" && (
                <p className="text-xs text-primary">{t("notesSaved")}</p>
              )}
              {notesSaveState !== "error" && notesSaveState !== "saved" && (
                <span />
              )}
              <button
                onClick={handleNotesSave}
                disabled={notesSaveState === "saving" || notes.length > NOTES_MAX}
                className="shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {notesSaveState === "saving" ? t("notesSaving") : t("notesSave")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Next Actions */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <h2 className="font-bold text-foreground">{t("nextActions")}</h2>
        {nextTodos.length > 0 ? (
          <ul className="space-y-2.5">
            {nextTodos.map((todo, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="shrink-0 text-muted-foreground/50 text-sm font-bold leading-5">{i + 1}.</span>
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
