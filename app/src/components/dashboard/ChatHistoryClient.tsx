"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Send, MessageSquare, ChevronRight, ChevronDown } from "lucide-react";
import { useCareerCoachChat, messageText } from "@/hooks/useCareerCoachChat";
import { ChatMessageParts } from "@/components/chat/ChatMessageParts";

interface Plan {
  id: string;
  title: string | null;
  target_role: string;
  target_company: string | null;
  created_at: string;
  gap_analyses: { summary_json: Record<string, unknown> | null } | { summary_json: Record<string, unknown> | null }[] | null;
}

interface Props {
  plans: Plan[];
  initialPlanId: string | null;
}

function ContextPanel({ plan }: { plan: Plan | null }) {
  const t = useTranslations("ConversationHistory");
  const tProfile = useTranslations("CareerProfile");

  if (!plan) return (
    <div className="p-4 text-sm text-muted-foreground">{t("emptyState")}</div>
  );

  const gapRaw = plan.gap_analyses
    ? (Array.isArray(plan.gap_analyses) ? plan.gap_analyses[0] : plan.gap_analyses)
    : null;
  const summaryJson = gapRaw?.summary_json as Record<string, unknown> | null;
  const competencies = (summaryJson?.competencies as Array<{ name: string; score: number }> | undefined) ?? [];
  const findings = (summaryJson?.findings as Array<{ text: string; priority: string }> | undefined) ?? [];

  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto">
      {/* Active track */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t("activeTrack")}</p>
        <div className="glass-card rounded-xl px-3 py-2">
          <p className="text-xs font-bold text-foreground">{plan.target_role}</p>
          {plan.target_company && (
            <p className="text-[11px] text-muted-foreground mt-0.5">@ {plan.target_company}</p>
          )}
        </div>
      </div>

      {/* Top competencies */}
      {competencies.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tProfile("competencies")}</p>
          <div className="space-y-2">
            {competencies.slice(0, 4).map((c) => (
              <div key={c.name} className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-semibold text-foreground">{c.name}</span>
                  <span className="text-[10px] font-black text-primary">{c.score}%</span>
                </div>
                <div className="h-1 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-700"
                    style={{ width: `${c.score}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key findings */}
      {findings.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{tProfile("findings")}</p>
          <ul className="space-y-2">
            {findings.slice(0, 3).map((f, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className={cn(
                  "shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase",
                  f.priority === "high" ? "bg-primary/10 text-primary border border-primary/20" :
                    f.priority === "medium" ? "bg-secondary/10 text-secondary border border-secondary/20" :
                      "bg-muted text-muted-foreground"
                )}>
                  {f.priority}
                </span>
                <p className="text-[11px] text-foreground leading-relaxed line-clamp-2">{f.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChatPanel({ plan }: { plan: Plan | null }) {
  const t = useTranslations("ChatInterface");
  const tHistory = useTranslations("ConversationHistory");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const gapRaw = plan?.gap_analyses
    ? (Array.isArray(plan.gap_analyses) ? plan.gap_analyses[0] : plan.gap_analyses)
    : null;

  const { messages, sendMessage, isStreaming, isLoadingHistory, error } = useCareerCoachChat({
    planId: plan?.id,
    targetRole: plan?.target_role,
    targetCompany: plan?.target_company,
    gapAnalysis: gapRaw?.summary_json ?? null,
  });

  const displayMessages = messages.length === 0 && !isLoadingHistory
    ? [{ id: "greeting", role: "assistant" as const, parts: [{ type: "text" as const, text: t("greeting") }] }]
    : messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages.length, isStreaming]);

  function handleSend(text: string) {
    if (!text.trim() || isStreaming || !plan) return;
    sendMessage(text);
    setInput("");
    textareaRef.current?.focus();
  }

  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <MessageSquare className="w-6 h-6 text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">{tHistory("selectConversation")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 lg:py-4 border-b border-border/50 shrink-0">
        <h2 className="text-xs font-black uppercase tracking-widest text-foreground">{tHistory("chatTitle")}</h2>
        {plan && <p className="text-[10px] text-muted-foreground mt-0.5">{plan.target_role}</p>}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        {isLoadingHistory ? (
          <div className="flex justify-center pt-8">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {displayMessages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <ChatMessageParts message={msg} />
                  ) : (
                    <p className="whitespace-pre-wrap">{messageText(msg)}</p>
                  )}
                </div>
              </motion.div>
            ))}
            {(isStreaming && displayMessages[displayMessages.length - 1]?.role !== "assistant") || error ? (
              <div className="flex justify-start">
                <div className="max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-muted text-foreground rounded-bl-sm">
                  {error ? (
                    <p>{error.message}</p>
                  ) : (
                    <span className="inline-flex gap-1">
                      <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" />
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions (first load, no conversation yet) */}
      {displayMessages.length <= 1 && (
        <div className="px-5 pb-3 flex flex-wrap gap-2">
          {([
            t("questions.q1"),
            t("questions.q2"),
            t("questions.q3"),
          ] as string[]).map((q, i) => (
            <button
              key={i}
              onClick={() => handleSend(q)}
              disabled={isStreaming}
              className="px-3 py-1.5 rounded-full border border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border/50 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(input);
              }
            }}
            placeholder={t("placeholder")}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            disabled={isStreaming}
          />
          <button
            onClick={() => handleSend(input)}
            disabled={isStreaming || !input.trim()}
            className="shrink-0 w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatHistoryClient({ plans, initialPlanId }: Props) {
  const t = useTranslations("ConversationHistory");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(initialPlanId);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100dvh-3.5rem)] lg:h-[calc(100vh-theme(spacing.32))] min-h-0 gap-0 lg:rounded-2xl overflow-hidden border-none lg:border lg:border-border/50 bg-background lg:shadow-sm -m-6 lg:m-0">
      {/* ── Left: Conversations list ── */}
      <div className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-border/50 flex flex-col bg-surface-container-low/50 order-1">
        <div className="px-4 py-3 lg:py-4 border-b border-border/50">
          <h2 className="text-xs font-black uppercase tracking-widest text-foreground">{t("conversationsTitle")}</h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">{t("lastSevenDays")}</p>
        </div>
        <div className="flex lg:flex-col overflow-x-auto lg:overflow-x-hidden overflow-y-hidden lg:overflow-y-auto py-2 px-2 lg:px-0 gap-2 lg:gap-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
          {plans.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">{t("emptyState")}</p>
          ) : (
            plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlanId(plan.id)}
                className={cn(
                  "w-[240px] lg:w-full shrink-0 text-left px-4 py-3 transition-colors group rounded-xl lg:rounded-none border border-border/50 lg:border-transparent lg:border-b-0",
                  selectedPlanId === plan.id
                    ? "bg-primary/10 border-primary lg:border-r-2 lg:border-r-primary lg:border-x-transparent lg:border-y-transparent"
                    : "bg-background lg:bg-transparent hover:bg-muted/50"
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className={cn(
                    "text-xs font-semibold leading-snug line-clamp-2",
                    selectedPlanId === plan.id ? "text-primary" : "text-foreground"
                  )}>
                    {plan.title ?? plan.target_role}
                  </p>
                  <ChevronRight className={cn(
                    "w-3 h-3 shrink-0 mt-0.5 transition-colors hidden lg:block",
                    selectedPlanId === plan.id ? "text-primary" : "text-muted-foreground/0 group-hover:text-muted-foreground"
                  )} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{plan.target_role}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Center: Chat ── */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col order-3 lg:order-2">
        <ChatPanel plan={selectedPlan} />
      </div>

      {/* ── Right: Current context ── */}
      <div className="w-full lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-l border-border/50 bg-surface-container-low/30 flex flex-col order-2 lg:order-3">
        {/* Header: accordion trigger on mobile, static on desktop */}
        <button
          className="w-full px-4 py-3 lg:py-4 border-b border-border/50 shrink-0 flex items-center justify-between lg:pointer-events-none"
          onClick={() => setMobileContextOpen((v) => !v)}
          aria-expanded={mobileContextOpen}
        >
          <div className="text-left">
            <h2 className="text-xs font-black uppercase tracking-widest text-foreground">{t("contextTitle")}</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t("contextSubtitle")}</p>
          </div>
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground transition-transform duration-200 lg:hidden",
              mobileContextOpen && "rotate-180"
            )}
          />
        </button>

        {/* Content: always visible on desktop, accordion on mobile */}
        <div className="hidden lg:flex flex-1 overflow-y-auto min-h-0">
          <div className="w-full">
            <ContextPanel plan={selectedPlan} />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {mobileContextOpen && (
            <motion.div
              key="mobile-context"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeInOut" }}
              className="overflow-hidden lg:hidden"
            >
              <ContextPanel plan={selectedPlan} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
