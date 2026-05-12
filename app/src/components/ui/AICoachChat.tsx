"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import { createClient } from "@/lib/supabase/client";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  planId?: string;
  targetRole?: string;
  targetCompany?: string | null;
  gapAnalysis?: Record<string, unknown> | null;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AICoachChat({
  planId,
  targetRole,
  targetCompany,
  gapAnalysis,
  isOpen: isOpenProp,
  onOpenChange,
}: Props) {
  const t = useTranslations("ChatInterface");
  const tFloat = useTranslations("FloatingChat");
  const supabase = createClient();

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isOpenProp !== undefined ? isOpenProp : internalOpen;

  const setOpen = (open: boolean) => {
    setInternalOpen(open);
    onOpenChange?.(open);
  };

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen || initialized) return;
    setInitialized(true);

    if (planId) {
      supabase
        .from("recent_chat_messages")
        .select("role, content")
        .eq("career_plan_id", planId)
        .order("sequence_number", { ascending: true })
        .then(({ data, error }) => {
          if (!error && data && data.length > 0) {
            setMessages(data as Message[]);
          } else {
            setMessages([{ role: "assistant", content: t("greeting") }]);
          }
        });
    } else {
      setMessages([{ role: "assistant", content: t("greeting") }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handleSidebarState = (e: Event) => {
      const customEvent = e as CustomEvent<{ open: boolean }>;
      if (customEvent.detail.open && window.innerWidth < 1024) {
        setOpen(false);
      }
    };
    window.addEventListener("mobile-sidebar-state", handleSidebarState);
    return () => window.removeEventListener("mobile-sidebar-state", handleSidebarState);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("mobile-chat-state", { detail: { open: isOpen } }));
  }, [isOpen]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setIsLoading(true);

    let currentUserId: string | undefined;
    if (planId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        currentUserId = user.id;
        await supabase.from("chat_messages").insert({
          career_plan_id: planId,
          user_id: currentUserId,
          role: "user",
          content: text,
        });
      }
    }

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          targetRole,
          targetCompany,
          sessionContext: {
            gap_analysis: gapAnalysis ?? null,
            target_role: targetRole,
            target_company: targetCompany,
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
            const parsed = JSON.parse(payload) as { text?: string; error?: string };
            if (parsed.text) {
              assistantText += parsed.text;
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: assistantText },
              ]);
            } else if (parsed.error) {
              assistantText = parsed.error;
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: assistantText },
              ]);
            }
          } catch { /* skip malformed SSE */ }
        }
      }

      if (planId && currentUserId && assistantText) {
        await supabase.from("chat_messages").insert({
          career_plan_id: planId,
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

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end pointer-events-none">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-80 sm:w-96 h-[580px] max-h-[85vh] glass-card-elevated rounded-2xl flex flex-col overflow-hidden pointer-events-auto mb-4 gradient-border"
          >
            {/* Header */}
            <div className="px-4 py-3 bg-primary text-primary-foreground flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <Bot size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-sm">{tFloat("title")}</h3>
                  <p className="text-[10px] text-primary-foreground/70">{tFloat("alwaysHereToHelp")}</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label={tFloat("closeLabel")}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[82%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      msg.content ? (
                        <div className="prose prose-sm max-w-none [&_p]:mb-1 [&_ul]:mb-1">
                          <ReactMarkdown
                            skipHtml={true}
                            allowedElements={["p", "strong", "em", "ul", "ol", "li", "code"]}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <span className="inline-flex gap-1">
                          <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.3s]" />
                          <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.15s]" />
                          <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" />
                        </span>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border/50 p-3 shrink-0">
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
                  rows={3}
                  className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  disabled={isLoading}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={isLoading || !input.trim()}
                  className="shrink-0 w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Action Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(!isOpen)}
        aria-label={tFloat("fabLabel")}
        className="w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-xl shadow-primary/30 flex items-center justify-center hover:opacity-90 transition-opacity pointer-events-auto border-4 border-background"
      >
        {isOpen ? <X size={22} /> : <Bot size={22} />}
      </motion.button>
    </div>
  );
}
