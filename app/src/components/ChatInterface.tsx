"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useCareerCoachChat, messageText } from "@/hooks/useCareerCoachChat";
import { ChatMessageParts } from "@/components/chat/ChatMessageParts";

interface Props {
  resumeJson: Record<string, unknown> | null;
  gapAnalysis: Record<string, unknown> | null;
  careerPlan: Record<string, unknown> | null;
  targetRole: string | null;
  targetCompany: string | null;
  /** true when used inside a floating panel — fills full height without an outer wrapper */
  compact?: boolean;
  planId?: string;
}

export default function ChatInterface({
  resumeJson: _resumeJson,
  gapAnalysis,
  careerPlan,
  targetRole,
  targetCompany,
  compact = false,
  planId,
}: Props) {
  const t = useTranslations("ChatInterface");

  const SUGGESTED_QUESTIONS = [
    t("questions.q1"),
    t("questions.q2"),
    t("questions.q3"),
    t("questions.q4"),
  ];

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, isStreaming, isLoadingHistory, error } = useCareerCoachChat({
    planId,
    targetRole,
    targetCompany,
    gapAnalysis,
    careerPlan,
  });

  const displayMessages = messages.length === 0 && !isLoadingHistory
    ? [{ id: "greeting", role: "assistant" as const, parts: [{ type: "text" as const, text: t("greeting") }] }]
    : messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages.length, isStreaming]);

  function handleSend(text: string) {
    if (!text.trim() || isStreaming) return;
    sendMessage(text);
    setInput("");
    textareaRef.current?.focus();
  }

  return (
    <div className={compact ? "flex flex-col h-full" : "flex flex-col gap-4"}>
      {/* Chat area */}
      <div className={compact ? "flex flex-col flex-1 overflow-hidden" : "glass-card rounded-2xl flex flex-col h-[500px]"}>
        {/* Message list */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {displayMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${msg.role === "user"
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
              <div className="max-w-[80%] rounded-2xl px-4 py-3 text-sm bg-muted text-foreground rounded-bl-sm">
                {error ? (
                  <p>{t("errorPrefix", { message: error.message })}</p>
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
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border/50 p-4">
          <div className="flex gap-2">
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
              rows={2}
              className="flex-1 border border-input rounded-xl px-3 py-2 text-sm resize-none bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              disabled={isStreaming}
            />
            <button
              onClick={() => handleSend(input)}
              disabled={isStreaming || !input.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity self-end"
            >
              {t("sendButton")}
            </button>
          </div>
        </div>
      </div>

      {/* Suggested questions */}
      {displayMessages.length <= 2 && (
        <div className="flex flex-col gap-2 px-5 py-5">
          <p className="text-xs text-muted-foreground font-medium">{t("suggestedQuestions")}</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => handleSend(q)}
                disabled={isStreaming}
                className="px-3 py-1.5 bg-background border border-border rounded-full text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
