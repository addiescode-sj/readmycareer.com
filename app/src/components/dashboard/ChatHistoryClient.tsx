"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";
import { Send, MessageSquare, ChevronRight, ChevronDown } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

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
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!plan) return;
    setMessages([]);

    async function fetchHistory() {
      const { data, error } = await supabase
        .from("recent_chat_messages")
        .select("role, content")
        .eq("career_plan_id", plan!.id)
        .order("sequence_number", { ascending: true });

      if (!error && data && data.length > 0) {
        setMessages(data as Message[]);
      } else {
        setMessages([{ role: "assistant", content: t("greeting") }]);
      }
    }
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading || !plan) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    let currentUserId: string | undefined;
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      currentUserId = user.id;
      await supabase.from("chat_messages").insert({
        career_plan_id: plan.id,
        user_id: currentUserId,
        role: "user",
        content: text,
      });
    }

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const gapRaw = plan.gap_analyses
      ? (Array.isArray(plan.gap_analyses) ? plan.gap_analyses[0] : plan.gap_analyses)
      : null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          targetRole: plan.target_role,
          targetCompany: plan.target_company,
          sessionContext: {
            gap_analysis: gapRaw?.summary_json ?? null,
            target_role: plan.target_role,
            target_company: plan.target_company,
          },
        }),
      });

      if (!res.ok || !res.body) throw new Error(t("genericError"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload) as { text?: string };
            if (parsed.text) {
              assistantText += parsed.text;
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: assistantText },
              ]);
            }
          } catch { /* skip */ }
        }
      }

      if (currentUserId && assistantText) {
        await supabase.from("chat_messages").insert({
          career_plan_id: plan.id,
          user_id: currentUserId,
          role: "assistant",
          content: assistantText,
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: t("genericError") },
      ]);
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
      textareaRef.current?.focus();
    }
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
        {messages.map((msg, i) => (
          <motion.div
            key={i}
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
                msg.content ? (
                  <div className="prose prose-sm max-w-none [&_p]:mb-2 [&_ul]:mb-2 [&_li]:mb-1">
                    <ReactMarkdown
                      skipHtml={true}
                      allowedElements={["p", "strong", "em", "ul", "ol", "li", "code", "pre", "blockquote", "h3"]}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <span className="inline-flex gap-1">
                    <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 bg-primary/40 rounded-full animate-bounce" />
                  </span>
                )
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </motion.div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggested questions (first load) */}
      {messages.length <= 1 && (
        <div className="px-5 pb-3 flex flex-wrap gap-2">
          {([
            t("questions.q1"),
            t("questions.q2"),
            t("questions.q3"),
          ] as string[]).map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(q)}
              disabled={isLoading}
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
                sendMessage(input);
              }
            }}
            placeholder={t("placeholder")}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
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
