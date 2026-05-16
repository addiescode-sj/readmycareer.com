import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 60s freshness window covers the common nav-back-to-dashboard case.
        staleTime: 60 * 1000,
        // 5 min memory window — evicts stale dashboard/history payloads instead of growing unbounded.
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // 1 retry with a short backoff — Supabase reads either succeed or fail fast.
        retry: 1,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
