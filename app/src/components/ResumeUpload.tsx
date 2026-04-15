"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";

interface Props {
  onParsed: (resumeJson: Record<string, unknown>) => void;
}

export default function ResumeUpload({ onParsed }: Props) {
  const t = useTranslations("ResumeUpload");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/resume", { method: "POST", body: formData });
      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        throw new Error((data["error"] as string) ?? t("parseError"));
      }

      onParsed(data);
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
            <p className="text-sm text-gray-600">{t("analyzing", { fileName: fileName ?? "" })}</p>
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

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
