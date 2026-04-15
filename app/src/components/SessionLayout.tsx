"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SessionProvider, useSession } from "@/hooks/useSession";
import FloatingChat from "@/components/FloatingChat";

interface SlotProps {
  upload: ReactNode;
  goal: ReactNode;
  plan: ReactNode;
  chat: ReactNode;
}

function StepRouter({ upload, goal, plan }: Omit<SlotProps, "chat">) {
  const { step, isLoaded } = useSession();
  const t = useTranslations("SessionLayout");

  const STEPS = [
    { key: "upload", label: t("steps.upload") },
    { key: "goal",   label: t("steps.goal") },
    { key: "plan",   label: t("steps.plan") },
  ] as const;

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {STEPS.map(({ key, label }, i) => (
          <div
            key={key}
            className={`flex items-center gap-2 text-sm ${step === key ? "text-blue-600 font-semibold" : "text-gray-400"
              }`}
          >
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${step === key
                  ? "border-blue-600 bg-blue-600 text-white"
                  : i < stepIndex
                    ? "border-blue-300 bg-blue-100 text-blue-400"
                    : "border-gray-300 text-gray-400"
                }`}
            >
              {i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
            {i < 2 && <span className="text-gray-300 mx-1">›</span>}
          </div>
        ))}
      </div>

      {/* Render only the current step */}
      {step === "upload" && upload}
      {step === "goal" && goal}
      {step === "plan" && plan}

      {/* Floating chat on the career plan step */}
      {step === "plan" && <FloatingChat />}
    </>
  );
}

export function SessionLayout({ upload, goal, plan, chat }: SlotProps) {
  const t = useTranslations("SessionLayout");

  return (
    <SessionProvider>
      <main className="container mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
          <p className="mt-1 text-gray-500">{t("subtitle")}</p>
        </div>
        <StepRouter upload={upload} goal={goal} plan={plan} />
      </main>
    </SessionProvider>
  );
}
