"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { useTranslations, useLocale } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { AnalysisProgressOverlay } from "./ui/AnalysisProgressOverlay";
import { Logo } from "./ui/Logo";

const RESUME_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const JD_TEXT_MIN_LENGTH = 50;
const JD_TEXT_MAX_LENGTH = 10000;

export default function InitializeWorkspace() {
  const t = useTranslations("GoalSetting");
  const tWork = useTranslations("InitializeWorkspace");
  const locale = useLocale() as "ko" | "en";
  const { resumeJson, setResumeJson, setAnalysisResult } = useSession();
  const queryClient = useQueryClient();

  const [isDragging, setIsDragging] = useState(false);
  const [parseStage, setParseStage] = useState<string | null>(null);
  const [parseError, setParseError] = useState<{ code: string; message: string } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [targetRole, setTargetRole] = useState("");
  const [targetCompany, setTargetCompany] = useState("");
  const [jdText, setJdText] = useState("");
  const [durationWeeks, setDurationWeeks] = useState<number | "">(12);
  const [startDate] = useState(new Date().toISOString().split("T")[0] ?? "");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeStage, setAnalyzeStage] = useState<string>("");
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const STEP_PROGRESS: Record<string, number> = {
    reference_search: 15,
    reference_search_done: 30,
    cache: 45,
    gap_analysis: 62,
    planning: 80,
    done: 100,
  };

  // File Upload Logic
  async function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);

    // Check if we already parsed an identical file within the last hour.
    // This avoids a round-trip to Gemini for repeat uploads of the same resume.
    const hash = await computeFileHash(file);
    const cacheKey = ["resume", hash];
    const cacheState = queryClient.getQueryState<Record<string, unknown>>(cacheKey);
    if (
      cacheState?.data &&
      cacheState.dataUpdatedAt &&
      Date.now() - cacheState.dataUpdatedAt < RESUME_CACHE_TTL
    ) {
      setResumeJson(cacheState.data);
      return;
    }

    setParseStage("extracting");

    const formData = new FormData();
    formData.append("file", file);

    let res: Response;
    try {
      res = await fetch("/api/resume", { method: "POST", body: formData });
    } catch {
      setParseError({ code: "UNKNOWN", message: "" });
      setParseStage(null);
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      setParseError({ code: "VALIDATION", message: (data["error"] as string) ?? "" });
      setParseStage(null);
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const eventMatch = part.match(/^event: (\w+)/m);
          const dataMatch = part.match(/^data: (.+)/m);
          if (!dataMatch) continue;

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(dataMatch[1]);
          } catch {
            continue;
          }

          const eventName = eventMatch?.[1];

          if (eventName === "progress") {
            setParseStage(payload["stage"] as string);
          } else if (eventName === "result") {
            setParseStage(null);
            queryClient.setQueryData(["resume", hash], payload);
            setResumeJson(payload);
            return;
          } else if (eventName === "error") {
            setParseError({
              code: (payload["code"] as string) ?? "UNKNOWN",
              message: (payload["message"] as string) ?? "",
            });
            setParseStage(null);
          } else if (eventName === "done") {
            setParseStage(null);
            return;
          }
        }
      }
    } catch {
      setParseError({ code: "UNKNOWN", message: "" });
    } finally {
      setParseStage(null);
    }
  }

  // Analysis Logic
  async function handleAnalyze() {
    if (!resumeJson) {
      setAnalyzeError(tWork("uploadError"));
      return;
    }
    if (!targetRole.trim()) {
      setAnalyzeError(t("validationError"));
      return;
    }
    if (durationWeeks === "" || durationWeeks < 1 || durationWeeks > 24) {
      setAnalyzeError(t("durationValidationError"));
      return;
    }
    if (jdText.trim().length < JD_TEXT_MIN_LENGTH) {
      setAnalyzeError(t("jdTextValidationError"));
      return;
    }
    if (jdText.length > JD_TEXT_MAX_LENGTH) {
      setAnalyzeError(t("jdTextTooLongError"));
      return;
    }

    setAnalyzeError(null);
    setIsAnalyzing(true);
    setAnalyzeProgress(5);
    setAnalyzeStage(t("preparingAnalysis"));

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeJson,
          targetRole,
          targetCompany,
          jdText,
          durationWeeks: durationWeeks as number,
          startDate,
          locale,
        }),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((errData["error"] as string) ?? t("requestError"));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.replace("event:", "").trim();
          const data = JSON.parse(dataLine.replace("data:", "").trim()) as Record<string, unknown>;

          if (event === "progress") {
            const step = (data["step"] as string) ?? "";
            const progressKeys = ["reference_search", "reference_search_done", "cache", "gap_analysis", "planning", "done"] as const;
            type ProgressKey = typeof progressKeys[number];
            const isKnownStep = (progressKeys as readonly string[]).includes(step);
            setAnalyzeStage(isKnownStep ? t(`progress.${step as ProgressKey}`) : "");
            const pct = STEP_PROGRESS[step];
            if (pct !== undefined) setAnalyzeProgress(pct);
          } else if (event === "result") {
            setAnalyzeStage(t("analysisComplete"));
            setAnalysisResult(
              data as Record<string, unknown>,
              (data["gap_analysis"] as Record<string, unknown>) ?? {},
              targetRole,
              targetCompany,
              jdText
            );
          } else if (event === "error") {
            throw new Error((data["message"] as string) ?? t("analysisError"));
          }
        }
      }
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsAnalyzing(false);
      setAnalyzeProgress(0);
    }
  }

  const isUploading = parseStage !== null;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <AnalysisProgressOverlay isVisible={isAnalyzing} stage={analyzeStage} progress={analyzeProgress} />
      {/* Focused Header */}
      <header className="p-6 border-b border-border bg-white/50 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Logo size={40} className="rounded-xl" />
            <div>
              <h1 className="font-semibold text-foreground text-sm leading-tight">readmycareer.com</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Workspace Initialization</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full border-2 border-background bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">R</div>
              <div className="w-8 h-8 rounded-full border-2 border-background bg-secondary/20 flex items-center justify-center text-[10px] font-bold text-secondary">J</div>
              <div className="w-8 h-8 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">A</div>
            </div>
            <span className="text-xs font-medium text-muted-foreground">Step 1 of 3</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12">
        <div className="max-w-7xl mx-auto h-full flex flex-col">
          <div className="mb-12">
            <h2 className="text-4xl font-extrabold tracking-tight text-foreground mb-3">{tWork("title")}</h2>
            <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
              {tWork("description")}
            </p>
          </div>

          <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {/* Column 1: Resume Data */}
            <div className="glass-card rounded-3xl p-8 shadow-sm flex flex-col min-h-[400px] transition-all hover:shadow-md">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-xs font-bold border border-primary/20">1</div>
                  <h3 className="font-bold text-foreground text-lg">{tWork("resumeData")}</h3>
                </div>
                {resumeJson && (
                  <span className="text-[10px] uppercase tracking-widest font-bold text-primary bg-primary/10 px-2 py-1 rounded">Analyzed</span>
                )}
              </div>

              <div
                className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-all duration-300 ${isDragging
                    ? "border-primary bg-primary/5 scale-[0.99]"
                    : "border-border hover:border-primary/50 hover:bg-muted/30"
                  }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFile(file);
                }}
                onClick={() => inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.docx,.doc"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
                {isUploading ? (
                  <div className="w-full flex flex-col items-center justify-center gap-4">
                    <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                    <p className="text-sm font-medium text-primary animate-pulse">{tWork("architecting")}</p>
                  </div>
                ) : resumeJson ? (
                  <div className="animate-in fade-in zoom-in duration-500">
                    <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <span className="text-2xl text-primary">📄</span>
                    </div>
                    <p className="text-base font-bold text-foreground truncate max-w-[200px]">{fileName}</p>
                    <p className="text-xs text-muted-foreground mt-1">{tWork("clickReplace")}</p>
                  </div>
                ) : (
                  <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="w-14 h-14 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-3 text-muted-foreground">
                      <span className="text-2xl">📥</span>
                    </div>
                    <p className="text-base font-bold text-foreground">{tWork("dropPrompt")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{tWork("clickBrowse")}</p>
                  </div>
                )}
              </div>
              {parseError && <p className="text-xs text-destructive mt-3 text-center font-medium">{parseError.message}</p>}
            </div>

            {/* Column 2: Job Description Context */}
            <div className="glass-card rounded-3xl p-8 shadow-sm flex flex-col transition-all hover:shadow-md">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold border border-border">2</div>
                  <h3 className="font-bold text-foreground text-lg">{tWork("jdContext")}</h3>
                </div>
                <button
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest text-primary bg-primary/10 hover:bg-primary/20 transition-all flex items-center gap-2"
                  onClick={() => navigator.clipboard.readText().then(text => setJdText(text))}
                >
                  <span>📋</span> {tWork("paste")}
                </button>
              </div>
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder={tWork("jdPlaceholder")}
                className="flex-1 w-full bg-muted/30 border border-border rounded-2xl p-5 text-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all font-mono resize-none leading-relaxed placeholder:text-muted-foreground/40 min-h-[300px]"
              />
            </div>

            {/* Column 3: Target Parameters + Submit */}
            <div className="flex flex-col gap-6">
              <div className="glass-card rounded-3xl p-8 shadow-sm flex-1 transition-all hover:shadow-md">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-8 h-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold border border-border">3</div>
                  <h3 className="font-bold text-foreground text-lg">{tWork("targetParameters")}</h3>
                </div>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tWork("targetCompany")}</label>
                    <input
                      type="text"
                      value={targetCompany}
                      onChange={(e) => setTargetCompany(e.target.value)}
                      placeholder="e.g. Stripe, OpenAI"
                      className="w-full bg-muted/50 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tWork("roleDesignation")}</label>
                    <input
                      type="text"
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      placeholder="e.g. Senior Backend Engineer"
                      className="w-full bg-muted/50 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{tWork("timeHorizon")}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={durationWeeks}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") { setDurationWeeks(""); return; }
                          const n = parseInt(raw, 10);
                          if (!isNaN(n)) setDurationWeeks(Math.min(24, Math.max(1, n)));
                        }}
                        placeholder={t("durationPlaceholder")}
                        className="flex-1 bg-muted/50 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all font-medium"
                      />
                      <span className="text-sm font-bold text-muted-foreground shrink-0">{t("durationUnit")}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t("durationHint")}</p>
                  </div>
                </div>
              </div>

              {/* Submit */}
              <div className="flex flex-col gap-4">
                {analyzeError && (
                  <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium animate-in fade-in slide-in-from-top-2">
                    {analyzeError}
                  </div>
                )}
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing || isUploading}
                  className="w-full h-16 bg-primary text-primary-foreground font-bold text-lg rounded-2xl hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-primary/25 flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  <span className="text-2xl">✨</span>
                  <span>{isAnalyzing ? tWork("architecting") : tWork("startAnalysis")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
