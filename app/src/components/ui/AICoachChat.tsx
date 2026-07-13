"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Bot, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCareerCoachChat, messageText } from "@/hooks/useCareerCoachChat";
import { ChatMessageParts } from "@/components/chat/ChatMessageParts";

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

  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = isOpenProp !== undefined ? isOpenProp : internalOpen;
  const setOpen = (open: boolean) => {
    setInternalOpen(open);
    onOpenChange?.(open);
  };

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, isStreaming, isLoadingHistory, error } = useCareerCoachChat({
    planId,
    targetRole,
    targetCompany,
    gapAnalysis,
  });

  const displayMessages = messages.length === 0 && !isLoadingHistory
    ? [{ id: "greeting", role: "assistant" as const, parts: [{ type: "text" as const, text: t("greeting") }] }]
    : messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages.length, isStreaming]);

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

  function handleSend() {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput("");
    textareaRef.current?.focus();
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
              {isLoadingHistory ? (
                <div className="flex justify-center pt-8">
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {displayMessages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[82%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-muted text-foreground rounded-bl-sm"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <ChatMessageParts message={msg} />
                        ) : (
                          <p className="whitespace-pre-wrap">{messageText(msg)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {(isStreaming && displayMessages[displayMessages.length - 1]?.role !== "assistant") || error ? (
                    <div className="flex justify-start">
                      <div className="max-w-[82%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed bg-muted text-foreground rounded-bl-sm">
                        {error ? (
                          <p>{error.message}</p>
                        ) : (
                          <span className="inline-flex gap-1">
                            <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.3s]" />
                            <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.15s]" />
                            <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" />
                          </span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
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
                      handleSend();
                    }
                  }}
                  placeholder={t("placeholder")}
                  rows={3}
                  className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  disabled={isStreaming}
                />
                <button
                  onClick={handleSend}
                  disabled={isStreaming || !input.trim()}
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
