"use client";

import { useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { createClient } from "@/lib/supabase/client";
import { useChatMessages, useAppendChatMessages } from "@/hooks/useChatMessages";

interface UseCareerCoachChatOptions {
  planId?: string | null;
  targetRole?: string | null;
  targetCompany?: string | null;
  gapAnalysis?: Record<string, unknown> | null;
  careerPlan?: Record<string, unknown> | null;
}

/** Extracts the plain-text content of a UIMessage, joining its text parts. */
export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function toUIMessages(messages: { role: "user" | "assistant"; content: string }[]): UIMessage[] {
  return messages.map((m, i) => ({
    id: `history-${i}`,
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
  }));
}

/**
 * Shared chat engine for all three chat surfaces (floating widget, plan-detail panel,
 * conversation history). Wraps @ai-sdk/react's useChat with: history seeded from Supabase
 * (via TanStack Query), and durable persistence of each finished turn back to Supabase.
 *
 * History loads asynchronously, so the underlying useChat instance is recreated (via a
 * planId-keyed `id` that changes once loading finishes) so its initial `messages` reflects
 * the loaded history instead of the empty array available on first render.
 */
export function useCareerCoachChat({
  planId,
  targetRole,
  targetCompany,
  gapAnalysis,
  careerPlan,
}: UseCareerCoachChatOptions) {
  const supabase = createClient();
  const { data: serverMessages = [], isLoading: isLoadingHistory } = useChatMessages(planId);
  const appendMessages = useAppendChatMessages(planId);
  const ready = !isLoadingHistory;

  const chat = useChat({
    id: `${ready ? "chat" : "chat-loading"}-${planId ?? "anon"}`,
    messages: ready ? toUIMessages(serverMessages) : [],
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: {
        targetRole,
        targetCompany,
        sessionContext: {
          gap_analysis: gapAnalysis ?? null,
          career_plan: careerPlan ?? null,
          target_role: targetRole ?? null,
          target_company: targetCompany ?? null,
        },
      },
    }),
    onFinish: async ({ message, messages, isAbort, isError }) => {
      if (isAbort || isError || !planId) return;
      const assistantText = messageText(message);
      if (!assistantText) return;

      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
      appendMessages(lastUserMessage ? messageText(lastUserMessage) : "", assistantText);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("chat_messages").insert({
        career_plan_id: planId,
        user_id: user.id,
        role: "assistant",
        content: assistantText,
      });
    },
  });

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || chat.status === "streaming" || chat.status === "submitted") return;

      if (planId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("chat_messages").insert({
            career_plan_id: planId,
            user_id: user.id,
            role: "user",
            content: text,
          });
        }
      }

      chat.sendMessage({ text });
    },
    [chat, planId, supabase]
  );

  return {
    ...chat,
    sendMessage,
    isLoadingHistory,
    ready,
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
  };
}
