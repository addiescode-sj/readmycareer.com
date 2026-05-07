"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const insights = [
  "Our Career Agent is architecting your growth path...",
  "Synthesizing market trends with your unique skill signature...",
  "Precision-mapping the bridge between where you are and where you'll be...",
  "Simulating interview success scenarios for your target role...",
  "Optimizing your weekly roadmap for maximum technical impact..."
];

export const AnalysisProgress: React.FC = () => {
  const [currentInsightIndex, setCurrentInsightIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const insightInterval = setInterval(() => {
      setCurrentInsightIndex((prev) => (prev + 1) % insights.length);
    }, 4000);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 70) {
          clearInterval(progressInterval);
          return 70;
        }
        return prev + 1;
      });
    }, 100);

    return () => {
      clearInterval(insightInterval);
      clearInterval(progressInterval);
    };
  }, []);

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center min-h-[450px] space-y-16 w-full max-w-lg mx-auto">
      {/* Immersive Progress Ring */}
      <div className="relative flex items-center justify-center">
        {/* Glowing background aura */}
        <div className="absolute w-48 h-48 bg-primary/20 rounded-full blur-[60px] animate-pulse" />

        <svg
          className="transform -rotate-90 w-48 h-48 relative z-10"
          viewBox="0 0 160 160"
        >
          {/* Track */}
          <circle
            cx="80"
            cy="80"
            r={radius}
            stroke="currentColor"
            strokeWidth="6"
            fill="transparent"
            className="text-muted/10"
          />
          {/* Progress */}
          <motion.circle
            cx="80"
            cy="80"
            r={radius}
            stroke="currentColor"
            strokeWidth="6"
            fill="transparent"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="text-primary"
            style={{ filter: "drop-shadow(0 0 12px rgba(139, 92, 246, 0.8))" }}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center z-20">
          <span className="text-4xl font-black tracking-tighter text-foreground">{progress}%</span>
          <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary mt-2 animate-pulse">Analyzing</span>
        </div>
      </div>

      {/* Rotating Insight Cards */}
      <div className="relative w-full h-32 flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentInsightIndex}
            initial={{ opacity: 0, y: 30, scale: 0.9, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -30, scale: 0.9, filter: "blur(10px)" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="absolute w-full px-8 py-6 glass-card rounded-3xl flex items-center gap-6 shadow-2xl shadow-primary/5 border-primary/20"
          >
            <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <div className="w-2 h-2 bg-primary rounded-full animate-ping" />
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-1">CareerEngine Insight</p>
              <p className="text-sm text-foreground font-medium leading-relaxed italic">
                "{insights[currentInsightIndex]}"
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
