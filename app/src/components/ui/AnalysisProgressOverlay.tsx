"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";

interface Props {
  isVisible: boolean;
  stage: string;
  progress: number; // 0-100
  reasoning?: string; // streamed LLM output tokens
}

const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function AnalysisProgressOverlay({ isVisible, stage, progress, reasoning }: Props) {
  const t = useTranslations("AnalysisProgressOverlay");
  const [cardIndex, setCardIndex] = useState(0);
  const [displayPct, setDisplayPct] = useState(0);
  const reasoningRef = useRef<HTMLPreElement>(null);

  const insights: string[] = [
    t("insights.0"),
    t("insights.1"),
    t("insights.2"),
    t("insights.3"),
  ];

  // Rotate insight cards every 3 seconds
  useEffect(() => {
    if (!isVisible) return;
    const id = setInterval(() => {
      setCardIndex((prev) => (prev + 1) % insights.length);
    }, 3000);
    return () => clearInterval(id);
  }, [isVisible, insights.length]);

  // Animate displayPct toward the target progress value
  useEffect(() => {
    if (!isVisible) { setDisplayPct(0); return; }
    const diff = progress - displayPct;
    if (diff === 0) return;
    const step = Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) / 20));
    const id = setTimeout(() => {
      setDisplayPct((p) => {
        const next = p + step;
        return diff > 0 ? Math.min(next, progress) : Math.max(next, progress);
      });
    }, 30);
    return () => clearTimeout(id);
  }, [isVisible, progress, displayPct]);

  // Auto-scroll reasoning panel to bottom as tokens arrive
  useEffect(() => {
    if (reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [reasoning]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="analysis-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{ background: "rgba(6,4,14,0.93)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
        >
          <div className="flex flex-col items-center gap-10 px-6 max-w-md w-full">

            {/* ── SVG Progress Ring ── */}
            <div className="relative w-40 h-40 flex items-center justify-center">
              <svg
                width="160"
                height="160"
                viewBox="0 0 160 160"
                className="animate-pulse-ring"
                style={{ filter: "drop-shadow(0 0 12px rgba(139,92,246,0.5))" }}
              >
                {/* Track */}
                <circle
                  cx="80"
                  cy="80"
                  r={RING_RADIUS}
                  fill="none"
                  stroke="hsl(222,100%,95%)"
                  strokeWidth="8"
                />
                {/* Progress arc */}
                <circle
                  cx="80"
                  cy="80"
                  r={RING_RADIUS}
                  fill="none"
                  stroke="url(#ringGradient)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE * (1 - displayPct / 100)}
                  transform="rotate(-90 80 80)"
                  style={{ transition: "stroke-dashoffset 0.4s ease-out" }}
                />
                <defs>
                  <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8B5CF6" />
                    <stop offset="100%" stopColor="#39b8fd" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Center label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-black" style={{ fontFamily: "'Inter', sans-serif", color: "#e0d9ff" }}>
                  {displayPct}%
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: "rgba(224,217,255,0.6)" }}>
                  Analyzing
                </span>
              </div>
            </div>

            {/* ── Stage label ── */}
            <AnimatePresence mode="wait">
              <motion.p
                key={stage}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="text-sm font-semibold text-center tracking-wide uppercase"
                style={{ letterSpacing: "0.08em", fontFamily: "'JetBrains Mono', monospace", color: "rgba(167,139,250,0.9)" }}
              >
                {stage || t("defaultStage")}
              </motion.p>
            </AnimatePresence>

            {/* ── Rotating insight cards ── */}
            <div className="w-full relative h-28">
              <AnimatePresence mode="wait">
                <motion.div
                  key={cardIndex}
                  initial={{ opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -14, scale: 0.97 }}
                  transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  className="absolute inset-0 rounded-2xl p-5 flex flex-col gap-2"
                  style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", border: "1px solid rgba(139,92,246,0.25)" }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  </div>
                  <p className="text-sm leading-relaxed font-medium" style={{ color: "rgba(224,217,255,0.85)" }}>
                    {insights[cardIndex]}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* ── Reasoning stream (shown once LLM starts responding) ── */}
            <AnimatePresence>
              {reasoning && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="w-full"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(134,239,172,0.8)" }}>
                      {t("reasoningLabel")}
                    </span>
                  </div>
                  <pre
                    ref={reasoningRef}
                    className="w-full text-[11px] leading-relaxed overflow-y-auto max-h-28 rounded-xl p-3 font-mono whitespace-pre-wrap break-all"
                    style={{
                      background: "rgba(0,255,128,0.04)",
                      border: "1px solid rgba(134,239,172,0.15)",
                      color: "rgba(134,239,172,0.75)",
                    }}
                  >
                    {reasoning}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Progress dots ── */}
            <div className="flex gap-2">
              {insights.map((_, i) => (
                <div
                  key={i}
                  className="rounded-full transition-all duration-500"
                  style={{
                    width: i === cardIndex ? "20px" : "6px",
                    height: "6px",
                    background: i === cardIndex ? "hsl(258,66%,53%)" : "hsl(270,22%,80%)",
                  }}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
