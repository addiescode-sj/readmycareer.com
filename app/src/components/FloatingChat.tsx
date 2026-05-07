"use client";

import { useTranslations } from "next-intl";
import { useSession } from "@/hooks/useSession";
import ChatInterface from "@/components/ChatInterface";

export default function FloatingChat() {
  const t = useTranslations("FloatingChat");
  const {
    step,
    isChatOpen,
    goToChat,
    closeChat,
    resumeJson,
    gapAnalysis,
    careerPlan,
    targetRole,
    targetCompany,
  } = useSession();

  if (step !== "plan") return null;

  return (
    <>
      {/* Chat panel */}
      <div
        className={`fixed bottom-6 right-6 w-96 glass-card-elevated rounded-2xl shadow-2xl flex flex-col transition-all duration-300 ease-out z-50 gradient-border ${
          isChatOpen
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
        style={{ height: "520px" }}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 rounded-t-2xl bg-primary text-primary-foreground shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">💬</span>
            <span className="text-sm font-bold">{t("title")}</span>
          </div>
          <button
            onClick={closeChat}
            className="w-7 h-7 flex items-center justify-center rounded-full text-primary-foreground/70 hover:text-primary-foreground hover:bg-white/20 transition-colors text-lg leading-none"
            aria-label={t("closeLabel")}
          >
            ×
          </button>
        </div>

        {/* Chat body */}
        <div className="flex-1 overflow-hidden">
          <ChatInterface
            resumeJson={resumeJson}
            gapAnalysis={gapAnalysis}
            careerPlan={careerPlan}
            targetRole={targetRole}
            targetCompany={targetCompany}
            compact
          />
        </div>
      </div>

      {/* FAB button — only shown when panel is closed */}
      {!isChatOpen && (
        <button
          onClick={goToChat}
          className="fixed bottom-6 right-6 w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-xl shadow-primary/30 hover:opacity-90 active:scale-95 transition-all flex items-center justify-center text-2xl z-50 border-4 border-background"
          aria-label={t("fabLabel")}
        >
          💬
        </button>
      )}
    </>
  );
}
