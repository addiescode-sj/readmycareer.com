import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Logo } from "@/components/ui/Logo";
import { SharePagePdfButton } from "./SharePagePdfButton";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  params: Promise<{ id: string }>;
}

async function fetchRecord(id: string) {
  if (!UUID_RE.test(id)) return null;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("optimized_resumes")
    .select("id, resume_data, markdown, meta, locale, created_at")
    .eq("id", id)
    .single();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const record = await fetchRecord(id);
  if (!record) return { title: "Resume Not Found | readmycareer.com" };
  const d = record.resume_data as ResumeData;
  const name = d?.personal?.name ?? "Resume";
  const title = d?.personal?.job_title ?? "";
  return {
    title: `${name}${title ? ` — ${title}` : ""} | readmycareer.com`,
    description: `AI-optimized resume for ${name} on readmycareer.com`,
    openGraph: {
      title: `${name}${title ? ` — ${title}` : ""}`,
      description: `AI-optimized resume on readmycareer.com`,
      siteName: "readmycareer.com",
    },
  };
}

export default async function ShareResumePage({ params }: Props) {
  const { id } = await params;
  const record = await fetchRecord(id);
  if (!record) notFound();

  const d = record.resume_data as ResumeData;
  const meta = record.meta as Record<string, unknown> | null;
  const lang = (meta?.language as string) ?? record.locale ?? "en";
  const isKo = lang === "ko";

  const labels = {
    highlights: isKo ? "핵심 성과 및 강점" : "Key Highlights",
    skills:     isKo ? "주요 기술" : "Key Skills",
    experience: isKo ? "경력사항" : "Work Experience",
    projects:   isKo ? "프로젝트" : "Projects",
    education:  isKo ? "학력" : "Education",
    awards:     isKo ? "수상 내역 및 자격증" : "Awards & Certifications",
    cover:      isKo ? "지원 동기" : "Cover Letter",
  };

  const sectionLabel = "text-xs font-black uppercase tracking-[0.15em] text-primary/70 mb-3";

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky branding header */}
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-[20px] border-b border-border/50 shadow-glass">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2.5 group" aria-label="readmycareer home">
            <Logo size={28} />
            <span className="font-black text-sm tracking-tight text-foreground group-hover:text-primary transition-colors">
              readmycareer.com
            </span>
          </a>
          <SharePagePdfButton resumeData={d} meta={meta} locale={record.locale} />
        </div>
      </header>

      {/* Resume content */}
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        {/* Personal info */}
        {d?.personal && (
          <section>
            <h1 className="text-headline-lg font-black text-foreground tracking-tight">
              {d.personal.name}
            </h1>
            <p className="text-sm font-semibold text-primary mt-1">
              {d.personal.job_title}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
              {d.personal.email && <span>{d.personal.email}</span>}
              {d.personal.phone && <span>{d.personal.phone}</span>}
              {d.personal.links.map(link => (
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

        {/* Key Highlights */}
        {d?.highlights?.length > 0 && (
          <section>
            <h4 className={sectionLabel}>{labels.highlights}</h4>
            <ul className="space-y-2">
              {d.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                  {h}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Key Skills */}
        {d?.skills?.length > 0 && (
          <section>
            <h4 className={sectionLabel}>{labels.skills}</h4>
            <div className="flex flex-wrap gap-2">
              {d.skills.map(skill => (
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

        {/* Work Experience */}
        {d?.experience?.length > 0 && (
          <section>
            <h4 className={sectionLabel}>{labels.experience}</h4>
            <ul className="space-y-4">
              {d.experience.map((e, i) => {
                const period = `${e.period.start}${e.period.end ? ` – ${e.period.end}` : " – present"}`;
                return (
                  <li key={i}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{e.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{period}</span>
                    </div>
                    <p className="text-xs text-primary font-medium mb-1">{e.company}</p>
                    <ul className="space-y-1 mt-1">
                      {e.achievements.map((a, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-sm text-foreground leading-relaxed">
                          <span className="w-1 h-1 rounded-full bg-muted-foreground mt-2 shrink-0" />
                          {a}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Projects */}
        {d?.projects?.length > 0 && (
          <section>
            <h4 className={sectionLabel}>{labels.projects}</h4>
            <ul className="space-y-4">
              {d.projects.map((p, i) => {
                const period = p.period
                  ? `${p.period.start}${p.period.end ? ` – ${p.period.end}` : ""}`
                  : null;
                const meta = [p.role, p.tech_stack.join(", ")].filter(Boolean).join("  |  ");
                return (
                  <li key={i}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{p.name}</span>
                      {period && <span className="text-xs text-muted-foreground shrink-0">{period}</span>}
                    </div>
                    {meta && <p className="text-xs text-muted-foreground italic mb-1">{meta}</p>}
                    {p.url && (
                      <a
                        href={/^https?:\/\//.test(p.url) ? p.url : `https://${p.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline mb-1 inline-block"
                      >
                        {p.url.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                    {p.achievements.length > 0 && (
                      <ul className="space-y-1 mt-1">
                        {p.achievements.map((a, j) => (
                          <li key={j} className="flex items-start gap-1.5 text-sm text-foreground leading-relaxed">
                            <span className="w-1 h-1 rounded-full bg-muted-foreground mt-2 shrink-0" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Education */}
        {d?.education?.length > 0 && (
          <section>
            <h4 className={sectionLabel}>{labels.education}</h4>
            <ul className="space-y-1">
              {d.education.map((e, i) => {
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
        {d?.awards_and_certs?.length > 0 && (
          <section>
            <h4 className={sectionLabel}>{labels.awards}</h4>
            <ul className="space-y-1">
              {d.awards_and_certs.map((c, i) => (
                <li key={i} className="text-sm text-foreground">
                  <span className="font-semibold">{c.name}</span>
                  {c.issuer && <span className="text-muted-foreground"> — {c.issuer}</span>}
                  {c.date && <span className="text-muted-foreground text-xs ml-1">({c.date})</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Cover Letter */}
        {d?.cover_letter && (
          <section>
            <h4 className={sectionLabel}>{labels.cover}</h4>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
              {d.cover_letter}
            </p>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-border/50 py-8">
        <div className="max-w-3xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {isKo ? "readmycareer.com — AI 커리어 코치" : "readmycareer.com — AI Career Coach"}
          </p>
          <a
            href="/"
            className="text-xs font-semibold text-primary hover:underline"
          >
            {isKo ? "나만의 이력서 만들기 →" : "Create your own resume →"}
          </a>
        </div>
      </footer>
    </div>
  );
}
