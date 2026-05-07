"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";

interface Message {
  role: "user" | "assistant";
  content: string;
}

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
  const supabase = createClient();

  const SUGGESTED_QUESTIONS = [
    t("questions.q1"),
    t("questions.q2"),
    t("questions.q3"),
    t("questions.q4"),
  ];

  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: t("greeting") },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!planId) return;

    async function fetchHistory() {
      const { data, error } = await supabase
        .from("recent_chat_messages")
        .select("role, content")
        .eq("career_plan_id", planId)
        .order("sequence_number", { ascending: true });

      if (!error && data && data.length > 0) {
        setMessages(data as Message[]);
      }
    }

    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    let currentUserId: string | undefined;

    // Save user message to Supabase
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

    // Add assistant message placeholder
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "" },
    ]);

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
            gap_analysis: gapAnalysis,
            career_plan: careerPlan,
            target_role: targetRole,
            target_company: targetCompany,
          },
        }),
      });
      // clearTimeout is called in finally after streaming completes

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as Record<string, string>;
        throw new Error(errBody["error"] ?? t("genericError"));
      }

      if (!res.body) throw new Error(t("noStream"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let streamDone = false;
      let buffer = "";

      const processLine = (line: string) => {
        if (!line.startsWith("data: ")) return;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") { streamDone = true; return; }

        try {
          const parsed = JSON.parse(payload) as { text?: string; error?: string };
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) {
            assistantText += parsed.text;
            setMessages((prev) => [
              ...prev.slice(0, -1),
              { role: "assistant", content: assistantText },
            ]);
          }
        } catch (parseErr) {
          if (!(parseErr instanceof SyntaxError)) throw parseErr;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
        if (streamDone) break;
      }

      // Flush any remaining buffered content
      if (buffer.trim()) processLine(buffer.trim());

      // Replace placeholder with error message if no content was streamed
      if (!assistantText) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: t("genericError") },
        ]);
        return;
      }

      // Save assistant message to Supabase
      if (planId && currentUserId && assistantText) {
        await supabase.from("chat_messages").insert({
          career_plan_id: planId,
          user_id: currentUserId,
          role: "assistant",
          content: assistantText,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t("genericError");
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: t("errorPrefix", { message: errMsg }) },
      ]);
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }

  return (
    <div className={compact ? "flex flex-col h-full" : "flex flex-col gap-4"}>
      {/* Chat area */}
      <div className={compact ? "flex flex-col flex-1 overflow-hidden" : "glass-card rounded-2xl flex flex-col h-[500px]"}>
        {/* Message list */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                  }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none">
                    {msg.content ? (
                      <ReactMarkdown
                        skipHtml={true}
                        allowedElements={["p", "strong", "em", "code", "pre", "ul", "ol", "li", "blockquote", "a", "h1", "h2", "h3", "br"]}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce" />
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}
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
                  sendMessage(input);
                }
              }}
              placeholder={t("placeholder")}
              rows={2}
              className="flex-1 border border-input rounded-xl px-3 py-2 text-sm resize-none bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity self-end"
            >
              {t("sendButton")}
            </button>
          </div>
        </div>
      </div>

      {/* Suggested questions */}
      {messages.length <= 2 && (
        <div className="flex flex-col gap-2 px-5 py-5">
          <p className="text-xs text-muted-foreground font-medium">{t("suggestedQuestions")}</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                disabled={isLoading}
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
