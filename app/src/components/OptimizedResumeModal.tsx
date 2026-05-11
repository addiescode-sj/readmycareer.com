"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface OptimizedResumeData {
  personal: {
    name: string | null;
    job_title: string;
    links: string[];
    email: string | null;
    phone: string | null;
  };
  highlights: string[];
  skills: string[];
  education: Array<{
    institution: string;
    degree: string | null;
    major: string | null;
    period: { start: string; end: string | null };
    gpa: string | null;
  }>;
  awards_and_certs: Array<{
    name: string;
    issuer: string | null;
    date: string | null;
  }>;
  cover_letter: string;
}

interface OptimizedResumeRecord {
  id?: string;
  resume_data: OptimizedResumeData;
  markdown: string;
  meta?: {
    generated_at?: string;
    language?: "ko" | "en";
    keywords_applied?: string[];
  };
  locale?: string;
  created_at?: string;
}

interface Props {
  data: Record<string, unknown>;
  onClose: () => void;
}

export function OptimizedResumeModal({ data, onClose }: Props) {
  const t = useTranslations("OptimizedResumeModal");
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const record = data as unknown as OptimizedResumeRecord;
  const resumeData = record.resume_data;

  // Prevent body scroll while modal is open; mount portal after hydration
  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function handleCopyMarkdown() {
    navigator.clipboard.writeText(record.markdown ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const name = resumeData?.personal?.name ?? "resume";
    const slug = name.toLowerCase().replace(/\s+/g, "-");
    const blob = new Blob([record.markdown ?? ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-optimized.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadPdf() {
    const lang = record.meta?.language ?? record.locale ?? "en";
    const isKo = lang === "ko";
    const labels = {
      highlights: isKo ? "핵심 성과 및 강점" : "Key Highlights",
      skills:     isKo ? "주요 기술" : "Key Skills",
      education:  isKo ? "학력" : "Education",
      awards:     isKo ? "수상 내역 및 자격증" : "Awards & Certifications",
      cover:      isKo ? "지원 동기" : "Cover Letter",
    };
    const d = resumeData;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ensureHttps = (url: string) => /^https?:\/\//.test(url) ? url : `https://${url}`;

    const highlightsHtml = (d?.highlights ?? [])
      .map(h => `<li>${esc(h)}</li>`).join("");
    const skillsHtml = (d?.skills ?? [])
      .map(s => `<span class="skill">${esc(s)}</span>`).join("");
    const educationHtml = (d?.education ?? []).map(e => {
      const degree = [e.degree, e.major].filter((v): v is string => Boolean(v)).map(esc).join(", ");
      const period = `${esc(e.period.start)}${e.period.end ? ` – ${esc(e.period.end)}` : ""}`;
      return `<div class="entry"><strong>${esc(e.institution)}</strong>${degree ? ` — ${degree}` : ""} <span class="dim">(${period})${e.gpa ? ` GPA ${esc(e.gpa)}` : ""}</span></div>`;
    }).join("");
    const awardsHtml = (d?.awards_and_certs ?? []).map(c =>
      `<div class="entry"><strong>${esc(c.name)}</strong>${c.issuer ? ` — ${esc(c.issuer)}` : ""} ${c.date ? `<span class="dim">(${esc(c.date)})</span>` : ""}</div>`
    ).join("");
    const linksHtml = (d?.personal?.links ?? []).map(l =>
      `<a href="${esc(ensureHttps(l))}">${esc(l.replace(/^https?:\/\//, ""))}</a>`
    ).join("");

    const html = `<!DOCTYPE html>
<html lang="${isKo ? "ko" : "en"}">
<head>
  <meta charset="utf-8">
  <title>${esc(d?.personal?.name ?? "Resume")}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:11pt;color:#111;line-height:1.55;padding:0.7in}
    h1{font-size:20pt;font-weight:900;letter-spacing:-0.5px}
    .job-title{font-size:12pt;color:#6d28d9;margin-top:3px;font-weight:700}
    .contact{display:flex;flex-wrap:wrap;gap:12px;margin-top:5px;font-size:9pt;color:#555}
    .contact a{color:#6d28d9;text-decoration:none}
    .section-label{font-size:7.5pt;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#6d28d9;margin:20px 0 5px;padding-bottom:3px;border-bottom:1.5px solid #ede9fe}
    ul{padding-left:18px;margin:0}
    li{margin-bottom:5px;font-size:10.5pt}
    .skills{display:flex;flex-wrap:wrap;gap:5px}
    .skill{background:#f5f3ff;border:1px solid #ddd6fe;border-radius:4px;padding:2px 8px;font-size:9pt}
    .entry{margin-bottom:5px;font-size:10.5pt}
    .dim{color:#666;font-size:9.5pt}
    .cover{font-size:10.5pt;line-height:1.8;white-space:pre-line}
    @page{margin:0}
    @media print{body{padding:0.7in}}
  </style>
</head>
<body>
  <h1>${esc(d?.personal?.name ?? "")}</h1>
  <div class="job-title">${esc(d?.personal?.job_title ?? "")}</div>
  <div class="contact">
    ${d?.personal?.email ? `<span>${esc(d.personal.email)}</span>` : ""}
    ${d?.personal?.phone ? `<span>${esc(d.personal.phone)}</span>` : ""}
    ${linksHtml}
  </div>
  ${highlightsHtml ? `<div class="section-label">${labels.highlights}</div><ul>${highlightsHtml}</ul>` : ""}
  ${skillsHtml ? `<div class="section-label">${labels.skills}</div><div class="skills">${skillsHtml}</div>` : ""}
  ${educationHtml ? `<div class="section-label">${labels.education}</div>${educationHtml}` : ""}
  ${awardsHtml ? `<div class="section-label">${labels.awards}</div>${awardsHtml}` : ""}
  ${d?.cover_letter ? `<div class="section-label">${labels.cover}</div><p class="cover">${esc(d.cover_letter)}</p>` : ""}
  <script>window.onload=function(){window.print();}<\/script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=820,height=1060");
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }

  const keywords = record.meta?.keywords_applied ?? [];

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel — full-screen */}
      <div
        className={cn(
          "absolute inset-0 overflow-hidden",
          "bg-white/95 backdrop-blur-[20px]",
          "flex flex-col"
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b border-border/50 shrink-0">
          <div>
            <h2 className="text-headline-md font-bold text-foreground tracking-tight">
              {t("title")}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">{t("generatedNote")}</p>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {keywords.slice(0, 8).map(kw => (
                  <span
                    key={kw}
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground font-bold text-lg"
            aria-label={t("close")}
          >
            ×
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Personal info */}
          {resumeData?.personal && (
            <section>
              <h3 className="text-xl font-black text-foreground tracking-tight">
                {resumeData.personal.name}
              </h3>
              <p className="text-sm font-semibold text-primary mt-0.5">
                {resumeData.personal.job_title}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                {resumeData.personal.email && <span>{resumeData.personal.email}</span>}
                {resumeData.personal.phone && <span>{resumeData.personal.phone}</span>}
                {resumeData.personal.links.map(link => (
                  <a
                    key={link}
                    href={/^https?:\/\//.test(link) ? link : `https://${link}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {link.replace(/^https?:\/\//, "")}
                  </a>
                ))}
              </div>
            </section>
          )}

          <div className="border-t border-border/50" />

          {/* Key highlights */}
          {resumeData?.highlights?.length > 0 && (
            <section>
              <h4 className="text-xs font-black uppercase tracking-[0.15em] text-primary/70 mb-3">
                {t("sectionHighlights")}
              </h4>
              <ul className="space-y-2">
                {resumeData.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    {h}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Skills */}
          {resumeData?.skills?.length > 0 && (
            <section>
              <h4 className="text-xs font-black uppercase tracking-[0.15em] text-primary/70 mb-3">
                {t("sectionSkills")}
              </h4>
              <div className="flex flex-wrap gap-2">
                {resumeData.skills.map(skill => (
                  <span
                    key={skill}
                    className="px-2.5 py-1 rounded text-xs font-semibold bg-surface-container text-on-surface border border-outline-variant"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Education */}
          {resumeData?.education?.length > 0 && (
            <section>
              <h4 className="text-xs font-black uppercase tracking-[0.15em] text-primary/70 mb-3">
                {t("sectionEducation")}
              </h4>
              <ul className="space-y-1">
                {resumeData.education.map((e, i) => {
                  const degree = [e.degree, e.major].filter(Boolean).join(", ");
                  const period = `${e.period.start}${e.period.end ? ` – ${e.period.end}` : ""}`;
                  return (
                    <li key={i} className="text-sm text-foreground">
                      <span className="font-semibold">{e.institution}</span>
                      {degree && <span className="text-muted-foreground"> — {degree}</span>}
                      <span className="text-muted-foreground text-xs ml-1">({period})</span>
                      {e.gpa && <span className="text-muted-foreground text-xs ml-1">GPA {e.gpa}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Awards & Certifications */}
          {resumeData?.awards_and_certs?.length > 0 && (
            <section>
              <h4 className="text-xs font-black uppercase tracking-[0.15em] text-primary/70 mb-3">
                {t("sectionAwardsCerts")}
              </h4>
              <ul className="space-y-1">
                {resumeData.awards_and_certs.map((c, i) => (
                  <li key={i} className="text-sm text-foreground">
                    <span className="font-semibold">{c.name}</span>
                    {c.issuer && <span className="text-muted-foreground"> — {c.issuer}</span>}
                    {c.date && <span className="text-muted-foreground text-xs ml-1">({c.date})</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Cover letter */}
          {resumeData?.cover_letter && (
            <section>
              <h4 className="text-xs font-black uppercase tracking-[0.15em] text-primary/70 mb-3">
                {t("sectionCoverLetter")}
              </h4>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                {resumeData.cover_letter}
              </p>
            </section>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border/50 shrink-0 bg-white/60">
          <button
            onClick={handleCopyMarkdown}
            className="px-4 py-2 border border-border bg-background text-foreground font-bold text-sm rounded-xl hover:bg-muted transition-all"
          >
            {copied ? t("copied") : t("copyMarkdown")}
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 border border-border bg-background text-foreground font-bold text-sm rounded-xl hover:bg-muted transition-all"
          >
            {t("download")}
          </button>
          <button
            onClick={handleDownloadPdf}
            className="px-4 py-2 bg-gradient-to-r from-primary to-secondary text-primary-foreground font-bold text-sm rounded-xl hover:opacity-90 transition-all shadow-xl shadow-primary/20"
          >
            {t("downloadPdf")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
