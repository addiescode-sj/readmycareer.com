"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useTranslations } from "next-intl";

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
}

export default function ChatInterface({
  resumeJson: _resumeJson,
  gapAnalysis,
  careerPlan,
  targetRole,
  targetCompany,
  compact = false,
}: Props) {
  const t = useTranslations("ChatInterface");

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

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

      if (!res.body) throw new Error(t("noStream"));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let streamDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(payload) as { text?: string; error?: string };
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.text) {
              assistantText += parsed.text;
              setMessages((prev) => [
                ...prev.slice(0, -1),
                { role: "assistant", content: assistantText },
              ]);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) {
              // Ignore JSON parse failures
            } else {
              throw parseErr; // Propagate server errors to the outer catch
            }
          }
        }
        if (streamDone) break;
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
      <div className={compact ? "flex flex-col flex-1 overflow-hidden" : "bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col h-[500px]"}>
        {/* Message list */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-900 rounded-bl-sm"
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
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
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
        <div className="border-t border-gray-100 p-4">
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
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none text-[#333333]"
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-end"
            >
              {t("sendButton")}
            </button>
          </div>
        </div>
      </div>

      {/* Suggested questions */}
      {messages.length <= 2 && (
        <div className="flex flex-col gap-2 px-5 py-5">
          <p className="text-xs text-gray-400 font-medium">{t("suggestedQuestions")}</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                disabled={isLoading}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50"
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
