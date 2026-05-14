"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { optimizedResumeKey } from "@/lib/query-keys";

export type OptimizedResumeRecord = Record<string, unknown>;
export { optimizedResumeKey };

/**
 * Fetches the optimized resume for a given career plan.
 * staleTime: Infinity — once generated, an optimized resume never changes.
 * gcTime: Infinity — keep it in memory indefinitely; never evict.
 */
export function useOptimizedResume(planId: string) {
  const supabase = createClient();

  return useQuery({
    queryKey: optimizedResumeKey(planId),
    queryFn: async (): Promise<OptimizedResumeRecord | null> => {
      const { data } = await supabase
        .from("optimized_resumes")
        .select("id, resume_data, markdown, meta, locale, created_at")
        .eq("career_plan_id", planId)
        .maybeSingle();
      return (data as OptimizedResumeRecord | null) ?? null;
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Writes a freshly generated optimized resume directly into the RQ cache. */
export function useSetOptimizedResume(planId: string) {
  const queryClient = useQueryClient();
  return (data: OptimizedResumeRecord) => {
    queryClient.setQueryData(optimizedResumeKey(planId), data);
  };
}
