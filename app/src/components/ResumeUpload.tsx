"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";

type ParseStage = "extracting" | "parsing" | null;
type ParseError = { code: string; message: string } | null;

interface Props {
  onParsed: (resumeJson: Record<string, unknown>) => void;
}

function getErrorMessage(
  err: NonNullable<ParseError>,
  t: ReturnType<typeof useTranslations<"ResumeUpload">>
): string {
  switch (err.code) {
    case "EXTRACT_EMPTY":  return t("errorScannedPdf");
    case "EXTRACT_FAILED": return t("errorExtractFailed");
    case "PARSE_TIMEOUT":  return t("errorTimeout");
    case "PARSE_QUOTA":    return t("errorQuota");
    case "PARSE_FAILED":   return t("errorParseFailed");
    case "VALIDATION":     return err.message || t("parseError");
    default:               return t("genericError");
  }
}

export default function ResumeUpload({ onParsed }: Props) {
  const t = useTranslations("ResumeUpload");
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<ParseStage>(null);
  const [parseError, setParseError] = useState<ParseError>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isLoading = stage !== null;

  async function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);
    setLastFile(file);
    setStage("extracting");

    const formData = new FormData();
    formData.append("file", file);

    let res: Response;
    try {
      res = await fetch("/api/resume", { method: "POST", body: formData });
    } catch {
      setParseError({ code: "UNKNOWN", message: "" });
      setStage(null);
      return;
    }

    // Validation errors come back as plain JSON (non-SSE)
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      setParseError({ code: "VALIDATION", message: (data["error"] as string) ?? "" });
      setStage(null);
      return;
    }

    // Read SSE stream
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on double newline to get complete SSE messages
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
            setStage(payload["stage"] as ParseStage);
          } else if (eventName === "result") {
            setStage(null);
            onParsed(payload);
            return;
          } else if (eventName === "error") {
            setParseError({
              code: (payload["code"] as string) ?? "UNKNOWN",
              message: (payload["message"] as string) ?? "",
            });
            setStage(null);
          } else if (eventName === "done") {
            setStage(null);
            return;
          }
        }
      }
    } catch {
      setParseError({ code: "UNKNOWN", message: "" });
    } finally {
      setStage(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-2">{t("title")}</h2>
      <p className="text-gray-500 text-sm mb-6">{t("description")}</p>

      {/* Drag and drop area */}
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-gray-400"
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

        {isLoading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-600">
              {stage === "extracting" && t("stageExtracting", { fileName: fileName ?? "" })}
              {stage === "parsing" && t("stageParsing")}
            </p>
            {/* Two-dot stage progress indicator */}
            <div className="flex gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full transition-colors ${stage === "extracting" ? "bg-blue-500" : "bg-blue-200"}`} />
              <div className={`w-2 h-2 rounded-full transition-colors ${stage === "parsing" ? "bg-blue-500" : "bg-gray-200"}`} />
            </div>
          </div>
        ) : fileName ? (
          <div className="flex flex-col items-center gap-2">
            <div className="text-4xl">📄</div>
            <p className="text-sm font-medium text-gray-700">{fileName}</p>
            <p className="text-xs text-gray-400">{t("replacePrompt")}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="text-4xl">📎</div>
            <p className="text-sm font-medium text-gray-700">{t("dragPrompt")}</p>
            <p className="text-xs text-gray-400">{t("supportedFormats")}</p>
          </div>
        )}
      </div>

      {parseError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          <p>{getErrorMessage(parseError, t)}</p>
          {lastFile && (
            <button
              className="mt-2 text-xs font-medium text-blue-600 hover:underline"
              onClick={(e) => { e.stopPropagation(); handleFile(lastFile); }}
            >
              {t("retryButton")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
