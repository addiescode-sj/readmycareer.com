"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { chatMessagesKey } from "@/lib/query-keys";

export type { ChatMessage };
export { chatMessagesKey };

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Fetches persisted chat history for a career plan.
 * staleTime: 5 min — messages are append-only; we update the cache
 * optimistically after each send, so staleness only matters on cold loads.
 */
export function useChatMessages(planId: string | null | undefined) {
  const supabase = createClient();
  return useQuery({
    queryKey: chatMessagesKey(planId ?? ""),
    queryFn: async (): Promise<ChatMessage[]> => {
      if (!planId) return [];
      const { data, error } = await supabase
        .from("recent_chat_messages")
        .select("role, content")
        .eq("career_plan_id", planId)
        .order("sequence_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChatMessage[];
    },
    enabled: !!planId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/** Appends a completed exchange to the cache so the next open is instant. */
export function useAppendChatMessages(planId: string | null | undefined) {
  const queryClient = useQueryClient();
  return (userMsg: string, assistantMsg: string) => {
    if (!planId) return;
    queryClient.setQueryData(chatMessagesKey(planId), (old: ChatMessage[] | undefined) => [
      ...(old ?? []),
      { role: "user" as const, content: userMsg },
      { role: "assistant" as const, content: assistantMsg },
    ]);
  };
}
