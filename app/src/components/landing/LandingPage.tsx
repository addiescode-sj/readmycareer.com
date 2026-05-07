"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { Search, Map, Brain } from "lucide-react";
import "./landing.css";

// ─── Constants ───────────────────────────────────────────────────────────────

const SKILLS = [
  "System Architecture", "Go Lang", "Kubernetes", "Machine Learning",
  "Cloud Deployment", "Data Engineering", "TypeScript", "React",
  "Node.js", "Python", "PostgreSQL", "GraphQL", "Docker", "Next.js",
];

const PROXIMITY_RADIUS = 220;
const LINE_CONNECT_RADIUS = 160;
const LINE_MIN_INTENSITY = 0.25;

// ─── Main Component ──────────────────────────────────────────────────────────

export default function LandingPage() {
  const t = useTranslations("LandingPage");
  const router = useRouter();
  const [signinLoading, setSigninLoading] = useState(false);
  const pillRefs = useRef<(HTMLDivElement | null)[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const intensitiesRef = useRef<number[]>(SKILLS.map(() => 0));
  const rafRef = useRef<number | null>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });

  const handleStart = useCallback(() => {
    router.push("/?new=true");
  }, [router]);

  const handleSignIn = useCallback(async () => {
    setSigninLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
      },
    });
    if (error) {
      console.error("OAuth error:", error);
      setSigninLoading(false);
    }
  }, []);

  // ── Cursor proximity engine ──────────────────────────────────────────────

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });

    const tick = () => {
      const canvas = canvasRef.current;
      const { x: mx, y: my } = mouseRef.current;

      const newIntensities = pillRefs.current.map((pill) => {
        if (!pill) return 0;
        const rect = pill.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(cx - mx, cy - my);
        return Math.max(0, 1 - dist / PROXIMITY_RADIUS);
      });

      // Apply styles to pills
      pillRefs.current.forEach((pill, i) => {
        if (!pill) return;
        const intensity = newIntensities[i] ?? 0;
        const glow = intensity * 0.65;
        pill.style.boxShadow = intensity > 0.02
          ? `0 ${10 * intensity}px ${25 * intensity}px -5px rgba(139,92,246,${glow}), 0 ${8 * intensity}px ${10 * intensity}px -6px rgba(139,92,246,${glow * 0.8})`
          : "";
        pill.style.transform = intensity > 0.02
          ? `translateY(${-5 * intensity}px) scale(${1 + 0.06 * intensity})`
          : "";
        pill.style.borderColor = intensity > 0.02
          ? `rgba(255,255,255,${0.2 + 0.4 * intensity})`
          : "";
        pill.style.background = intensity > 0.02
          ? `rgba(255,255,255,${0.06 + 0.12 * intensity})`
          : "";
      });

      intensitiesRef.current = newIntensities;

      // Draw connection lines on canvas
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const positions = pillRefs.current.map((pill) => {
            if (!pill) return null;
            const rect = pill.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          });

          for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
              const a = positions[i];
              const b = positions[j];
              if (!a || !b) continue;
              const ia = newIntensities[i] ?? 0;
              const ib = newIntensities[j] ?? 0;
              if (ia < LINE_MIN_INTENSITY || ib < LINE_MIN_INTENSITY) continue;
              const dist = Math.hypot(a.x - b.x, a.y - b.y);
              if (dist > LINE_CONNECT_RADIUS) continue;

              const alpha = Math.min(ia, ib) * (1 - dist / LINE_CONNECT_RADIUS) * 0.55;
              const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
              grad.addColorStop(0, `rgba(139,92,246,${alpha})`);
              grad.addColorStop(0.5, `rgba(196,168,255,${alpha * 1.2})`);
              grad.addColorStop(1, `rgba(139,92,246,${alpha})`);
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.strokeStyle = grad;
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      className="bg-synthetic-gradient relative min-h-screen w-full flex flex-col overflow-hidden text-white"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* ── Connection lines canvas overlay ── */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-10 pointer-events-none"
        aria-hidden="true"
      />

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col items-center justify-center pt-16 pb-8 px-6 relative z-20 min-h-screen">
        <div className="max-w-4xl w-full mx-auto flex flex-col items-center text-center">

          {/* Headline */}
          <h2
            className="fade-up-1 font-black text-white drop-shadow-2xl mb-5 leading-[1.08]"
            style={{
              fontSize: "clamp(2.8rem, 6vw, 4.5rem)",
              letterSpacing: "-0.02em",
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {t("headline")}{" "}
            <p
              style={{
                background: "linear-gradient(to right, #e9d5ff, #fbcfe8)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {t("headlineHighlight")}
            </p>
          </h2>

          {/* Sub-headline */}
          <p
            className="fade-up-2 text-purple-100 max-w-2xl mb-14 opacity-90 leading-relaxed"
            style={{ fontSize: "1.15rem", fontFamily: "'Inter', sans-serif" }}
          >
            {t("subheadline")}
          </p>

          {/* ── Floating Skill Cloud ── */}
          <div ref={containerRef} className="fade-up-3 w-full max-w-3xl mb-14 floating-container">
            <div className="flex flex-wrap justify-center gap-4 py-2">
              {SKILLS.map((skill, i) => (
                <div
                  key={skill}
                  ref={(el) => { pillRefs.current[i] = el; }}
                  className="skill-pill glass-panel px-6 py-3 rounded-full text-purple-100 border border-white/20 cursor-default select-none"
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.8rem",
                    transition: "box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease, background 0.25s ease",
                  }}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>{skill}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Primary CTA ── */}
          <div className="fade-up-4 w-full max-w-md mb-4 mx-auto">
            <button
              onClick={handleStart}
              className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-white border border-white/20 rounded-full shadow-2xl hover:bg-gray-50 transition-all duration-300 transform hover:-translate-y-1"
            >
              <span className="text-xl">✨</span>
              <span
                className="font-semibold text-gray-800 text-lg"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                {t("ctaButton")}
              </span>
            </button>
          </div>

          {/* ── Secondary sign-in link ── */}
          <div className="fade-up-4 mb-10 text-center">
            <button
              onClick={handleSignIn}
              disabled={signinLoading}
              className="text-purple-200/70 hover:text-purple-100 text-sm transition-colors disabled:opacity-50"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              {signinLoading ? t("redirecting") : t("signInLink")}
            </button>
          </div>

          {/* ── Feature Highlights Footer Pill ── */}
          <div className="fade-up-5 glass-panel px-8 py-4 rounded-full flex flex-wrap items-center gap-x-8 gap-y-3 justify-center max-w-2xl">
            <FeatureBadge icon={<Search className="w-5 h-5 text-purple-300" />} label={t("featureGapAnalysis")} />
            <FeatureBadge icon={<Map className="w-5 h-5 text-purple-300" />} label={t("featureRoadmap")} />
            <FeatureBadge icon={<Brain className="w-5 h-5 text-purple-300" />} label={t("featureCoaching")} />
          </div>

        </div>
      </main>

      {/* ── Ambient Orbs ── */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-[20%] left-[10%] w-64 h-64 bg-white/5 rounded-full blur-[40px] mix-blend-overlay" />
        <div className="absolute bottom-[20%] right-[10%] w-96 h-96 bg-purple-500/10 rounded-full blur-[60px] mix-blend-screen" />
        <div className="absolute top-[60%] left-[50%] -translate-x-1/2 w-[600px] h-[300px] bg-primary/5 rounded-full blur-[80px]" />
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FeatureBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span
        className="text-purple-100 font-medium text-sm"
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        {label}
      </span>
    </div>
  );
}
