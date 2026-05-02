"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface Props {
  resumeJson: Record<string, unknown>;
  onAnalyzed: (
    careerPlan: Record<string, unknown>,
    gapAnalysis: Record<string, unknown>,
    targetRole: string,
    targetCompany: string,
    jdText: string
  ) => void;
}

const JD_TEXT_MIN_LENGTH = 50;
const JD_TEXT_MAX_LENGTH = 10000;

export default function GoalSetting({ resumeJson, onAnalyzed }: Props) {
  const t = useTranslations("GoalSetting");
  const [targetRole, setTargetRole] = useState("");
  const [targetCompany, setTargetCompany] = useState("");
  const [jdText, setJdText] = useState("");
  const [durationWeeks, setDurationWeeks] = useState<number | "">(8);
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split("T")[0] ?? ""
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<string>("");

  async function handleAnalyze() {
    if (!targetRole.trim()) {
      setError(t("validationError"));
      return;
    }
    if (durationWeeks === "" || durationWeeks < 1 || durationWeeks > 24) {
      setError(t("durationValidationError"));
      return;
    }
    if (jdText.trim().length < JD_TEXT_MIN_LENGTH) {
      setError(t("jdTextValidationError"));
      return;
    }
    if (jdText.length > JD_TEXT_MAX_LENGTH) {
      setError(t("jdTextTooLongError"));
      return;
    }

    setError(null);
    setIsLoading(true);
    setStage(t("preparingAnalysis"));

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
        }),
      });

      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((errData["error"] as string) ?? t("requestError"));
      }

      // Parse SSE stream
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
          const dataLine  = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.replace("event:", "").trim();
          const data  = JSON.parse(dataLine.replace("data:", "").trim()) as Record<string, unknown>;

          if (event === "progress") {
            const step = (data["step"] as string) ?? "";
            const progressKeys = ["reference_search", "reference_search_done", "cache", "gap_analysis", "planning", "done"] as const;
            type ProgressKey = typeof progressKeys[number];
            const isKnownStep = (progressKeys as readonly string[]).includes(step);
            setStage(isKnownStep ? t(`progress.${step as ProgressKey}`) : "");
          } else if (event === "result") {
            setStage(t("analysisComplete"));
            onAnalyzed(
              data as Record<string, unknown>,
              (data["gap_analysis"] as Record<string, unknown>) ?? {},
              targetRole,
              targetCompany,
              jdText
            );
          } else if (event === "error") {
            throw new Error((data["message"] as string) ?? t("analysisError"));
          }
          // "done" event is a stream termination signal — no additional handling needed
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("genericError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-2">{t("title")}</h2>
      <p className="text-gray-500 text-sm mb-6">{t("description")}</p>

      <div className="flex flex-col gap-4">
        {/* Target role */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("targetRoleLabel")} <span className="text-red-500">{t("required")}</span>
          </label>
          <input
            type="text"
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
            placeholder="e.g. Backend Engineer, Product Manager"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none text-[#333333]"
          />
        </div>

        {/* Target company */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("targetCompanyLabel")} <span className="text-gray-400">{t("optional")}</span>
          </label>
          <input
            type="text"
            value={targetCompany}
            onChange={(e) => setTargetCompany(e.target.value)}
            placeholder="e.g. Toss, Kakao, Naver"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none text-[#333333]"
          />
        </div>

        {/* Job Description (required) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("jdTextLabel")} <span className="text-red-500">{t("required")}</span>
          </label>
          <p className="text-xs text-gray-400 mb-1">{t("jdTextHint")}</p>
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder={t("jdTextPlaceholder")}
            rows={8}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none text-[#333333] resize-y"
          />
          <p className="text-xs text-gray-400 mt-1 text-right">
            {jdText.length} / {JD_TEXT_MAX_LENGTH}
          </p>
        </div>

        {/* Preparation duration */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("durationLabel")}
          </label>
          <p className="text-xs text-gray-400 mb-1">{t("durationHint")}</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={24}
              value={durationWeeks}
              onChange={(e) => {
                const v = e.target.value;
                setDurationWeeks(v === "" ? "" : Number(v));
              }}
              placeholder={t("durationPlaceholder")}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none text-[#333333]"
            />
            <span className="text-sm text-gray-500">{t("durationUnit")}</span>
          </div>
        </div>

        {/* Start date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("startDateLabel")}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none text-[#333333]"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}

        {isLoading && stage && (
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-blue-700">{stage}</span>
          </div>
        )}

        <button
          onClick={handleAnalyze}
          disabled={isLoading}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? t("submittingButton") : t("submitButton")}
        </button>
      </div>
    </div>
  );
}
