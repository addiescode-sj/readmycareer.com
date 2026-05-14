"use client";

interface ResumeData {
  personal: {
    name: string | null;
    job_title: string;
    links: string[];
    email: string | null;
    phone: string | null;
  };
  highlights: string[];
  skills: string[];
  experience: Array<{
    company: string;
    title: string;
    period: { start: string; end: string | null };
    achievements: string[];
  }>;
  projects: Array<{
    name: string;
    period: { start: string; end: string | null } | null;
    role: string | null;
    tech_stack: string[];
    description: string | null;
    achievements: string[];
    url: string | null;
  }>;
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

interface Props {
  resumeData: ResumeData;
  meta: Record<string, unknown> | null;
  locale: string;
}

export function SharePagePdfButton({ resumeData, meta, locale }: Props) {
  function handleDownloadPdf() {
    const lang = (meta?.language as string) ?? locale ?? "en";
    const isKo = lang === "ko";
    const labels = {
      highlights:  isKo ? "핵심 성과 및 강점" : "Key Highlights",
      skills:      isKo ? "주요 기술" : "Key Skills",
      experience:  isKo ? "경력사항" : "Work Experience",
      projects:    isKo ? "프로젝트" : "Projects",
      education:   isKo ? "학력" : "Education",
      awards:      isKo ? "수상 내역 및 자격증" : "Awards & Certifications",
      cover:       isKo ? "지원 동기" : "Cover Letter",
    };
    const d = resumeData;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ensureHttps = (url: string) => /^https?:\/\//.test(url) ? url : `https://${url}`;

    const highlightsHtml = (d?.highlights ?? []).map(h => `<li>${esc(h)}</li>`).join("");
    const skillsHtml = (d?.skills ?? []).map(s => `<span class="skill">${esc(s)}</span>`).join("");
    const experienceHtml = (d?.experience ?? []).map(e => {
      const period = `${esc(e.period.start)}${e.period.end ? ` – ${esc(e.period.end)}` : " – present"}`;
      const achievementsHtml = e.achievements.map(a => `<li>${esc(a)}</li>`).join("");
      return `<div class="exp-entry"><strong>${esc(e.title)}</strong> — ${esc(e.company)} <span class="dim">(${period})</span>${achievementsHtml ? `<ul class="exp-list">${achievementsHtml}</ul>` : ""}</div>`;
    }).join("");
    const projectsHtml = (d?.projects ?? []).map(p => {
      const period = p.period
        ? `${esc(p.period.start)}${p.period.end ? ` – ${esc(p.period.end)}` : ""}`
        : null;
      const meta = [p.role, p.tech_stack.join(", ")].filter(Boolean).map(v => esc(v!)).join("  |  ");
      const achievementsHtml = p.achievements.map(a => `<li>${esc(a)}</li>`).join("");
      const urlHtml = p.url ? ` <a href="${esc(ensureHttps(p.url))}" class="proj-link">${isKo ? "프로젝트 링크" : "Project Link"}</a>` : "";
      return `<div class="proj-entry"><strong>${esc(p.name)}</strong>${period ? ` <span class="dim">(${period})</span>` : ""}${urlHtml}${meta ? `<div class="proj-meta">${meta}</div>` : ""}${achievementsHtml ? `<ul class="exp-list">${achievementsHtml}</ul>` : ""}</div>`;
    }).join("");
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

    const tipHtml = isKo
      ? `<div id="tip"><strong>📌 PDF 저장 전:</strong> Chrome 인쇄 창 → <strong>더 많은 설정</strong> → <strong>헤더 및 바닥글</strong> 체크 해제 후 저장하세요.</div>`
      : `<div id="tip"><strong>📌 Before saving PDF:</strong> In Chrome print dialog → <strong>More settings</strong> → uncheck <strong>Headers and footers</strong>.</div>`;

    const html = `<!DOCTYPE html>
<html lang="${isKo ? "ko" : "en"}">
<head>
  <meta charset="utf-8">
  <title>${esc(d?.personal?.name ?? "Resume")}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;font-size:11pt;color:#111;line-height:1.55}
    h1{font-size:20pt;font-weight:900;letter-spacing:-0.5px}
    .job-title{font-size:12pt;color:#6d28d9;margin-top:3px;font-weight:700}
    .contact{display:flex;flex-wrap:wrap;gap:12px;margin-top:5px;font-size:9pt;color:#555}
    .contact a{color:#6d28d9;text-decoration:none}
    .section-label{font-size:7.5pt;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#6d28d9;margin:20px 0 6px;padding-bottom:4px;border-bottom:1.5px solid #ede9fe;break-after:avoid;page-break-after:avoid}
    ul{padding-left:18px;margin:0}
    li{margin-bottom:5px;font-size:10.5pt;break-inside:avoid;page-break-inside:avoid}
    .skills{display:flex;flex-wrap:wrap;gap:5px}
    .skill{background:#f5f3ff;border:1px solid #ddd6fe;border-radius:4px;padding:2px 8px;font-size:9pt}
    .entry{margin-bottom:6px;font-size:10.5pt;break-inside:avoid;page-break-inside:avoid}
    .exp-entry{margin-bottom:12px;font-size:10.5pt;break-inside:avoid;page-break-inside:avoid}
    .exp-list{padding-left:16px;margin:4px 0 0}
    .exp-list li{margin-bottom:3px;font-size:10pt}
    .dim{color:#666;font-size:9.5pt}
    .proj-entry{margin-bottom:12px;font-size:10.5pt;break-inside:avoid;page-break-inside:avoid}
    .proj-meta{font-size:9.5pt;color:#555;margin:2px 0 3px;font-style:italic}
    .proj-link{font-size:9pt;color:#6d28d9;text-decoration:none;margin-left:6px}
    .cover{font-size:10.5pt;line-height:1.8;white-space:pre-line}
    #tip{background:#faf5ff;border:1.5px solid #7c3aed;border-radius:8px;padding:11px 15px;margin-bottom:18px;font-size:9.5pt;color:#4c1d95;line-height:1.6}
    @page{margin:0.75in;size:A4}
    @media print{#tip{display:none}p,.cover,li{orphans:3;widows:3}}
  </style>
</head>
<body>
  ${tipHtml}
  <h1>${esc(d?.personal?.name ?? "")}</h1>
  <div class="job-title">${esc(d?.personal?.job_title ?? "")}</div>
  <div class="contact">
    ${d?.personal?.email ? `<span>${esc(d.personal.email)}</span>` : ""}
    ${d?.personal?.phone ? `<span>${esc(d.personal.phone)}</span>` : ""}
    ${linksHtml}
  </div>
  ${highlightsHtml ? `<div class="section-label">${labels.highlights}</div><ul>${highlightsHtml}</ul>` : ""}
  ${skillsHtml ? `<div class="section-label">${labels.skills}</div><div class="skills">${skillsHtml}</div>` : ""}
  ${experienceHtml ? `<div class="section-label">${labels.experience}</div>${experienceHtml}` : ""}
  ${projectsHtml ? `<div class="section-label">${labels.projects}</div>${projectsHtml}` : ""}
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

  const isKo = ((meta?.language as string) ?? locale ?? "en") === "ko";

  return (
    <button
      onClick={handleDownloadPdf}
      className="px-4 py-2 bg-gradient-to-r from-primary to-secondary text-primary-foreground font-bold text-sm rounded-xl hover:opacity-90 transition-all shadow-xl shadow-primary/20"
    >
      {isKo ? "PDF로 저장" : "Save as PDF"}
    </button>
  );
}
